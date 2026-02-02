/**
 * @param {HTMLElement} clock
 * @param {Intl.DateTimeFormatOptions} options
 * @return {HTMLElement}
 * */
export function updateClock(clock, options = {}) {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString("de-DE", options);
    return clock;
}

/**
 * @param {HTMLElement} date
 * @param {Intl.DateTimeFormatOptions} options
 * @return {HTMLElement}
 * */
export function updateDate(date, options = {
    weekday: "long",
    year: "numeric",
    month: "numeric",
    day: "numeric",
}) {
    const now = new Date();
    date.textContent = now.toLocaleDateString("de-DE", options);
    return date;
}
