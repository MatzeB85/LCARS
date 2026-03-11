/* global uibuilder */
"use strict";

/**
 * UI für Node-RED / uibuilder
 *
 * Eigenschaften:
 * - entpackt Wrapper automatisch
 * - verarbeitet max7219/frame, snake/info, snake/error, snake/episode, sys/metrics
 * - füllt System / Trainer Memory / Training / Qualität / Log
 * - ergänzt AvgLen50 / AvgLen100 nur in der UI
 */

const canvas = document.getElementById("matrix");
const infoEl = document.getElementById("info");
const logEl = document.getElementById("log");
const logMetaEl = document.getElementById("logMeta");
const logClearBtn = document.getElementById("logClear");

const ctx = canvas.getContext("2d", { alpha: false });

const W = 32;
const H = 8;
const CELL = 18;

canvas.width = W * CELL;
canvas.height = H * CELL;

function $(id) { return document.getElementById(id); }

function fmtAge(ms) {
    if (ms == null || !Number.isFinite(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rs = Math.round(s - m * 60);
    return `${m}m ${rs}s`;
}

function fmtNum(x) {
    if (x == null || !Number.isFinite(x)) return "—";
    if (x >= 1e9) return (x / 1e9).toFixed(2) + "B";
    if (x >= 1e6) return (x / 1e6).toFixed(2) + "M";
    if (x >= 1e3) return (x / 1e3).toFixed(1) + "k";
    return String(Math.round(x));
}

function fmtMB(x) {
    if (x == null || !Number.isFinite(x)) return "—";
    return `${x.toFixed(0)} MB`;
}

function fmtPct01(x, digits = 1) {
    if (x == null || !Number.isFinite(x)) return "—";
    return `${(x * 100).toFixed(digits)}%`;
}

function fmtPct100(x, digits = 0) {
    if (x == null || !Number.isFinite(x)) return "—";
    return `${x.toFixed(digits)}%`;
}

function setDot(dotEl, level) {
    const map = {
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
        cold: "var(--cold)",
        muted: "var(--muted2)",
    };
    if (!dotEl) return;
    dotEl.style.background = map[level] || map.muted;
}

function setBar(barEl, pct, level) {
    if (!barEl) return;
    const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
    barEl.style.width = `${p}%`;
    if (level === "bad") barEl.style.background = "var(--bad)";
    else if (level === "warn") barEl.style.background = "var(--warn)";
    else if (level === "cold") barEl.style.background = "var(--cold)";
    else barEl.style.background = "var(--ok)";
}

function clearCanvas() {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawFrame(frame) {
    clearCanvas();

    const rows = frame?.rows;
    const head = frame?.head;
    const food = frame?.food;

    const occ = new Uint8Array(W * H);

    if (Array.isArray(rows) && rows.length === H) {
        for (let y = 0; y < H; y++) {
            const r = rows[y];
            if (!Array.isArray(r) || r.length !== 4) continue;
            for (let m = 0; m < 4; m++) {
                const b = r[m] | 0;
                for (let bit = 0; bit < 8; bit++) {
                    const x = m * 8 + bit;
                    if (x < W && (b & (1 << bit))) occ[y * W + x] = 1;
                }
            }
        }
    }

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = y * W + x;
            ctx.fillStyle = occ[idx] ? "rgba(53, 208, 127, 0.9)" : "rgba(255,255,255,0.03)";
            ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
        }
    }

    if (food && Number.isFinite(food.x) && Number.isFinite(food.y)) {
        ctx.fillStyle = "rgba(255, 204, 102, 0.95)";
        ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 1, CELL - 1);
    }

    if (head && Number.isFinite(head.x) && Number.isFinite(head.y)) {
        ctx.fillStyle = "rgba(88, 166, 255, 0.98)";
        ctx.fillRect(head.x * CELL, head.y * CELL, CELL - 1, CELL - 1);
    }
}

