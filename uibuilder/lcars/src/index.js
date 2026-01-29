import rollo from './views/rollo/rollo.js';
import licht from './views/licht/licht.js';
import heizung from './views/heizung/heizung.js';
import sonstiges from './views/sonstiges/sonstiges.js';

// ================= VIEW REGISTRY =================
const views = { rollo, licht, heizung, sonstiges };

let currentUnmount = null;

document.addEventListener('DOMContentLoaded', () => {

    const btnMenu = document.getElementById('menu-btn');
    const layoutTop = document.getElementById('layout-top');
    const content = document.getElementById('content-container');
    const contentInner = document.getElementById('content-inner');
    const subButtons = Array.from(document.querySelectorAll('.subbtn'));
    const clock = document.getElementById('lcars-clock');
    const date = document.getElementById('lcars-date');
    const temp = document.getElementById('temp-1');
    const room = document.getElementById('lcars-room');

    let menuOpen = false;
    let animating = false;
    let activeBtn = subButtons[0] || null;

    // ================= CLOCK & DATE =================
    function updateClock() {
        const now = new Date();
        clock.textContent =
            `${now.getHours().toString().padStart(2, '0')}:` +
            `${now.getMinutes().toString().padStart(2, '0')}:` +
            `${now.getSeconds().toString().padStart(2, '0')}`;
        const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
        date.textContent = `${days[now.getDay()]} ${now.getDate().toString().padStart(2,'0')}.` +
            `${(now.getMonth()+1).toString().padStart(2,'0')}.${now.getFullYear()}`;
    }
    updateClock();
    setInterval(updateClock, 1000);

    // ================= TEMPERATURE =================
    if (window.uibuilder) {
        uibuilder.onChange('msg', msg => {
            const payload = msg?.payload;
            if (payload && 'temp' in payload && 'id' in payload) {
                const el = document.getElementById(`temp-${payload.id}`);
                if (el) el.textContent = `${Number(payload.temp).toFixed(1)} °C`;
            }
        });
    }

    // ================= VIEW LOADER =================
    function loadView(name) {
        if (currentUnmount) {
            currentUnmount();
            currentUnmount = null;
        }
        contentInner.innerHTML = '';

        const view = views[name];
        if (!view) {
            content.style.display = 'none';
            return;
        }

        content.style.display = menuOpen ? 'block' : 'none';
        const maybeUnmount = view.mount?.(contentInner, window.uibuilder);
        if (typeof maybeUnmount === 'function') currentUnmount = maybeUnmount;
    }

    // ================= MENU OPEN/CLOSE =================
    function openMenu() {
        animating = true;
        anime({
            targets: layoutTop,
            translateY: -360,
            duration: 500,
            easing: 'easeInOutQuad',
            complete: () => {

                // Subbuttons nacheinander sichtbar machen
                subButtons.forEach((btn,i) => setTimeout(() => {
                    btn.style.visibility = 'visible';
                    btn.classList.add('visible');
                }, i*120));

                // Nach Abschluss der Subbutton-Animation den Content laden
                setTimeout(()=>{
                    animating=false;
                    menuOpen=true;

                    if(activeBtn && views[activeBtn.dataset.page]){
                        loadView(activeBtn.dataset.page); // Content jetzt erst laden
                    }
                }, subButtons.length*120 + 50);
            }
        });
        [clock,date,temp,room].forEach(el=>el.setAttribute('opacity','0'));
    }

    function closeMenu() {
        animating = true;
        subButtons.forEach((btn,i)=>setTimeout(()=>{
            btn.classList.remove('visible','is-pressed');
            btn.style.visibility='hidden';
        },i*80));

        // Content sofort ausblenden, **vor der Layout-Animation**
        content.style.display = 'none';

        setTimeout(()=>{
            anime({
                targets: layoutTop,
                translateY: 0,
                duration: 500,
                easing: 'easeInOutQuad',
                complete: ()=>{
                    [clock,date,temp,room].forEach(el=>el.setAttribute('opacity','1'));
                    animating=false;
                    menuOpen=false;
                }
            });
        }, subButtons.length*80+50);
    }

    btnMenu.addEventListener('pointerdown', ()=>btnMenu.classList.add('is-active'));
    btnMenu.addEventListener('pointerup', ()=>{
        btnMenu.classList.remove('is-active');
        if(!animating) menuOpen?closeMenu():openMenu();
    });
    btnMenu.addEventListener('pointerleave', ()=>btnMenu.classList.remove('is-active'));

    // ================= SUBBUTTON LOGIC =================
    subButtons.forEach(btn=>{
        btn.addEventListener('click', ()=>{
            if(btn===activeBtn) return;

            if(activeBtn) activeBtn.classList.remove('is-active');
            btn.classList.add('is-active');
            activeBtn = btn;

            // Content nur sichtbar, wenn Menü offen
            content.style.display = menuOpen && views[btn.dataset.page] ? 'block' : 'none';

            // Content **sofort laden**, nur wenn Menü bereits offen
            if(menuOpen) loadView(btn.dataset.page);
        });

        // --- PRESS START ---
        btn.addEventListener('pointerdown', e=>{
            e.preventDefault();
            btn.classList.add('is-pressed');
            btn.setPointerCapture?.(e.pointerId);
        });

        // --- PRESS END ---
        const release = e=>{
            btn.classList.remove('is-pressed');
            btn.releasePointerCapture?.(e.pointerId);
        };

        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('pointerleave', release);
    });

    // ================= INITIAL VIEW =================
    if(activeBtn){
        activeBtn.classList.add('is-active');
        // Content nur laden, wenn Menü offen
        content.style.display = menuOpen && views[activeBtn.dataset.page] ? 'block' : 'none';
        if(menuOpen && views[activeBtn.dataset.page]){
            loadView(activeBtn.dataset.page);
        }
    } else {
        content.style.display='none';
    }

});
