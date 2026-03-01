/* global uibuilder */
"use strict";

uibuilder.start();

// ------- progress tracking -------
const WIN = 50;
const hist = { len: [], score: [], ret: [] };
const best = { len: 0, score: 0, ret: -Infinity };

function pushHist(arr, v) { arr.push(v); if (arr.length > WIN) arr.shift(); }
function avg(arr) { if (!arr.length) return 0; let s = 0; for (const v of arr) s += v; return s / arr.length; }
function fmt(n, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : "—"; }
function clamp01(x) { if (!Number.isFinite(x)) return 0; return Math.max(0, Math.min(1, x)); }
function fmtAge(ms) { const m = Math.max(0, ms | 0); if (m < 1000) return `${m}ms`; return `${(m / 1000).toFixed(1)}s`; }

// ------- DOM -------
let canvas, ctx, info;
const scale = 12;

// System HUD
let elSysAge, elSysDot, elSysStatus, elSysCpuVal, elSysCpuBar, elSysMemVal, elSysMemMB, elSysMemBar, elSysTempVal, elSysTempBar;

// Trainer Memory HUD
let elTfTensorsVal, elTfMemVal, elHeapVal, elRssVal, elTfBar, elHeapBar, elRssBar;
let elMemAge, elMemDot, elMemStatus;

// Training HUD
let elTrAge, elTrDot, elTrStatus;
let elTrReplay, elTrTrains, elTrTPS, elTrTemp, elTrPaused;
let elTrAttempts, elTrErrors, elTrLoss, elTrTD, elTrLastErr;

// Logs
let elLogs, elClearLogsBtn;

function initDom() {
    canvas = document.getElementById("matrix");
    info = document.getElementById("info");

    if (!canvas) {
        console.error('Canvas with id="matrix" not found.');
        return false;
    }
    ctx = canvas.getContext("2d");

    // --- System HUD ---
    elSysAge = document.getElementById("sysAge");
    elSysDot = document.getElementById("sysDot");
    elSysStatus = document.getElementById("sysStatus");
    elSysCpuVal = document.getElementById("sysCpuVal");
    elSysCpuBar = document.getElementById("sysCpuBar");
    elSysMemVal = document.getElementById("sysMemVal");
    elSysMemMB = document.getElementById("sysMemMB");
    elSysMemBar = document.getElementById("sysMemBar");
    elSysTempVal = document.getElementById("sysTempVal");
    elSysTempBar = document.getElementById("sysTempBar");

    // --- Trainer Memory HUD ---
    elTfTensorsVal = document.getElementById("memTfTensorsVal");
    elTfMemVal = document.getElementById("memTfMemVal");
    elHeapVal = document.getElementById("memHeapVal");
    elRssVal = document.getElementById("memRssVal");
    elTfBar = document.getElementById("memTfBar");
    elHeapBar = document.getElementById("memHeapBar");
    elRssBar = document.getElementById("memRssBar");
    elMemAge = document.getElementById("memAge");
    elMemDot = document.getElementById("memDot");
    elMemStatus = document.getElementById("memStatus");

    // --- Training HUD ---
    elTrAge = document.getElementById("trAge");
    elTrDot = document.getElementById("trDot");
    elTrStatus = document.getElementById("trStatus");
    elTrReplay = document.getElementById("trReplay");
    elTrTrains = document.getElementById("trTrains");
    elTrTPS = document.getElementById("trTPS");
    elTrTemp = document.getElementById("trTemp");
    elTrPaused = document.getElementById("trPaused");
    elTrAttempts = document.getElementById("trAttempts");
    elTrErrors = document.getElementById("trErrors");
    elTrLoss = document.getElementById("trLoss");
    elTrTD = document.getElementById("trTD");
    elTrLastErr = document.getElementById("trLastErr");

    // --- Logs ---
    elLogs = document.getElementById("logs");
    elClearLogsBtn = document.getElementById("clearLogs");
    if (elClearLogsBtn && elLogs) {
        elClearLogsBtn.addEventListener("click", () => { elLogs.textContent = ""; });
    }

    return true;
}