/* ---------- STATE ---------- */

let lastFrameTs = 0;
let lastStats = null;
let lastAdapt = null;
let lastSysMetrics = null;
let lastTrainerMem = null;
let lastTrainerInfoTs = null;

/* ---------- EPISODE LENGTH HISTORY ---------- */

const lenHistory = [];
const LEN_HISTORY_MAX = 100;
let lastEpisodeSeen = null;

function pushEpisodeLen(len) {
    if (!Number.isFinite(len)) return;
    lenHistory.push(len);
    while (lenHistory.length > LEN_HISTORY_MAX) lenHistory.shift();
}

function avgLast(n) {
    if (!lenHistory.length) return null;
    const arr = lenHistory.slice(-n);
    if (!arr.length) return null;
    const sum = arr.reduce((a, b) => a + b, 0);
    return sum / arr.length;
}

/* ---------- LOG ---------- */

function appendLog(prefix, obj) {
    const ts = new Date();
    const hh = String(ts.getHours()).padStart(2, "0");
    const mm = String(ts.getMinutes()).padStart(2, "0");
    const ss = String(ts.getSeconds()).padStart(2, "0");

    let txt = "";
    if (typeof obj === "string") txt = obj;
    else {
        try { txt = JSON.stringify(obj); }
        catch { txt = String(obj); }
    }

    const line = `[${hh}:${mm}:${ss}] ${prefix} ${txt}`;

    if (logEl.textContent.startsWith("Noch keine")) logEl.textContent = "";
    logEl.textContent += line + "\n";

    const lines = logEl.textContent.trimEnd().split("\n");
    if (lines.length > 450) {
        logEl.textContent = lines.slice(-450).join("\n") + "\n";
    }

    logMetaEl.textContent = `${Math.min(lines.length, 450)} lines • last 0ms`;
    logEl.scrollTop = logEl.scrollHeight;
}

if (logClearBtn) {
    logClearBtn.addEventListener("click", () => {
        logEl.textContent = "Noch keine Log-Einträge…";
        logMetaEl.textContent = "—";
    });
}

/* ---------- INBOUND NORMALIZATION ---------- */

function isWrapperPayload(p) {
    return !!p && typeof p === "object" &&
        typeof p.topic === "string" &&
        Object.prototype.hasOwnProperty.call(p, "payload");
}

function normalizeInbound(msg) {
    // returns { topic, payload, stats, raw }
    // 1) direct msg.topic/msg.payload
    // 2) OR wrapper stored in msg.payload
    // 3) OR wrapper stored in msg.payload.payload (rare)
    const out = { topic: msg?.topic || null, payload: msg?.payload, stats: msg?.stats || null, raw: msg };

    // if msg.payload is wrapper => unpack
    if (isWrapperPayload(out.payload)) {
        out.topic = out.payload.topic;
        out.stats = out.payload.stats || out.stats;
        out.payload = out.payload.payload;
        return out;
    }

    // if msg.payload.payload is wrapper => unpack
    if (msg?.payload?.payload && isWrapperPayload(msg.payload.payload)) {
        out.topic = msg.payload.payload.topic;
        out.stats = msg.payload.payload.stats || out.stats;
        out.payload = msg.payload.payload.payload;
        return out;
    }

    // if msg.payload.topic exists but no wrapper (another common pattern)
    if (!out.topic && msg?.payload?.topic && ("payload" in msg.payload)) {
        out.topic = msg.payload.topic;
        out.stats = msg.payload.stats || out.stats;
        out.payload = msg.payload.payload;
        return out;
    }

    return out;
}

function looksLikeSysMetrics(p) {
    return p && typeof p === "object" &&
        (Number.isFinite(p.procCpuPct) || Number.isFinite(p.memUsedPct) || Number.isFinite(p.tempC));
}

/* ---------- HUD UPDATES ---------- */

