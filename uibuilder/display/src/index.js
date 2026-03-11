"use strict";

/* -------------------- helpers -------------------- */

const $ = (id) => document.getElementById(id);

function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}

function fmtNum(v, digits = 0) {
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(digits);
}

function fmtPct(v) {
    if (!Number.isFinite(v)) return "—";
    return (v * 100).toFixed(1) + "%";
}

function fmtAge(ms) {
    if (!Number.isFinite(ms)) return "—";
    if (ms < 1000) return ms + " ms";
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + " s";
    const m = s / 60;
    if (m < 60) return m.toFixed(1) + " m";
    const h = m / 60;
    return h.toFixed(1) + " h";
}

function setBar(id, frac, warn = false) {
    const el = $(id);
    if (!el) return;

    frac = clamp(frac, 0, 1);
    el.style.width = (frac * 100) + "%";

    if (warn) el.style.background = "var(--warn)";
    else el.style.background = "var(--ok)";
}

function setDot(id, state) {
    const el = $(id);
    if (!el) return;

    if (state === "ok") el.style.background = "var(--ok)";
    else if (state === "warn") el.style.background = "var(--warn)";
    else if (state === "bad") el.style.background = "var(--bad)";
    else el.style.background = "var(--muted2)";
}

/* -------------------- canvas -------------------- */

const canvas = $("matrix");
const ctx = canvas.getContext("2d");

let gridW = 32;
let gridH = 8;

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.width * (gridH / gridW);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function drawMatrix(rows) {
    const cw = canvas.width / gridW;
    const ch = canvas.height / gridH;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#111";

    for (let y = 0; y < gridH; y++) {
        const r = rows[y];
        for (let m = 0; m < r.length; m++) {
            const byte = r[m];
            for (let bit = 0; bit < 8; bit++) {
                if (byte & (1 << bit)) {
                    const x = m * 8 + bit;
                    ctx.fillRect(x * cw, y * ch, cw, ch);
                }
            }
        }
    }
}

/* -------------------- state -------------------- */

let lastFrameTs = 0;
let lastStats = null;

const logEl = $("log");
const logMeta = $("logMeta");
const logClear = $("logClear");

/* ---------- EPISODE LENGTH HISTORY ---------- */

const lenHistory = [];
const LEN_HISTORY_MAX = 100;
let lastEpisodeSeen = null;

function pushEpisodeLen(len) {
    if (!Number.isFinite(len)) return;

    lenHistory.push(len);

    while (lenHistory.length > LEN_HISTORY_MAX) {
        lenHistory.shift();
    }
}

function avgLast(n) {
    if (!lenHistory.length) return null;

    const arr = lenHistory.slice(-n);
    if (!arr.length) return null;

    const sum = arr.reduce((a, b) => a + b, 0);
    return sum / arr.length;
}

/* -------------------- log -------------------- */

function appendLog(line) {
    logEl.textContent += line + "\n";

    const lines = logEl.textContent.split("\n");
    if (lines.length > 400) {
        logEl.textContent = lines.slice(-400).join("\n");
    }

    logMeta.textContent = lines.length + " lines";
}

logClear.onclick = () => {
    logEl.textContent = "";
};

/* -------------------- info panel -------------------- */

function updateInfo() {
    const info = $("info");

    if (!lastStats) {
        info.textContent = "Warte auf Daten…";
        return;
    }

    const lines = [];

    lines.push(`Episode: ${fmtNum(lastStats.episode)}   Steps: ${fmtNum(lastStats.totalSteps)}`);

    lines.push(
        `Len: ${fmtNum(lastStats.len)}  BestLen: ${fmtNum(lastStats.bestLen)}  Score: ${fmtNum(lastStats.score)}  SinceEat: ${fmtNum(lastStats.sinceEat)}`
    );

    const avg50 = avgLast(50);
    const avg100 = avgLast(100);

    lines.push(
        `AvgLen50: ${avg50 == null ? "—" : avg50.toFixed(2)}   AvgLen100: ${avg100 == null ? "—" : avg100.toFixed(2)}`
    );

    lines.push(
        `Return: ${fmtNum(lastStats.epReturn, 2)}  FoodDist: ${fmtNum(lastStats.foodDist, 2)}`
    );

    lines.push(
        `ε: ${fmtNum(lastStats.eps, 3)}`
    );

    info.textContent = lines.join("\n");
}

/* -------------------- HUD update -------------------- */

function updateHUD(stats) {

    if (!stats) return;

    const trainer = stats.trainer || {};
    const policy = stats.policy || {};

    $("trainReplayVal").textContent = fmtNum(trainer.replayN);
    $("trainTrainsVal").textContent = fmtNum(trainer.trains);

    $("trainAttemptsVal").textContent = fmtNum(trainer.trainAttempts);
    $("trainErrorsVal").textContent = fmtNum(trainer.trainErrors);

    $("trainLossVal").textContent = fmtNum(trainer.lossEma, 4);
    $("trainTdVal").textContent = fmtNum(trainer.tdAbsEma, 4);

    setBar("trainLossBar", clamp(trainer.lossEma / 1.0, 0, 1));
    setBar("trainTdBar", clamp(trainer.tdAbsEma / 1.0, 0, 1));

    $("trainEpsVal").textContent = fmtNum(stats.eps, 3);
    $("trainEpsTrainVal").textContent = fmtNum(stats.epsTrain, 3);

    setBar("trainEpsBar", clamp(stats.eps, 0, 1));

    $("qualModelFrac").textContent = fmtPct(policy.modelFrac);
    $("qualRandomFrac").textContent = fmtPct(policy.randomFrac);

    setBar("qualModelBar", clamp(policy.modelFrac, 0, 1));

    $("qualQMax").textContent = fmtNum(policy.qMax, 3);
    $("qualQSpread").textContent = fmtNum(policy.qSpread, 3);

    $("qualLen").textContent = fmtNum(stats.len);
    $("qualBestLen").textContent = fmtNum(stats.bestLen);

    setBar("qualLenBar", clamp(stats.len / stats.bestLen, 0, 1));

    $("qualReturn").textContent = fmtNum(stats.epReturn, 2);
}

/* -------------------- socket -------------------- */

uibuilder.start();

uibuilder.onChange("msg", (msg) => {

    const n = msg;

    if (!n) return;

    if (n.topic === "max7219/frame") {

        if (n.payload && n.payload.rows) {
            drawMatrix(n.payload.rows);
            lastFrameTs = Date.now();
        }

        if (n.stats && typeof n.stats === "object") {

            lastStats = n.stats;

            if (Number.isFinite(lastStats.episode)) {

                if (lastEpisodeSeen === null) {
                    lastEpisodeSeen = lastStats.episode;
                } else if (lastStats.episode !== lastEpisodeSeen) {

                    pushEpisodeLen(lastStats.len);
                    lastEpisodeSeen = lastStats.episode;

                }
            }

            updateHUD(lastStats);
            updateInfo();
        }
    }

    if (n.topic === "snake/error") {
        appendLog("ERROR: " + JSON.stringify(n.payload));
    }

    if (n.topic === "snake/info") {
        appendLog("INFO: " + JSON.stringify(n.payload));
    }

});