/* ================= ROLLO FRONTEND LOGIC ================= */

export default {
    mount: (container, uibuilder) => {

        // ========= HTML LADEN =========
        fetch('views/rollo/rollo.html')
            .then(resp => resp.text())
            .then(html => {
                const inner = container.querySelector('#content-inner') || container;
                inner.innerHTML = html;
                inner.style.visibility = 'visible';
                initRollos(inner);
            })
            .catch(err => {
                console.error(err);
                container.innerHTML = `<p style="color:red">Rollo View konnte nicht geladen werden</p>`;
            });

        // ========= INIT ROLLOS =========
        function initRollos(root) {
            const rolloContainers = root.querySelectorAll('.rollo-container');

            // ==================== SETUP BUTTONS ====================
            rolloContainers.forEach(rc => {
                const id = Number(rc.dataset.rolloId);
                setupButton(rc.querySelector('.rollo-up'), id, 'up');
                setupButton(rc.querySelector('.rollo-down'), id, 'down');
                rc.querySelectorAll('.rollo-btn-percent')
                    .forEach(btn => setupPercentButton(btn, id));
            });

            if (!uibuilder) return;

            // ==================== NODE → UI STATUS ====================
            uibuilder.onChange('msg', msg => {
                if (!msg || !msg.topic || !msg.payload) return;

                const { id, button, status } = msg.payload;
                const rolloEl = [...rolloContainers].find(el => Number(el.dataset.rolloId) === Number(id));
                if (!rolloEl) return;

                // AUF / AB Buttons
                if (button === 'up' || button === 'down') {
                    rolloEl.querySelector(`.rollo-${button} .rollo-status`)
                        ?.classList.toggle('active', !!status);
                    return;
                }

                // Prozentbuttons Status
                if (!isNaN(button)) {
                    rolloEl.querySelectorAll('.rollo-btn-percent').forEach(pbtn => {
                        const active = pbtn.dataset.key === String(button) && status;
                        // Zahl Text
                        pbtn.querySelector('.rollo-status-percent-text')
                            ?.classList.toggle('active', active);
                    });
                }

                // Preset Zahl aktualisieren
                if (msg.topic === 'RolloPresetUpdate') {
                    const { key, value } = msg.payload;
                    const txt = rolloEl.querySelector(`.rollo-btn-percent[data-key="${key}"] .rollo-status-percent-text`);
                    if (txt) txt.textContent = Math.round(value);
                }

                // Preset Blink (nur Zahl)
                if (msg.topic === 'RolloPresetBlink') {
                    const { key } = msg.payload;
                    const txt = rolloEl.querySelector(`.rollo-btn-percent[data-key="${key}"] .rollo-status-percent-text`);
                    if (!txt) return;
                    let count = 0;
                    const max = 6; // 3x blink
                    const iv = setInterval(() => {
                        txt.classList.toggle('active');
                        count++;
                        if (count >= max) {
                            clearInterval(iv);
                            txt.classList.add('active'); // Endzustand korrekt
                        }
                    }, 150);
                }
            });

            // ==================== START ANIMATION LINKES RECHTECK ====================
            const leftRect = root.querySelector('.lcars-rect-left');
            const titleEl = root.querySelector('.rollo-title');

            if (leftRect && titleEl) {
                leftRect.style.width = '657px'; // Startbreite
                titleEl.style.visibility = 'hidden';

                // Rechteck fährt auf normale Breite
                setTimeout(() => {
                    leftRect.style.transition = 'width 0.4s ease-out';
                    leftRect.style.width = '490px';
                }, 1300);

                // Titel nach 1s einblenden
                setTimeout(() => {
                    titleEl.style.visibility = 'visible';
                }, 2000);
            }

            // Status beim Laden anfordern
            uibuilder.send({ topic: 'RolloRequest', payload: {} });

            // ==================== SEQUENTIELLES EINBLENDEN BUTTONS & RECHTECKE ====================
            let delay = 40;
            const delayStep = 60;

            rolloContainers.forEach(rc => {
                // AUF/AB Buttons
                [rc.querySelector('.rollo-up'), rc.querySelector('.rollo-down')].forEach(btn => {
                    btn.style.opacity = '0';
                    setTimeout(() => btn.style.opacity = '1', delay);
                    delay += delayStep;
                });

                // Prozent Buttons (links oben → rechts unten)
                rc.querySelectorAll('.rollo-column').forEach(col => {
                    col.querySelectorAll('.rollo-btn-percent', '.rollo-btn-auto', '.standard-btn').forEach(btn => {
                        btn.style.opacity = '0';
                        setTimeout(() => btn.style.opacity = '1', delay);
                        delay += delayStep;
                    });
                });

                // Rechtecke unter Buttons
                rc.querySelectorAll('.lcars-rect-zb, .lcars-rect-ru, .lcars-rect-right-ru').forEach(rect => {
                    rect.style.opacity = '0';
                    setTimeout(() => rect.style.opacity = '1', delay);
                    delay += delayStep;
                });
            });
        }

        // ==================== AUF / AB BUTTON ====================
        function setupButton(button, id, dir) {
            if (!button || !uibuilder) return;

            let pressed = false;
            const send = active =>
                uibuilder.send({ topic: 'Rollo', payload: { id, button: dir, active } });

            button.addEventListener('pointerdown', e => {
                pressed = true;
                send(true);
                button.setPointerCapture?.(e.pointerId);
            });

            const release = e => {
                if (!pressed) return;
                pressed = false;
                send(false);
                button.releasePointerCapture?.(e.pointerId);
            };

            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            button.addEventListener('pointerleave', release);
        }

        // ==================== PERCENT BUTTON ====================
        function setupPercentButton(button, id) {
            if (!button || !uibuilder) return;

            let pressed = false;
            const key = button.dataset.key;
            const send = active =>
                uibuilder.send({ topic: 'Rollo', payload: { id, key, active } });

            button.addEventListener('pointerdown', e => {
                pressed = true;
                send(true);
                button.setPointerCapture?.(e.pointerId);
            });

            const release = e => {
                if (!pressed) return;
                pressed = false;
                send(false);
                button.releasePointerCapture?.(e.pointerId);
            };

            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            button.addEventListener('pointerleave', release);
        }

        // ==================== UNMOUNT ====================
        return () => {
            const root = container.querySelector('#content-inner') || container;
            root.querySelectorAll('button')
                .forEach(b => b.replaceWith(b.cloneNode(true)));
        };
    }
};