function setSize(w, h) {
    canvas.width = w * scale;
    canvas.height = h * scale;
}

// ------- state -------
let latestFrame = null;   // {frame, stats}
let latestMem = null;     // {tfT, tfMB, heapMB, rssMB, replay, ts}
let latestAdapt = null;   // {dynMaxTrainsPerSec, procCpuPct, memUsedPct, tempC, ts}
let latestSys = null;     // {cpuPct, memPct, memUsedMB, memTotalMB, tempC, ts}
let latestTrainer = null; // snapshot extracted from latestFrame.stats.trainer

// ------- HUD helpers -------
function setBar(el, frac01, level /* "ok"|"warn"|"bad"|null */) {
    if (!el) return;
    const w = Math.round(100 * clamp01(frac01));
    el.style.width = `${w}%`;
    if (!level) return;
    if (level === "ok") el.style.backgroundColor = "var(--ok)";
    else if (level === "warn") el.style.backgroundColor = "var(--warn)";
    else if (level === "bad") el.style.backgroundColor = "var(--bad)";
}

function updateSysHud() {
    if (!latestSys) return;

    const now = Date.now();
    const ageMs = Number.isFinite(latestSys.ts) ? Math.max(0, now - latestSys.ts) : Infinity;
    const stale = ageMs > 30000;

    if (elSysAge) elSysAge.textContent = fmtAge(ageMs);
    if (elSysDot) elSysDot.style.backgroundColor = stale ? "var(--warn)" : "var(--ok)";
    if (elSysStatus) elSysStatus.textContent = stale ? "daten alt" : "live";

    // CPU
    if (elSysCpuVal) elSysCpuVal.textContent = Number.isFinite(latestSys.cpuPct) ? `${latestSys.cpuPct.toFixed(1)}%` : "—";
    if (elSysCpuBar) {
        const cpu01 = clamp01((latestSys.cpuPct ?? 0) / 100);
        const lvl = cpu01 < 0.65 ? "ok" : cpu01 < 0.85 ? "warn" : "bad";
        setBar(elSysCpuBar, cpu01, stale ? null : lvl);
    }

    // RAM
    if (elSysMemVal) elSysMemVal.textContent = Number.isFinite(latestSys.memPct) ? `${latestSys.memPct.toFixed(1)}%` : "—";
    if (elSysMemMB) {
        if (Number.isFinite(latestSys.memUsedMB) && Number.isFinite(latestSys.memTotalMB)) {
            elSysMemMB.textContent = `${latestSys.memUsedMB.toFixed(0)}/${latestSys.memTotalMB.toFixed(0)}MB`;
        } else elSysMemMB.textContent = "—";
    }
    if (elSysMemBar) {
        const mem01 = clamp01((latestSys.memPct ?? 0) / 100);
        const lvl = mem01 < 0.70 ? "ok" : mem01 < 0.85 ? "warn" : "bad";
        setBar(elSysMemBar, mem01, stale ? null : lvl);
    }

    // Temp
    if (elSysTempVal) elSysTempVal.textContent = Number.isFinite(latestSys.tempC) ? `${latestSys.tempC.toFixed(1)}°C` : "—";
    if (elSysTempBar) {
        const t = latestSys.tempC;
        const t01 = Number.isFinite(t) ? clamp01((t - 30) / 60) : 0;
        const lvl = !Number.isFinite(t) ? "ok" : t < 70 ? "ok" : t < 80 ? "warn" : "bad";
        setBar(elSysTempBar, t01, stale ? null : lvl);
    }
}

