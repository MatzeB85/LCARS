export default {
    mount: (container, uibuilder) => {
        container.innerHTML = '<h2>Heizung Steuerung</h2>';

        const btnUp = document.createElement('button');
        btnUp.textContent = 'Temp erhöhen';
        container.appendChild(btnUp);

        const btnDown = document.createElement('button');
        btnDown.textContent = 'Temp senken';
        container.appendChild(btnDown);

        const handleUp = () => console.log('Temp +1');
        const handleDown = () => console.log('Temp -1');

        btnUp.addEventListener('click', handleUp);
        btnDown.addEventListener('click', handleDown);

        const timer = setInterval(() => { }, 5000);

        return () => {
            btnUp.removeEventListener('click', handleUp);
            btnDown.removeEventListener('click', handleDown);
            clearInterval(timer);
        };
    }
};
