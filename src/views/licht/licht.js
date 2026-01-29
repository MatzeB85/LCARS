/* ================= ROLLO FRONTEND LOGIC ================= */

export default {
    mount: (container, uibuilder) => {

        // ========= HTML LADEN =========
        fetch('views/licht/licht.html')
            .then(resp => resp.text())
            .then(html => {

                // === ROOT FÜR DIE VIEW ===
                const inner = container.querySelector('#content-inner') || container;
                inner.innerHTML = html;

                // !! Wichtig: Container sichtbar machen
                inner.style.visibility = 'visible';

                // ===== HEADER STARTZUSTAND =====
                const leftRect = inner.querySelector('.lcars-rect-left');
                const title = inner.querySelector('.rollo-title');

                if (leftRect) {
                    leftRect.style.width = '657px'; // Startbreite
                    leftRect.style.transition = 'none';
                }

                if (title) {
                    title.style.visibility = 'hidden';
                    title.style.opacity = '0';
                    title.style.transition = 'opacity 0.4s linear';
                }

                // === Rollo-Elemente vorbereiten ===
                initRollos(inner);
            })
            .catch(err => {
                console.error(err);
                container.innerHTML =
                    `<p style="color:red">Rollo View konnte nicht geladen werden</p>`;
            });

        // ========= SEQUENZIELLES EINBLENDEN =========
        function revealSequentially(elements, delay = 100, callback) {
            elements.forEach((el, i) => {
                if (!el) return;
                el.style.visibility = 'hidden';
                setTimeout(() => {
                    el.style.visibility = 'visible';
                    if (i === elements.length - 1 && typeof callback === 'function') {
                        callback();
                    }
                }, i * delay);
            });
        }

        // ========= HEADER-ANIMATION =========
        function animateHeader(root) {
            const leftRect = root.querySelector('.lcars-rect-left');
            const title = root.querySelector('.rollo-title');

            if (!leftRect || !title) return;

            // Rechteck-Transition aktivieren
            requestAnimationFrame(() => {
                leftRect.style.transition = 'width 0.6s linear';
                leftRect.style.width = '530px';
            });

            // Titel nach Rechteckbewegung einblenden
            setTimeout(() => {
                title.style.visibility = 'visible';
                title.style.opacity = '1';
            }, 650);
        }

        // ========= INITIALISIEREN =========
        function initRollos(root) {
            const rolloContainers = root.querySelectorAll('.rollo-container');

            // Buttons vorbereiten
            rolloContainers.forEach(rc => {
                const id = Number(rc.dataset.rolloId);
                setupButton(rc.querySelector('.rollo-auf'), id, 'up');
                setupButton(rc.querySelector('.rollo-ab'), id, 'down');
            });

            // Alle Elemente sammeln, die sequenziell eingeblendet werden
            const elementsToReveal = [];
            rolloContainers.forEach(rc => {
                elementsToReveal.push(
                    rc.querySelector('.rollo-auf'),
                    rc.querySelector('.rollo-ab'),
                    rc.querySelector('.lcars-rect-zb'),
                    rc.querySelector('.lcars-rect-ru'),
                    rc.querySelector('.lcars-rect-right-ru')
                );
            });

            // Step-by-Step einblenden → danach Header animieren
            revealSequentially(elementsToReveal, 100, () => {
                animateHeader(root);
            });

            // ===== STATUS VOM NODE =====
            if (uibuilder) {
                uibuilder.onChange('msg', msg => {
                    if (!msg || msg.topic !== 'Rollo') return;

                    const { id, button, status } = msg.payload || {};
                    if (typeof id !== 'number') return;

                    const rolloEl = Array.from(rolloContainers)
                        .find(el => Number(el.dataset.rolloId) === id);
                    if (!rolloEl) return;

                    const buttons = [];
                    if (button === 'up') buttons.push(rolloEl.querySelector('.rollo-auf'));
                    else if (button === 'down') buttons.push(rolloEl.querySelector('.rollo-ab'));
                    else {
                        buttons.push(
                            rolloEl.querySelector('.rollo-auf'),
                            rolloEl.querySelector('.rollo-ab')
                        );
                    }

                    buttons.forEach(btn => {
                        if (!btn) return;
                        const statusRect = btn.querySelector('.rollo-status');
                        if (statusRect) statusRect.classList.toggle('active', !!status);
                        btn.classList.toggle('pressed', !!status);
                    });
                });

                uibuilder.send({ topic: 'RolloRequest', payload: {} });
            }
        }

        // ========= BUTTON HANDLER =========
        function setupButton(button, id, dir) {
            if (!button) return;

            let pressed = false;

            const send = (active) => {
                if (!uibuilder) return;
                uibuilder.send({
                    topic: 'Rollo',
                    payload: { id, button: dir, active }
                });
            };

            button.addEventListener('pointerdown', e => {
                e.stopPropagation();
                pressed = true;
                button.classList.add('pressed');
                send(true);
                button.setPointerCapture?.(e.pointerId);
            });

            const release = (e) => {
                if (!pressed) return;
                pressed = false;
                button.classList.remove('pressed');
                send(false);
                button.releasePointerCapture?.(e.pointerId);
            };

            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            button.addEventListener('pointerleave', release);

            button.addEventListener('mouseenter', () => button.classList.add('hover'));
            button.addEventListener('mouseleave', () => button.classList.remove('hover'));
        }

        // ========= UNMOUNT =========
        return () => {
            const root = container.querySelector('#content-inner') || container;
            root.querySelectorAll('.rollo-btn')
                .forEach(btn => btn.replaceWith(btn.cloneNode(true)));
        };
    }
};