function updateMemHud() {
    if (!latestMem) return;

    const now = Date.now();
    const ageMs = Number.isFinite(latestMem.ts) ? Math.max(0, now - latestMem.ts) : Infinity;
    const stale = ageMs > 30000;

    if (elMemAge) elMemAge.textContent = fmtAge(ageMs);
    if (elMemDot) elMemDot.style.backgroundColor = stale ? "var(--warn)" : "var(--ok)";
    if (elMemStatus) elMemStatus.textContent = stale ? "daten alt" : "live";

    if (elTfTensorsVal) elTfTensorsVal.textContent = Number.isFinite(latestMem.tfT) ? `${Math.trunc(latestMem.tfT)}` : "—";
    if (elTfMemVal) elTfMemVal.textContent = Number.isFinite(latestMem.tfMB) ? `${latestMem.tfMB.toFixed(1)}MB` : "—";
    if (elHeapVal) elHeapVal.textContent = Number.isFinite(latestMem.heapMB) ? `${latestMem.heapMB.toFixed(1)}MB` : "—";
    if (elRssVal) elRssVal.textContent = Number.isFinite(latestMem.rssMB) ? `${latestMem.rssMB.toFixed(1)}MB` : "—";

    const tf01 = Number.isFinite(latestMem.tfMB) ? clamp01(latestMem.tfMB / 800) : 0;
    const heap01 = Number.isFinite(latestMem.heapMB) ? clamp01(latestMem.heapMB / 1000) : 0;
    const rss01 = Number.isFinite(latestMem.rssMB) ? clamp01(latestMem.rssMB / 2000) : 0;

    const tfLvl = tf01 < 0.50 ? "ok" : tf01 < 0.75 ? "warn" : "bad";
    const heapLvl = heap01 < 0.50 ? "ok" : heap01 < 0.75 ? "warn" : "bad";
    const rssLvl = rss01 < 0.50 ? "ok" : rss01 < 0.75 ? "warn" : "bad";

    setBar(elTfBar, tf01, stale ? null : tfLvl);
    setBar(elHeapBar, heap01, stale ? null : heapLvl);
    setBar(elRssBar, rss01, stale ? null : rssLvl);
}

function updateTrainingHud() {
    if (!latestTrainer) return;

    const now = Date.now();
    const seenAt = latestTrainer._seenAt ?? null;
    const ageMs = Number.isFinite(seenAt) ? Math.max(0, now - seenAt) : Infinity;
    const stale = ageMs > 30000;

    if (elTrAge) elTrAge.textContent = fmtAge(ageMs);
    if (elTrDot) elTrDot.style.backgroundColor = stale ? "var(--warn)" : (latestTrainer.connected ? "var(--ok)" : "var(--bad)");
    if (elTrStatus) elTrStatus.textContent = stale ? "daten alt" : (latestTrainer.connected ? "live" : "getrennt");

    if (elTrReplay) elTrReplay.textContent = latestTrainer.replayN ?? "—";
    if (elTrTrains) elTrTrains.textContent = latestTrainer.trains ?? "—";
    if (elTrTPS) elTrTPS.textContent = latestTrainer.tps ?? "—";
    if (elTrTemp) elTrTemp.textContent = Number.isFinite(latestTrainer.tempC) ? `${latestTrainer.tempC.toFixed(1)}°C` : "—";
    if (elTrPaused) elTrPaused.textContent = latestTrainer.pausedHot ? "ja" : "nein";

    if (elTrAttempts) elTrAttempts.textContent = latestTrainer.trainAttempts ?? "—";
    if (elTrErrors) elTrErrors.textContent = latestTrainer.trainErrors ?? "—";
    if (elTrLoss) elTrLoss.textContent = Number.isFinite(latestTrainer.lossEma) ? latestTrainer.lossEma.toFixed(6) : "—";
    if (elTrTD) elTrTD.textContent = Number.isFinite(latestTrainer.tdAbsEma) ? latestTrainer.tdAbsEma.toFixed(6) : "—";

    if (elTrLastErr) elTrLastErr.textContent = latestTrainer.lastTrainErr ? String(latestTrainer.lastTrainErr).slice(0, 220) : "—";
}