function updateInfo() {
    const now = Date.now();
    const lines = [];

    lines.push(`Frame age: ${fmtAge(now - (lastFrameTs || now))}`);
    lines.push(`adapt: ${lastAdapt ? "ja" : "nein"}  mem: ${lastTrainerMem ? "ja" : "nein"}  sys-metrics: ${lastSysMetrics ? "ja" : "nein"}`);
    lines.push("");

    if (!lastStats) {
        lines.push("Keine stats empfangen (nur System/Logs möglich).");
        lines.push("Hinweis: Bei dir steckt stats oft im Wrapper payload.stats.");
        infoEl.textContent = lines.join("\n");
        return;
    }

    lines.push(`Episode: ${fmtNum(lastStats.episode)}  Steps: ${fmtNum(lastStats.totalSteps)}  Mode: ${lastStats.mode || "—"}`);
    lines.push(`Len: ${fmtNum(lastStats.len)}  BestLen: ${fmtNum(lastStats.bestLen)}  Score: ${fmtNum(lastStats.score)}  SinceEat: ${fmtNum(lastStats.sinceEat)}`);

    const avg50 = avgLast(50);
    const avg100 = avgLast(100);
    lines.push(`AvgLen50: ${avg50 == null ? "—" : avg50.toFixed(2)}   AvgLen100: ${avg100 == null ? "—" : avg100.toFixed(2)}`);

    lines.push(`Return: ${lastStats.epReturn != null ? lastStats.epReturn.toFixed(2) : "—"}  FoodDist: ${lastStats.foodDist != null ? lastStats.foodDist.toFixed(3) : "—"}`);
    lines.push(`ε: ${lastStats.eps != null ? lastStats.eps.toFixed(3) : "—"}  ε(train): ${lastStats.epsTrain != null ? lastStats.epsTrain.toFixed(3) : "—"}`);

    if (lastStats.trainer) {
        const tr = lastStats.trainer;
        lines.push("");
        lines.push(`Trainer: ${tr.connected ? "connected" : "down"}  Replay ${fmtNum(tr.replayN)}  Trains ${fmtNum(tr.trains)}  Errors ${fmtNum(tr.trainErrors)}`);
        lines.push(`LossEMA ${tr.lossEma != null ? tr.lossEma : "—"}  TD-EMA ${tr.tdAbsEma != null ? tr.tdAbsEma : "—"}  Temp ${tr.tempC != null ? tr.tempC.toFixed(1) + "°C" : "—"}`);
    }

    infoEl.textContent = lines.join("\n");
}

function updateSystemHud() {
    const m = lastSysMetrics;
    const now = Date.now();

    $("sysAge").textContent = m?.ts ? fmtAge(now - m.ts) : "—";

    $("sysCpuVal").textContent = Number.isFinite(m?.procCpuPct) ? `${m.procCpuPct.toFixed(1)}%` : "—";
    setBar($("sysCpuBar"), m?.procCpuPct, (m?.procCpuPct ?? 0) >= 85 ? "bad" : (m?.procCpuPct ?? 0) >= 65 ? "warn" : "ok");

    $("sysMemVal").textContent = Number.isFinite(m?.memUsedPct) ? `${m.memUsedPct.toFixed(1)}%` : "—";
    $("sysMemMB").textContent = Number.isFinite(m?.rssMB) ? `RSS ${m.rssMB.toFixed(0)} MB` : "—";
    setBar($("sysMemBar"), m?.memUsedPct, (m?.memUsedPct ?? 0) >= 90 ? "bad" : (m?.memUsedPct ?? 0) >= 75 ? "warn" : "ok");

    $("sysTempVal").textContent = Number.isFinite(m?.tempC) ? `${m.tempC.toFixed(1)}°C` : "—";
    setBar($("sysTempBar"), ((m?.tempC ?? 0) / 85) * 100, (m?.tempC ?? 0) >= 78 ? "bad" : (m?.tempC ?? 0) >= 68 ? "warn" : "cold");

    setDot($("sysDot"), m ? "ok" : "muted");
    $("sysStatus").textContent = m ? "live" : "warte…";
}

