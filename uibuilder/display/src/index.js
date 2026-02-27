/* global uibuilder */
uibuilder.start();

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

const scale = 12; // LED-Größe im Browser

function drawFrame(frame) {
    const w = frame.w || 32;
    const h = frame.h || 8;
    const rows = frame.rows; // [8][4] bytes

    canvas.width = w * scale;
    canvas.height = h * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < h; y++) {
        for (let m = 0; m < rows[y].length; m++) {
            const b = rows[y][m] & 0xFF;
            for (let bit = 0; bit < 8; bit++) {
                if ((b >> bit) & 1) {
                    const x = m * 8 + bit;
                    ctx.fillRect(x * scale, y * scale, scale, scale);
                }
            }
        }
    }
}

uibuilder.onChange("msg", (msg) => {
    if (!msg || msg.topic !== "max7219/frame" || !msg.payload) return;
    drawFrame(msg.payload);
});