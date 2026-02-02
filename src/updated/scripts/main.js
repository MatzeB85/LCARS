document.addEventListener('DOMContentLoaded', () => {
    const body = document.getElementById('lcars-body')
    const menu = document.getElementById('lcars-menu-btn')
    const clock = document.getElementById('lcars-clock')
    const date = document.getElementById('lcars-date')
    const temp = document.getElementById('lcars-temp-1')
    const room = document.getElementById('lcars-room')

    /** Menu */
    menu.addEventListener('click', () => {
        body.classList.toggle('menu-open')
    })

    /** Clock and Date */
    /**
     * @param {HTMLElement} clockElem
     * @param {Intl.DateTimeFormatOptions} options
     * @return {HTMLElement}
     * */
    function updateClock(clockElem, options = {}) {
        const now = new Date()
        clockElem.textContent = now.toLocaleTimeString('de-DE', options)
        return clockElem
    }

    /**
     * @param {HTMLElement} dateElem
     * @param {Intl.DateTimeFormatOptions} options
     * @return {HTMLElement}
     * */
    function updateDate(dateElem, options = {
        weekday: 'long',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }) {
        const now = new Date()
        dateElem.textContent = now.toLocaleDateString('de-DE', options)
        return dateElem
    }

    updateClock(clock)
    updateDate(date)
    setInterval(() => {
        updateClock(clock)
        updateDate(date)
    }, 1000)
})