// ------- drawing -------
function drawFrame(frame, stats) {
    if (!canvas || !ctx) return;

    const w = frame?.w ?? 32;
    const h = frame?.h ?? 8;
    const rows = frame?.rows;

    if (!Array.isArray(rows) || rows.length < h) return;

    setSize(w, h);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Snake
    ctx.fillStyle = "#00ff66";
    for (let y = 0; y < h; y++) {
        const row = rows[y];
        if (!Array.isArray(row)) continue;

        for (let m = 0; m < row.length; m++) {
            const b = (row[m] ?? 0) & 0xff;
            for (let bit = 0; bit < 8; bit++) {
                if ((b >> bit) & 1) {
                    const x = m * 8 + bit;
                    ctx.fillRect(x * scale, y * scale, scale, scale);
                }
            }
        }
    }

    // Food
    if (frame.food && Number.isInteger(frame.food.x) && Number.isInteger(frame.food.y)) {
        ctx.fillStyle = "#ff3355";
        ctx.fillRect(frame.food.x * scale, frame.food.y * scale, scale, scale);
    }

    // Head
    if (frame.head && Number.isInteger(frame.head.x) && Number.isInteger(frame.head.y)) {
        ctx.fillStyle = "#00aaff";
        ctx.fillRect(frame.head.x * scale, frame.head.y * scale, scale, scale);
    }

    // Info overlay
    if (info) {
        const lagMs = Math.max(0, Date.now() - (frame?.ts || Date.now()));
        const pending = stats?.pendingIPC;
        const dropped = stats?.droppedIPC;

        const pendTxt = Number.isFinite(pending) ? ` pend=${Math.trunc(pending)}` : "";
        const dropTxt = Number.isFinite(dropped) ? ` drop=${Math.trunc(dropped)}` : "";

        const live = stats
            ? `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} ` +
            `len=${stats.len} bestLen=${stats.bestLen} score=${stats.score} ` +
            `ret=${fmt(stats.epReturn, 2)} lag=${lagMs}ms ` +
            `sinceEat=${stats.sinceEat ?? "—"}` + pendTxt + dropTxt +
            `  policy(model/random)=${fmt(stats.policy?.modelFrac, 3)}/${fmt(stats.policy?.randomFrac, 3)}` +
            ` qMax=${fmt(stats.policy?.qMax, 3)} qSpread=${fmt(stats.policy?.qSpread, 3)}`
            : `lag=${lagMs}ms`;

        let memTxt = "";
        if (latestMem) {
            const tfT = Number.isFinite(latestMem.tfT) ? Math.trunc(latestMem.tfT) : "—";
            const tfMB = Number.isFinite(latestMem.tfMB) ? latestMem.tfMB.toFixed(1) : "—";
            const heapMB = Number.isFinite(latestMem.heapMB) ? latestMem.heapMB.toFixed(1) : "—";
            const rssMB = Number.isFinite(latestMem.rssMB) ? latestMem.rssMB.toFixed(1) : "—";
            const rep = Number.isFinite(latestMem.replay) ? Math.trunc(latestMem.replay) : "—";
            memTxt = `  MEM tfT=${tfT} tfMB=${tfMB} heapMB=${heapMB} rssMB=${rssMB} replay=${rep}`;
        }

        let adaptTxt = "";
        if (latestAdapt && Number.isFinite(latestAdapt.dynMaxTrainsPerSec)) {
            const tps = Math.trunc(latestAdapt.dynMaxTrainsPerSec);
            const cpu = Number.isFinite(latestAdapt.procCpuPct) ? latestAdapt.procCpuPct.toFixed(1) : "—";
            const mem = Number.isFinite(latestAdapt.memUsedPct) ? latestAdapt.memUsedPct.toFixed(1) : "—";
            const tmp = Number.isFinite(latestAdapt.tempC) ? latestAdapt.tempC.toFixed(1) : "—";
            adaptTxt = ` | adapt tps=${tps} cpu=${cpu}% mem=${mem}% temp=${tmp}°C`;
        }

        let trainerTxt = "";
        const tr = stats?.trainer;
        if (tr) {
            trainerTxt =
                ` | trainer conn=${tr.connected ? "yes" : "no"}` +
                ` replay=${tr.replayN ?? "—"}` +
                ` trains=${tr.trains ?? "—"}` +
                ` tps=${tr.tps ?? "—"}` +
                ` loss=${Number.isFinite(tr.lossEma) ? tr.lossEma.toFixed(6) : "—"}` +
                ` td=${Number.isFinite(tr.tdAbsEma) ? tr.tdAbsEma.toFixed(6) : "—"}` +
                ` err=${tr.trainErrors ?? "—"}`;
        }

        const progress =
            hist.len.length
                ? ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
                `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`
                : "";

        info.textContent = live + memTxt + adaptTxt + trainerTxt + progress;
    }
}

