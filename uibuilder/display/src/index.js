/* global uibuilder */
uibuilder.start();

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

const scale = 12; // LED-Größe im Browser

function drawFrame(frame) {
    const w = frame.w || 32;
    const h = frame.h || 8;
    const rows = frame.rows; // [8][4] Bytes

    canvas.width = w * scale;
    canvas.height = h * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // rows[y][module] hat Bits für x=module*8..module*8+7 (LSB=bit0)
    for (let y = 0; y < 8; y++) {
        for (let m = 0; m < rows[y].length; m++) {
            const b = rows[y][m] & 0xFF;
            for (let bit = 0; bit < 8; bit++) {
                const on = (b >> bit) & 1;
                if (on) {
                    const x = m * 8 + bit;
                    ctx.fillRect(x * scale, y * scale, scale, scale);
                }
            }
        }
    }
}

uibuilder.onChange("msg", (msg) => {
    if (!msg || !msg.payload) return;
    if (msg.topic !== "max7219/frame") return;
    drawFrame(msg.payload);
});