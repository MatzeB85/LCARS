/* global uibuilder */
uibuilder.start();

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");
const info = document.getElementById("info");

// Anzeige-Skalierung (LED-Größe im Browser)
const scale = 12;

// Mapping-Schalter
// Du hast gesagt: "jede Kachel ist gespiegelt" => Bit-Reihenfolge in jeder 8x8 Kachel drehen
const REVERSE_MODULES = false; // Module links<->rechts tauschen (bei dir offenbar NICHT nötig)
const REVERSE_BITS = true;  // <-- FIX: jede 8er-Kachel horizontal spiegeln
const FLIP_Y = false; // oben/unten spiegeln (meist nicht nötig)

function setCanvasSize(w, h) {
    canvas.width = w * scale;
    canvas.height = h * scale;
}

function normalizeRows(rows) {
    // rows soll [8][4] numbers sein (4 Module bei 32x8)
    if (!Array.isArray(rows)) return null;

    return rows.map((r) => {
        if (!Array.isArray(r)) return [];
        return r.map((v) => {
            if (typeof v === "number") return v & 0xFF;
            // Buffer kann als {type:"Buffer", data:[...]} ankommen
            if (v && typeof v === "object" && Array.isArray(v.data)) return (v.data[0] ?? 0) & 0xFF;
            return (Number(v) || 0) & 0xFF;
        });
    });
}

function drawFrame(frame) {
    const w = frame?.w ?? 32;
    const h = frame?.h ?? 8;

    const rows = normalizeRows(frame?.rows);
    if (!rows || rows.length < 8) {
        if (info) info.textContent = "Frame da, aber rows ungültig";
        return;
    }

    setCanvasSize(w, h);

    // Hintergrund
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // LED-Farbe (damit du was siehst)
    ctx.fillStyle = "#00ff66";

    for (let y0 = 0; y0 < h; y0++) {
        const y = FLIP_Y ? (h - 1 - y0) : y0;

        const rowBytes = rows[y0];
        const modules = REVERSE_MODULES ? [...rowBytes].reverse() : rowBytes;

        for (let m = 0; m < modules.length; m++) {
            const b = modules[m] & 0xFF;

            for (let bit = 0; bit < 8; bit++) {
                const on = (b >> bit) & 1;
                if (!on) continue;

                const xInModule = REVERSE_BITS ? (7 - bit) : bit;
                const x = m * 8 + xInModule;

                ctx.fillRect(x * scale, y * scale, scale, scale);
            }
        }
    }

    if (info) {
        const modCount = (rows[0] && rows[0].length) ? rows[0].length : "?";
        info.textContent = `frame ts=${frame.ts ?? "?"} w=${w} h=${h} modules=${modCount}`;
    }
}

// Testpattern, damit du siehst, dass Canvas/Zeichnen grundsätzlich klappt
function drawTest() {
    const w = 32, h = 8;
    setCanvasSize(w, h);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ff3355";
    for (let x = 0; x < w; x++) {
        ctx.fillRect(x * scale, ((x % h) * scale), scale, scale);
    }
    if (info) info.textContent = "TESTPATTERN (warte auf frames vom Node)";
}
drawTest();

// Empfang von uibuilder
uibuilder.onChange("msg", (msg) => {
    // Debug (bei Bedarf aktivieren)
    // console.log("uibuilder msg:", msg);

    // Nimm payload, egal wie es eingepackt ist
    const payload =
        msg?.payload?.rows ? msg.payload :
            msg?.payload?.payload?.rows ? msg.payload.payload :
                msg?.rows ? msg :
                    msg?.payload;

    if (payload && payload.rows) drawFrame(payload);
});