// ------- message unwrap (robust) -------
function unwrap(msg) {
    if (!msg) return null;

    const topic = msg.topic;
    const payload = msg.payload;

    // Direct formats
    if (topic === "max7219/frame" && payload?.rows) return { topic, frame: payload, stats: msg.stats };
    if (topic === "snake/episode" && payload) return { topic, payload };
    if (topic === "snake/info" && payload) return { topic, payload };
    if (topic === "snake/error" && payload) return { topic, payload };
    if (topic === "snake/trainer_stdout" && payload) return { topic, payload };
    if (topic === "snake/trainer_stderr" && payload) return { topic, payload };

    // sys metrics accepted
    if ((topic === "sys/stats" || topic === "system/stats" || topic === "host/stats" || topic === "sys/metrics") && payload) {
        return { topic: "sys/metrics", payload };
    }

    // Nested formats
    const o = payload;
    if (o?.topic === "max7219/frame" && o?.payload?.rows) return { topic: o.topic, frame: o.payload, stats: o.stats };
    if (o?.topic === "snake/episode" && o?.payload) return { topic: o.topic, payload: o.payload };
    if (o?.topic === "snake/info" && o?.payload) return { topic: o.topic, payload: o.payload };
    if (o?.topic === "snake/error" && o?.payload) return { topic: o.topic, payload: o.payload };
    if (o?.topic === "snake/trainer_stdout" && o?.payload) return { topic: o.topic, payload: o.payload };
    if (o?.topic === "snake/trainer_stderr" && o?.payload) return { topic: o.topic, payload: o.payload };

    if ((o?.topic === "sys/stats" || o?.topic === "system/stats" || o?.topic === "host/stats" || o?.topic === "sys/metrics") && o?.payload) {
        return { topic: "sys/metrics", payload: o.payload };
    }

    return null;
}

function handleEpisode(ep) {
    if (!ep) return;

    if (Number.isFinite(ep.len)) best.len = Math.max(best.len, ep.len);
    if (Number.isFinite(ep.score)) best.score = Math.max(best.score, ep.score);
    if (Number.isFinite(ep.epReturn)) best.ret = Math.max(best.ret, ep.epReturn);

    if (Number.isFinite(ep.len)) pushHist(hist.len, ep.len);
    if (Number.isFinite(ep.score)) pushHist(hist.score, ep.score);
    if (Number.isFinite(ep.epReturn)) pushHist(hist.ret, ep.epReturn);
}

function normalizeTrainerMem(p) {
    const tfT = p.tfNumTensors ?? p.tfT ?? p.tfTensors ?? null;
    const tfMB = p.tfNumBytesMB ?? p.tfMB ?? p.tfMemMB ?? null;
    const heapMB = p.heapUsedMB ?? p.heapMB ?? null;
    const rssMB = p.rssMB ?? p.rss ?? null;
    const replay = p.replayN ?? p.replay ?? null;
    const ts = p.ts ?? Date.now();

    return {
        tfT: Number.isFinite(tfT) ? tfT : null,
        tfMB: Number.isFinite(tfMB) ? tfMB : null,
        heapMB: Number.isFinite(heapMB) ? heapMB : null,
        rssMB: Number.isFinite(rssMB) ? rssMB : null,
        replay: Number.isFinite(replay) ? replay : null,
        ts: Number.isFinite(ts) ? ts : Date.now(),
    };
}

