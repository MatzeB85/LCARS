export default {
    mount: (container, uibuilder) => {
        container.innerHTML = '<h2>Sonstiges</h2>';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'check1';
        const label = document.createElement('label');
        label.htmlFor = 'check1';
        label.textContent = 'Option aktivieren';
        container.appendChild(cb);
        container.appendChild(label);

        const handleChange = () => console.log('Checkbox:', cb.checked);
        cb.addEventListener('change', handleChange);

        const timer = setInterval(() => { }, 5000);

        return () => {
            cb.removeEventListener('change', handleChange);
            clearInterval(timer);
        };
    }
};