function updateMemHud() {
    const m = lastTrainerMem;
    const now = Date.now();

    $("memAge").textContent = lastTrainerInfoTs ? fmtAge(now - lastTrainerInfoTs) : "—";

    $("memTfTensorsVal").textContent = fmtNum(m?.tfNumTensors);
    $("memTfMemVal").textContent = Number.isFinite(m?.tfNumBytesMB) ? `${m.tfNumBytesMB.toFixed(0)} MB` : "—";
    setBar($("memTfBar"), ((m?.tfNumBytesMB ?? 0) / 512) * 100, (m?.tfNumBytesMB ?? 0) > 350 ? "warn" : "ok");

    $("memHeapVal").textContent = fmtMB(m?.heapUsedMB);
    setBar($("memHeapBar"), ((m?.heapUsedMB ?? 0) / 2048) * 100, (m?.heapUsedMB ?? 0) > 1400 ? "warn" : "ok");

    $("memRssVal").textContent = fmtMB(m?.rssMB);
    setBar($("memRssBar"), ((m?.rssMB ?? 0) / 3072) * 100, (m?.rssMB ?? 0) > 2400 ? "warn" : "ok");

    setDot($("memDot"), m ? "ok" : "muted");
    $("memStatus").textContent = m ? "live" : "warte…";
}

function updateTrainHud() {
    const s = lastStats;
    const t = s?.trainer || {};
    const now = Date.now();

    $("trainAge").textContent = Number.isFinite(t.ageMs) ? fmtAge(t.ageMs) : "—";

    $("trainReplayVal").textContent = fmtNum(t.replayN);
    $("trainTrainsVal").textContent = fmtNum(t.trains);

    $("trainAttemptsVal").textContent = fmtNum(t.trainAttempts);
    $("trainErrorsVal").textContent = `Errors ${fmtNum(t.trainErrors)}`;

    $("trainLossVal").textContent = t.lossEma != null ? String(t.lossEma) : "—";
    setBar($("trainLossBar"), ((t.lossEma ?? 0) / 1.0) * 100, (t.lossEma ?? 0) > 0.5 ? "warn" : "ok");

    $("trainTdVal").textContent = t.tdAbsEma != null ? String(t.tdAbsEma) : "—";
    setBar($("trainTdBar"), ((t.tdAbsEma ?? 0) / 1.0) * 100, (t.tdAbsEma ?? 0) > 0.5 ? "warn" : "ok");

    $("trainEpsVal").textContent = s?.eps != null ? `ε ${s.eps.toFixed(3)}` : "—";
    $("trainEpsTrainVal").textContent = s?.epsTrain != null ? `train ${s.epsTrain.toFixed(3)}` : "—";
    setBar($("trainEpsBar"), ((s?.eps ?? 0) * 100), (s?.eps ?? 0) > 0.4 ? "warn" : "ok");

    setDot($("trainDot"), s ? "ok" : "muted");
    $("trainStatus").textContent = s ? "live" : "warte…";
}

