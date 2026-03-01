/* global uibuilder */
"use strict";

/**
 * FIX für deinen Node-RED Flow:
 * Bei dir kommt in uibuilder typischerweise:
 *   msg.payload = { topic:"snake/info", payload:{...}, stats:{...} }
 * (weil Switch auf payload.topic prüft)  :contentReference[oaicite:1]{index=1}
 *
 * Diese UI:
 * - entpackt Wrapper automatisch
 * - nimmt sys-metrics.js Output (payload enthält procCpuPct/memUsedPct/tempC) als "System/adapt"
 * - füllt System / Trainer Memory / Log zuverlässig
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
        ctx.fillStyle = "rgba(88, 166, 255, 0.95)";
        ctx.fillRect(head.x * CELL, head.y * CELL, CELL - 1, CELL - 1);
    }
}

// ---------- LOG ----------
const LOG_MAX = 450;
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
    // auto-scroll
    logEl.scrollTop = logEl.scrollHeight;
}
if (logClearBtn) {
    logClearBtn.addEventListener("click", () => {
        logLines.length = 0;
        logEl.textContent = "Log geleert.";
        lastLogAt = Date.now();
        logMetaEl.textContent = "0 lines";
    });
}

// ---------- STATE ----------
let lastFrameTs = 0;
let lastStats = null;

// comes from snake/info {msg:"mem", ...}
let lastTrainerMem = null;

// comes from snake/info {msg:"adapt", procCpuPct, memUsedPct, tempC}
let lastAdapt = null;

// sys-metrics.js output often comes without topic; we accept it too
let lastSysMetrics = null;

// ---------- NORMALIZATION (wichtig für deinen Flow) ----------
function isWrapperPayload(p) {
    // wrapper shape: {topic:"...", payload:..., stats:...}
    return p && typeof p === "object" && typeof p.topic === "string" && ("payload" in p);
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
        // still treat as wrapper-ish
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

// ---------- HUD UPDATES ----------
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
    lines.push(`Return: ${lastStats.epReturn != null ? lastStats.epReturn.toFixed(2) : "—"}  FoodDist: ${lastStats.foodDist != null ? lastStats.foodDist.toFixed(3) : "—"}`);
    lines.push(`ε: ${lastStats.eps != null ? lastStats.eps.toFixed(3) : "—"}  ε(train): ${lastStats.epsTrain != null ? lastStats.epsTrain.toFixed(3) : "—"}`);

    const t = lastStats.trainer || {};
    lines.push("");
    lines.push(`Trainer: ${t.connected ? "connected" : "disconnected"}  Replay ${fmtNum(t.replayN)}  Trains ${fmtNum(t.trains)}  Errors ${fmtNum(t.trainErrors)}`);
    lines.push(`LossEMA ${t.lossEma ?? "—"}  TD-EMA ${t.tdAbsEma ?? "—"}  Temp ${t.tempC != null ? t.tempC.toFixed(1) + "°C" : "—"}`);

    infoEl.textContent = lines.join("\n");
}

function updateSystemHud() {
    const now = Date.now();
    const age = now - (lastFrameTs || now);
    $("sysAge") && ($("sysAge").textContent = fmtAge(age));

    // prefer: adapt
    const cpuPct = lastAdapt?.procCpuPct ?? lastSysMetrics?.procCpuPct ?? null;
    const memUsedPct = lastAdapt?.memUsedPct ?? lastSysMetrics?.memUsedPct ?? null;

    // temp: prefer adapt/sys-metrics, fallback stats.trainer.tempC
    const tempC = (lastAdapt?.tempC ?? lastSysMetrics?.tempC ?? lastStats?.trainer?.tempC ?? null);

    $("sysCpuVal") && ($("sysCpuVal").textContent = cpuPct == null ? "—" : `${cpuPct.toFixed(1)}%`);
    setBar($("sysCpuBar"), cpuPct == null ? 0 : cpuPct, cpuPct != null && cpuPct > 70 ? "warn" : "ok");

    $("sysMemVal") && ($("sysMemVal").textContent = memUsedPct == null ? "—" : `${memUsedPct.toFixed(1)}%`);
    $("sysMemMB") && ($("sysMemMB").textContent = lastTrainerMem?.rssMB != null ? `RSS ${fmtMB(lastTrainerMem.rssMB)}` : "—");
    setBar($("sysMemBar"), memUsedPct == null ? 0 : memUsedPct, memUsedPct != null && memUsedPct > 85 ? "warn" : "ok");

    $("sysTempVal") && ($("sysTempVal").textContent = tempC == null ? "—" : `${tempC.toFixed(1)}°C`);
    const tempPct = tempC == null ? 0 : Math.max(0, Math.min(100, ((tempC - 40) / 45) * 100));
    const tempLevel = tempC == null ? "muted" : (tempC >= 82 ? "bad" : tempC >= 75 ? "warn" : "ok");
    setBar($("sysTempBar"), tempPct, tempLevel);

    const fresh = (now - lastFrameTs) < 2500;
    setDot($("sysDot"), fresh ? tempLevel : "muted");
    $("sysStatus") && ($("sysStatus").textContent = fresh ? "live" : "keine Daten");
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

function updateTrainHud() {
    const t = lastStats?.trainer || {};
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

    $("trainEpsVal") && ($("trainEpsVal").textContent = lastStats?.eps == null ? "—" : `ε ${lastStats.eps.toFixed(3)}`);
    $("trainEpsTrainVal") && ($("trainEpsTrainVal").textContent = lastStats?.epsTrain == null ? "—" : `train ${lastStats.epsTrain.toFixed(3)}`);
    setBar($("trainEpsBar"), lastStats?.eps == null ? 0 : lastStats.eps * 100, lastStats?.eps != null && lastStats.eps > 0.4 ? "cold" : "ok");

    const hot = (t.tempC != null && t.tempC >= 82) || !!t.pausedHot;
    let level = t.connected ? "ok" : "muted";
    let text = t.connected ? "live" : "kein Trainer";
    if (hot) { level = t.pausedHot ? "bad" : "warn"; text = t.pausedHot ? "Thermal Pause" : "Thermal nahe Limit"; }
    setDot($("trainDot"), level);
    $("trainStatus") && ($("trainStatus").textContent = text);
}

function updateQualityHud() {
    const now = Date.now();
    $("qualAge") && ($("qualAge").textContent = fmtAge(now - (lastFrameTs || now)));

    const pol = lastStats?.policy || {};
    const modelFrac = pol.modelFrac;
    const randomFrac = pol.randomFrac;

    $("qualModelFrac") && ($("qualModelFrac").textContent = modelFrac == null ? "—" : `Model ${(modelFrac * 100).toFixed(1)}%`);
    $("qualRandomFrac") && ($("qualRandomFrac").textContent = randomFrac == null ? "—" : `Random ${(randomFrac * 100).toFixed(1)}%`);
    setBar($("qualModelBar"), modelFrac == null ? 0 : modelFrac * 100, modelFrac != null && modelFrac < 0.5 ? "cold" : "ok");

    $("qualQMax") && ($("qualQMax").textContent = pol.qMax == null ? "—" : `Qmax ${pol.qMax.toFixed(3)}`);
    $("qualQSpread") && ($("qualQSpread").textContent = pol.qSpread == null ? "—" : `spread ${pol.qSpread.toFixed(3)}`);

    $("qualLen") && ($("qualLen").textContent = lastStats?.len == null ? "—" : `Len ${fmtNum(lastStats.len)}`);
    $("qualBestLen") && ($("qualBestLen").textContent = lastStats?.bestLen == null ? "—" : `Best ${fmtNum(lastStats.bestLen)}`);

    const lenPct = (lastStats?.len == null) ? 0 : Math.max(0, Math.min(100, (lastStats.len / (W * H)) * 100));
    setBar($("qualLenBar"), lenPct, lenPct > 70 ? "ok" : "cold");

    $("qualReturn") && ($("qualReturn").textContent = lastStats?.epReturn == null ? "—" : lastStats.epReturn.toFixed(2));

    const ok = (now - lastFrameTs) < 2500;
    setDot($("qualDot"), ok ? "ok" : "muted");
    $("qualStatus") && ($("qualStatus").textContent = ok ? "live" : "warte…");
}

// ---------- BOOT ----------
function boot() {
    clearCanvas();
    infoEl.textContent = "UI gestartet. Warte auf Daten…";
    logEl.textContent = "Noch keine Log-Einträge…";
    logMetaEl.textContent = "—";

    uibuilder.start();

    uibuilder.onChange("msg", (msg) => {
        try {
            const n = normalizeInbound(msg);

            // accept sys-metrics without topic
            if (!n.topic && looksLikeSysMetrics(n.payload)) {
                lastSysMetrics = { ...n.payload, ts: Date.now() };
                pushLog("sys", JSON.stringify(lastSysMetrics));
                updateSystemHud();
                updateInfo();
                return;
            }

            // log channels (topic comes from wrapper!)
            if (n.topic === "snake/error") {
                pushLog("ERROR", typeof n.payload === "string" ? n.payload : JSON.stringify(n.payload));
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

            // info channel
            if (n.topic === "snake/info") {
                if (n.payload && typeof n.payload === "object") {
                    if (n.payload.msg === "mem") lastTrainerMem = n.payload;
                    if (n.payload.msg === "adapt") lastAdapt = n.payload;
                    pushLog("info", n.payload.msg ? `${n.payload.msg} ${JSON.stringify(n.payload)}` : JSON.stringify(n.payload));
                } else {
                    pushLog("info", String(n.payload));
                }
                updateSystemHud();
                updateMemHud();
                updateInfo();
                return;
            }

            // frame channel (topic comes from wrapper!)
            if (n.topic === "max7219/frame") {
                if (n.payload && n.payload.rows && n.payload.w === W && n.payload.h === H) {
                    drawFrame(n.payload);
                    lastFrameTs = n.payload.ts || Date.now();
                }

                if (n.stats && typeof n.stats === "object") {
                    lastStats = n.stats;
                }

                if (lastStats) {
                    updateSystemHud();
                    updateMemHud();
                    updateTrainHud();
                    updateQualityHud();
                    updateInfo();
                } else {
                    updateInfo();
                }
                return;
            }

            // anything else: keep a small trace
            if (n.topic) pushLog("msg", `${n.topic} ${typeof n.payload === "string" ? n.payload : ""}`);

        } catch (e) {
            pushLog("UI-ERR", String(e && (e.stack || e)));
        }
    });

    // heartbeat
    setInterval(() => {
        if (lastStats) {
            updateSystemHud();
            updateQualityHud();
            updateInfo();
        } else {
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