function handleInfoPayload(p) {
    if (!p) return;

    if (p.msg === "mem") {
        latestMem = normalizeTrainerMem(p);
        updateMemHud();
        if (latestFrame) scheduleDraw();
        return;
    }

    if (p.msg === "adapt") {
        latestAdapt = {
            dynMaxTrainsPerSec: Number.isFinite(p.dynMaxTrainsPerSec) ? p.dynMaxTrainsPerSec : null,
            procCpuPct: Number.isFinite(p.procCpuPct) ? p.procCpuPct : null,
            memUsedPct: Number.isFinite(p.memUsedPct) ? p.memUsedPct : null,
            tempC: Number.isFinite(p.tempC) ? p.tempC : null,
            ts: Date.now(),
        };
        if (latestFrame) scheduleDraw();
        return;
    }

    // optional: show checkpoint/model events in logs
    if (p.msg) {
        appendLog(`info: ${JSON.stringify(p).slice(0, 400)}`);
    }
}

function handleSysMetricsPayload(p) {
    if (!p) return;

    const ts = p.ts ?? Date.now();
    const cpuPct = p.cpuPct ?? p.cpu ?? p.cpu_percent ?? null;
    const memPct = p.memPct ?? p.memUsedPct ?? p.mem ?? p.ramPct ?? null;
    const memUsedMB = p.memUsedMB ?? p.ramUsedMB ?? p.usedMB ?? null;
    const memTotalMB = p.memTotalMB ?? p.ramTotalMB ?? p.totalMB ?? null;
    const tempC = p.tempC ?? p.temp ?? p.temperature ?? null;

    latestSys = {
        ts: Number.isFinite(ts) ? ts : Date.now(),
        cpuPct: Number.isFinite(cpuPct) ? cpuPct : null,
        memPct: Number.isFinite(memPct) ? memPct : null,
        memUsedMB: Number.isFinite(memUsedMB) ? memUsedMB : null,
        memTotalMB: Number.isFinite(memTotalMB) ? memTotalMB : null,
        tempC: Number.isFinite(tempC) ? tempC : null,
    };

    updateSysHud();
}

// ------- logs -------
function appendLog(line) {
    if (!elLogs) return;
    const t = new Date().toLocaleTimeString();
    const cur = elLogs.textContent || "";
    const next = `${cur}${cur ? "\n" : ""}[${t}] ${line}`;
    // keep last ~200 lines
    const lines = next.split("\n");
    elLogs.textContent = lines.slice(Math.max(0, lines.length - 200)).join("\n");
    elLogs.scrollTop = elLogs.scrollHeight;
}

// ------- smooth rendering -------
let scheduled = false;
function scheduleDraw() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        if (!latestFrame) return;

        // snapshot trainer stats for HUD
        const tr = latestFrame.stats?.trainer;
        if (tr) {
            latestTrainer = { ...tr, _seenAt: Date.now() - (tr.ageMs ?? 0) };
            updateTrainingHud();
        }

        drawFrame(latestFrame.frame, latestFrame.stats);
    });
}

// ------- start after DOM is ready -------
document.addEventListener("DOMContentLoaded", () => {
    if (!initDom()) return;

    console.log("UI ready: waiting for messages…");

    // age/dot ticking even if messages pause
    setInterval(() => {
        updateSysHud();
        updateMemHud();
        updateTrainingHud();
    }, 500);

    uibuilder.onChange("msg", (msg) => {
        const u = unwrap(msg);
        if (!u) return;

        if (u.topic === "max7219/frame") {
            latestFrame = { frame: u.frame, stats: u.stats };
            scheduleDraw();
            return;
        }

        if (u.topic === "snake/episode") {
            handleEpisode(u.payload);
            if (latestFrame) scheduleDraw();
            return;
        }

        if (u.topic === "snake/info") {
            handleInfoPayload(u.payload);
            return;
        }

        if (u.topic === "snake/error") {
            appendLog(`ERROR: ${JSON.stringify(u.payload).slice(0, 500)}`);
            return;
        }
        if (u.topic === "snake/trainer_stdout") {
            appendLog(`trainer out: ${String(u.payload).trim().slice(0, 500)}`);
            return;
        }
        if (u.topic === "snake/trainer_stderr") {
            appendLog(`trainer err: ${String(u.payload).trim().slice(0, 500)}`);
            return;
        }

        if (u.topic === "sys/metrics") {
            handleSysMetricsPayload(u.payload);
            return;
        }
    });
});