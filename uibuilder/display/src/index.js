/* global uibuilder */
"use strict";

/**
 * index.js - Snake RL Monitor UI (mit System+TrainerMem+Log)
 * Erwartete Messages (aber tolerant):
 * - max7219/frame: frame in msg.payload (oder msg.payload.payload), stats in msg.stats (oder msg.payload.stats)
 * - snake/info: payload {msg:"mem"...} oder {msg:"adapt"...} oder sonstige Info
 * - snake/error, snake/trainer_stdout, snake/trainer_stderr: log
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

// fix canvas resolution
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

    // body/grid
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = y * W + x;
            ctx.fillStyle = occ[idx] ? "rgba(53, 208, 127, 0.9)" : "rgba(255,255,255,0.03)";
            ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
        }
    }

    // food overlay
    if (food && Number.isFinite(food.x) && Number.isFinite(food.y)) {
        ctx.fillStyle = "rgba(255, 204, 102, 0.95)";
        ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 1, CELL - 1);
    }

    // head overlay
    if (head && Number.isFinite(head.x) && Number.isFinite(head.y)) {
        ctx.fillStyle = "rgba(88, 166, 255, 0.95)";
        ctx.fillRect(head.x * CELL, head.y * CELL, CELL - 1, CELL - 1);
    }
}

// ----- Log -----
const LOG_MAX = 350;
const logLines = [];
let lastLogAt = 0;

function ts() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
}

function pushLog(kind, text) {
    const line = `[${ts()}] ${kind}: ${text}`;
    logLines.push(line);
    while (logLines.length > LOG_MAX) logLines.shift();
    logEl.textContent = logLines.join("\n");
    lastLogAt = Date.now();
    logMetaEl.textContent = `${fmtNum(logLines.length)} lines • last ${fmtAge(Date.now() - lastLogAt)}`;
}

if (logClearBtn) {
    logClearBtn.addEventListener("click", () => {
        logLines.length = 0;
        logEl.textContent = "Log geleert.";
        logMetaEl.textContent = "0 lines";
    });
}

// ----- State caches -----
let lastFrameTs = 0;
let lastStats = null;

// from snake/info msg:"mem"
let lastTrainerMem = null;

// from snake/info msg:"adapt"
let lastAdapt = null;

// ----- Message normalization -----
function safeKeys(o) {
    if (!o || typeof o !== "object") return "—";
    return Object.keys(o).slice(0, 14).join(",");
}

function normalizeMsg(msg) {
    const out = { topic: null, frame: null, stats: null, payload: null, raw: msg };

    if (!msg || typeof msg !== "object") return out;

    let topic = msg.topic;
    if (!topic && msg.payload && typeof msg.payload === "object" && msg.payload.topic) topic = msg.payload.topic;
    out.topic = topic || null;

    // payload reference
    out.payload = msg.payload;

    // frame
    if (msg.payload && msg.payload.rows && msg.payload.w && msg.payload.h) out.frame = msg.payload;
    if (!out.frame && msg.payload && msg.payload.payload && msg.payload.payload.rows) out.frame = msg.payload.payload;
    if (!out.frame && msg.rows && msg.w && msg.h) out.frame = msg;

    // stats
    if (msg.stats && typeof msg.stats === "object") out.stats = msg.stats;
    if (!out.stats && msg.payload && msg.payload.stats && typeof msg.payload.stats === "object") out.stats = msg.payload.stats;

    return out;
}

// ----- HUD updates -----
function updateInfoPanel(stats) {
    const lines = [];

    // Always show where data comes from
    lines.push(`Last frame age: ${fmtAge(Date.now() - (lastFrameTs || Date.now()))}`);
    lines.push(`snake/info mem: ${lastTrainerMem ? "ja" : "nein"}   adapt: ${lastAdapt ? "ja" : "nein"}`);
    lines.push("");

    if (!stats) {
        lines.push("Keine stats im UI empfangen.");
        lines.push("Tipp: uibuilder muss msg.stats (oder payload.stats) durchreichen.");
        infoEl.textContent = lines.join("\n");
        return;
    }

    lines.push(`Episode: ${fmtNum(stats.episode)}   Steps: ${fmtNum(stats.totalSteps)}   Mode: ${stats.mode || "—"}`);
    lines.push(`Len: ${fmtNum(stats.len)}   BestLen: ${fmtNum(stats.bestLen)}   Score: ${fmtNum(stats.score)}   SinceEat: ${fmtNum(stats.sinceEat)}`);
    lines.push(`Return: ${stats.epReturn != null ? stats.epReturn.toFixed(2) : "—"}   FoodDist: ${stats.foodDist != null ? stats.foodDist.toFixed(3) : "—"}`);
    lines.push(`ε: ${stats.eps != null ? stats.eps.toFixed(3) : "—"}   ε(train): ${stats.epsTrain != null ? stats.epsTrain.toFixed(3) : "—"}`);

    const t = stats.trainer || {};
    lines.push("");
    lines.push(`Trainer: ${t.connected ? "connected" : "disconnected"} • Replay ${fmtNum(t.replayN)} • Trains ${fmtNum(t.trains)} • Errors ${fmtNum(t.trainErrors)}`);
    lines.push(`LossEMA ${t.lossEma ?? "—"} • TD-EMA ${t.tdAbsEma ?? "—"} • Temp ${t.tempC != null ? t.tempC.toFixed(1) + "°C" : "—"}`);

    infoEl.textContent = lines.join("\n");
}

function updateSystemHud(stats) {
    const now = Date.now();
    $("sysAge") && ($("sysAge").textContent = fmtAge(now - (lastFrameTs || now)));

    // Best source: adapt message (CPU/Mem/Temp)
    const cpuPct = lastAdapt?.procCpuPct;
    const memUsedPct = lastAdapt?.memUsedPct;
    const tempC_adapt = lastAdapt?.tempC;

    // Fallback temp from stats.trainer.tempC
    const tempC = Number.isFinite(tempC_adapt) ? tempC_adapt : (stats?.trainer?.tempC);

    // CPU
    $("sysCpuVal") && ($("sysCpuVal").textContent = cpuPct == null ? "—" : `${cpuPct.toFixed(1)}%`);
    setBar($("sysCpuBar"), cpuPct == null ? 0 : cpuPct, cpuPct != null && cpuPct > 70 ? "warn" : "ok");

    // RAM (system percent)
    $("sysMemVal") && ($("sysMemVal").textContent = memUsedPct == null ? "—" : `${memUsedPct.toFixed(1)}%`);
    $("sysMemMB") && ($("sysMemMB").textContent = lastTrainerMem?.rssMB != null ? `RSS ${fmtMB(lastTrainerMem.rssMB)}` : "—");
    setBar($("sysMemBar"), memUsedPct == null ? 0 : memUsedPct, memUsedPct != null && memUsedPct > 85 ? "warn" : "ok");

    // Temp
    $("sysTempVal") && ($("sysTempVal").textContent = tempC == null ? "—" : `${tempC.toFixed(1)}°C`);
    const tempPct = tempC == null ? 0 : Math.max(0, Math.min(100, ((tempC - 40) / 45) * 100));
    const tempLevel = tempC == null ? "muted" : (tempC >= 82 ? "bad" : tempC >= 75 ? "warn" : "ok");
    setBar($("sysTempBar"), tempPct, tempLevel);

    const fresh = (now - lastFrameTs) < 2500;
    setDot($("sysDot"), fresh ? tempLevel : "muted");

    let status = fresh ? "live" : "keine Daten";
    if (fresh && !lastAdapt) status = "live (ohne adapt)";
    $("sysStatus") && ($("sysStatus").textContent = status);
}

function updateMemHud() {
    const now = Date.now();
    const age = lastTrainerMem?.ts ? (now - lastTrainerMem.ts) : null;
    $("memAge") && ($("memAge").textContent = fmtAge(age));

    const tfTensors = lastTrainerMem?.tfNumTensors;
    const tfMB = lastTrainerMem?.tfNumBytesMB;
    const heapMB = lastTrainerMem?.heapUsedMB;
    const rssMB = lastTrainerMem?.rssMB;

    $("memTfTensorsVal") && ($("memTfTensorsVal").textContent = tfTensors == null ? "—" : fmtNum(tfTensors));
    $("memTfMemVal") && ($("memTfMemVal").textContent = tfMB == null ? "—" : fmtMB(tfMB));
    $("memHeapVal") && ($("memHeapVal").textContent = heapMB == null ? "—" : fmtMB(heapMB));
    $("memRssVal") && ($("memRssVal").textContent = rssMB == null ? "—" : fmtMB(rssMB));

    const tfPct = tfMB == null ? 0 : Math.max(0, Math.min(100, (tfMB / 1400) * 100));
    const heapPct = heapMB == null ? 0 : Math.max(0, Math.min(100, (heapMB / 1000) * 100));
    const rssPct = rssMB == null ? 0 : Math.max(0, Math.min(100, (rssMB / 2500) * 100));

    setBar($("memTfBar"), tfPct, tfPct > 85 ? "warn" : "ok");
    setBar($("memHeapBar"), heapPct, heapPct > 85 ? "warn" : "ok");
    setBar($("memRssBar"), rssPct, rssPct > 90 ? "warn" : "ok");

    const ok = (age != null && age < 4000);
    setDot($("memDot"), ok ? "ok" : "muted");
    $("memStatus") && ($("memStatus").textContent = ok ? "live" : "warte…");
}

function updateTrainHud(stats) {
    const t = stats?.trainer || {};
    $("trainAge") && ($("trainAge").textContent = fmtAge(t.ageMs));

    $("trainReplayVal") && ($("trainReplayVal").textContent = t.replayN == null ? "—" : fmtNum(t.replayN));
    $("trainTrainsVal") && ($("trainTrainsVal").textContent = t.trains == null ? "—" : fmtNum(t.trains));

    $("trainAttemptsVal") && ($("trainAttemptsVal").textContent = t.trainAttempts == null ? "—" : fmtNum(t.trainAttempts));
    $("trainErrorsVal") && ($("trainErrorsVal").textContent = t.trainErrors == null ? "—" : `Errors ${fmtNum(t.trainErrors)}`);

    $("trainLossVal") && ($("trainLossVal").textContent = t.lossEma == null ? "—" : String(t.lossEma));
    $("trainTdVal") && ($("trainTdVal").textContent = t.tdAbsEma == null ? "—" : String(t.tdAbsEma));

    const loss = (t.lossEma == null) ? null : Number(t.lossEma);
    const lossPct = loss == null ? 0 : Math.max(0, Math.min(100, (loss / 0.02) * 100));
    setBar($("trainLossBar"), lossPct, lossPct > 85 ? "warn" : "ok");

    const td = (t.tdAbsEma == null) ? null : Number(t.tdAbsEma);
    const tdPct = td == null ? 0 : Math.max(0, Math.min(100, (td / 0.3) * 100));
    setBar($("trainTdBar"), tdPct, tdPct > 90 ? "warn" : "ok");

    $("trainEpsVal") && ($("trainEpsVal").textContent = stats.eps == null ? "—" : `ε ${stats.eps.toFixed(3)}`);
    $("trainEpsTrainVal") && ($("trainEpsTrainVal").textContent = stats.epsTrain == null ? "—" : `train ${stats.epsTrain.toFixed(3)}`);
    setBar($("trainEpsBar"), stats.eps == null ? 0 : stats.eps * 100, stats.eps != null && stats.eps > 0.4 ? "cold" : "ok");

    const hot = (t.tempC != null && t.tempC >= 82) || !!t.pausedHot;
    let level = t.connected ? "ok" : "muted";
    let text = t.connected ? "live" : "kein Trainer";
    if (hot) { level = t.pausedHot ? "bad" : "warn"; text = t.pausedHot ? "Thermal Pause" : "Thermal nahe Limit"; }
    setDot($("trainDot"), level);
    $("trainStatus") && ($("trainStatus").textContent = text);
}

function updateQualityHud(stats) {
    const now = Date.now();
    $("qualAge") && ($("qualAge").textContent = fmtAge(now - (lastFrameTs || now)));

    const pol = stats?.policy || {};
    const modelFrac = pol.modelFrac;
    const randomFrac = pol.randomFrac;

    $("qualModelFrac") && ($("qualModelFrac").textContent = modelFrac == null ? "—" : `Model ${(modelFrac * 100).toFixed(1)}%`);
    $("qualRandomFrac") && ($("qualRandomFrac").textContent = randomFrac == null ? "—" : `Random ${(randomFrac * 100).toFixed(1)}%`);
    setBar($("qualModelBar"), modelFrac == null ? 0 : modelFrac * 100, modelFrac != null && modelFrac < 0.5 ? "cold" : "ok");

    $("qualQMax") && ($("qualQMax").textContent = pol.qMax == null ? "—" : `Qmax ${pol.qMax.toFixed(3)}`);
    $("qualQSpread") && ($("qualQSpread").textContent = pol.qSpread == null ? "—" : `spread ${pol.qSpread.toFixed(3)}`);

    $("qualLen") && ($("qualLen").textContent = stats.len == null ? "—" : `Len ${fmtNum(stats.len)}`);
    $("qualBestLen") && ($("qualBestLen").textContent = stats.bestLen == null ? "—" : `Best ${fmtNum(stats.bestLen)}`);

    const lenPct = (stats.len == null) ? 0 : Math.max(0, Math.min(100, (stats.len / (W * H)) * 100));
    setBar($("qualLenBar"), lenPct, lenPct > 70 ? "ok" : "cold");

    $("qualReturn") && ($("qualReturn").textContent = stats.epReturn == null ? "—" : stats.epReturn.toFixed(2));

    const ok = (now - lastFrameTs) < 2500;
    setDot($("qualDot"), ok ? "ok" : "muted");
    $("qualStatus") && ($("qualStatus").textContent = ok ? "live" : "warte…");
}

// ----- Boot -----
function boot() {
    clearCanvas();
    infoEl.textContent = "UI gestartet. Warte auf Daten…";
    logEl.textContent = "Noch keine Log-Einträge…";
    logMetaEl.textContent = "—";

    uibuilder.start();

    uibuilder.onChange("msg", (msg) => {
        const n = normalizeMsg(msg);

        // Logging for these topics
        if (n.topic === "snake/error") {
            const p = n.payload;
            pushLog("ERROR", typeof p === "string" ? p : JSON.stringify(p));
            return;
        }
        if (n.topic === "snake/trainer_stdout") {
            pushLog("trainer", String(n.payload ?? ""));
            return;
        }
        if (n.topic === "snake/trainer_stderr") {
            pushLog("trainer!", String(n.payload ?? ""));
            return;
        }
        if (n.topic === "snake/info") {
            const p = n.payload;

            // mem/adapt caches
            if (p && typeof p === "object" && p.msg === "mem") {
                lastTrainerMem = p;
            }
            if (p && typeof p === "object" && p.msg === "adapt") {
                lastAdapt = p;
            }

            // Put general info into log (but keep it readable)
            if (p && typeof p === "object") {
                const brief = p.msg ? `${p.msg} ${JSON.stringify(p)}` : JSON.stringify(p);
                pushLog("info", brief);
            } else {
                pushLog("info", String(p));
            }
            return;
        }

        // Frame handling
        if (n.topic === "max7219/frame" || n.frame) {
            if (n.frame && n.frame.w === W && n.frame.h === H) {
                drawFrame(n.frame);
                lastFrameTs = n.frame.ts || Date.now();
            }

            if (n.stats && typeof n.stats === "object") {
                lastStats = n.stats;
            }

            if (lastStats) {
                updateInfoPanel(lastStats);
                updateSystemHud(lastStats);
                updateMemHud();
                updateTrainHud(lastStats);
                updateQualityHud(lastStats);
            } else {
                // At least show that frames arrive
                infoEl.textContent =
                    `Frames kommen an (topic=${n.topic || "—"}), aber keine stats.\n` +
                    `Root keys: ${safeKeys(msg)}\nPayload keys: ${safeKeys(msg?.payload)}\n`;
            }
            return;
        }

        // Unknown message: keep a tiny hint in log (low noise)
        pushLog("msg", `topic=${n.topic || "—"} keys=${safeKeys(msg)} payloadKeys=${safeKeys(msg?.payload)}`);
    });

    // heartbeat for stale statuses
    setInterval(() => {
        if (lastStats) {
            updateSystemHud(lastStats);
            updateQualityHud(lastStats);
        } else {
            // show stale in dots if nothing yet
            setDot($("sysDot"), "muted");
            setDot($("memDot"), "muted");
            setDot($("trainDot"), "muted");
            setDot($("qualDot"), "muted");
        }

        if (logMetaEl && lastLogAt) {
            logMetaEl.textContent = `${fmtNum(logLines.length)} lines • last ${fmtAge(Date.now() - lastLogAt)}`;
        }
    }, 1000);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}