function updateQualHud() {
    const s = lastStats;
    const p = s?.policy || {};
    const now = Date.now();

    $("qualAge").textContent = lastFrameTs ? fmtAge(now - lastFrameTs) : "—";

    $("qualModelFrac").textContent = p.modelFrac != null ? `Model ${fmtPct01(p.modelFrac)}` : "—";
    $("qualRandomFrac").textContent = p.randomFrac != null ? `Random ${fmtPct01(p.randomFrac)}` : "—";
    setBar($("qualModelBar"), ((p.modelFrac ?? 0) * 100), (p.modelFrac ?? 0) < 0.2 ? "warn" : "ok");

    $("qualQMax").textContent = p.qMax != null ? `Qmax ${Number(p.qMax).toFixed(3)}` : "—";
    $("qualQSpread").textContent = p.qSpread != null ? `spread ${Number(p.qSpread).toFixed(3)}` : "—";

    $("qualLen").textContent = s ? `Len ${fmtNum(s.len)}` : "—";
    $("qualBestLen").textContent = s ? `Best ${fmtNum(s.bestLen)}` : "—";
    const frac = s && Number.isFinite(s.bestLen) && s.bestLen > 0 ? (s.len / s.bestLen) * 100 : 0;
    setBar($("qualLenBar"), frac, frac >= 75 ? "ok" : frac >= 40 ? "warn" : "cold");

    $("qualReturn").textContent = s?.epReturn != null ? Number(s.epReturn).toFixed(2) : "—";

    setDot($("qualDot"), s ? "ok" : "muted");
    $("qualStatus").textContent = s ? "live" : "warte…";
}

function refreshUi() {
    updateInfo();
    updateSystemHud();
    updateMemHud();
    updateTrainHud();
    updateQualHud();
}

/* ---------- MESSAGE HANDLING ---------- */

function handleEpisodeStats(stats) {
    if (!stats || typeof stats !== "object") return;

    lastStats = stats;

    if (Number.isFinite(stats.episode)) {
        if (lastEpisodeSeen === null) {
            lastEpisodeSeen = stats.episode;
        } else if (stats.episode !== lastEpisodeSeen) {
            if (Number.isFinite(stats.len)) pushEpisodeLen(stats.len);
            lastEpisodeSeen = stats.episode;
        }
    }

    refreshUi();
}

function handleSnakeInfo(payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.msg === "mem") {
        if (payload.from === "trainer") {
            lastTrainerMem = payload;
            lastTrainerInfoTs = payload.ts || Date.now();
        } else if (looksLikeSysMetrics(payload)) {
            lastSysMetrics = payload;
        }
    }

    if (looksLikeSysMetrics(payload)) {
        lastSysMetrics = payload;
    }

    appendLog("info:", payload);
    refreshUi();
}

function handleSysMetrics(payload) {
    if (!payload || typeof payload !== "object") return;
    lastSysMetrics = payload;
    refreshUi();
}

function handleFrame(payload, stats) {
    if (payload && typeof payload === "object") {
        drawFrame(payload);
        lastFrameTs = payload.ts || Date.now();
    }

    if (stats && typeof stats === "object") {
        handleEpisodeStats(stats);
    } else {
        refreshUi();
    }
}

/* ---------- START ---------- */

clearCanvas();
refreshUi();

uibuilder.start();

uibuilder.onChange("msg", function (msg) {
    const m = normalizeInbound(msg);
    if (!m) return;

    switch (m.topic) {
        case "max7219/frame":
            handleFrame(m.payload, m.stats);
            break;

        case "snake/info":
            handleSnakeInfo(m.payload);
            break;

        case "snake/error":
            appendLog("ERROR:", m.payload);
            break;

        case "snake/episode":
            appendLog("msg:", "snake/episode");
            if (m.stats && typeof m.stats === "object") {
                handleEpisodeStats(m.stats);
            } else if (m.payload && typeof m.payload === "object") {
                if (Number.isFinite(m.payload.episode)) {
                    if (lastEpisodeSeen === null) {
                        lastEpisodeSeen = m.payload.episode;
                    } else if (m.payload.episode !== lastEpisodeSeen) {
                        if (Number.isFinite(m.payload.len)) pushEpisodeLen(m.payload.len);
                        lastEpisodeSeen = m.payload.episode;
                    }
                }
                refreshUi();
            }
            break;

        case "sys/metrics":
            appendLog("msg:", "sys/metrics");
            handleSysMetrics(m.payload);
            break;

        default:
            if (looksLikeSysMetrics(m.payload)) {
                handleSysMetrics(m.payload);
            }
            break;
    }
});