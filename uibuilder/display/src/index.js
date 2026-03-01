/* global uibuilder */
"use strict";

/**
 * Ultra-robustes uibuilder UI:
 * - akzeptiert viele msg-Formen (topic oben, topic in payload, frame direkt im payload)
 * - zeigt Debug im Info-Feld (letzte Nachricht) statt "nichts"
 * - zeichnet immer dann, wenn irgendwo rows/w/h auftauchen
 */

const canvas = document.getElementById("matrix");
const infoEl = document.getElementById("info");
const ctx = canvas.getContext("2d", { alpha: false });

const W = 32;
const H = 8;

// Canvas fix (falls CSS width:100% skaliert)
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

    // draw cells
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = y * W + x;
            if (occ[idx]) {
                ctx.fillStyle = "rgba(53, 208, 127, 0.9)"; // body
            } else {
                ctx.fillStyle = "rgba(255,255,255,0.03)";
            }
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

// HUD state
let lastFrameTs = 0;
let lastStats = null;
let lastTrainerMem = null;

// ---- Extract helpers (handle many msg shapes) ----
function safeKeys(o) {
    if (!o || typeof o !== "object") return "";
    return Object.keys(o).slice(0, 12).join(",");
}

function normalizeMsg(msg) {
    // returns { topic, frame, stats, infoPayload, raw }
    const out = { topic: null, frame: null, stats: null, infoPayload: null, raw: msg };

    if (!msg || typeof msg !== "object") return out;

    // Common: msg.topic on root
    let topic = msg.topic;

    // Sometimes: msg.payload.topic exists (wrapped)
    if (!topic && msg.payload && typeof msg.payload === "object" && msg.payload.topic) {
        topic = msg.payload.topic;
    }

    out.topic = topic || null;

    // Frame candidates:
    // 1) root payload is frame
    if (msg.payload && msg.payload.rows && msg.payload.w && msg.payload.h) {
        out.frame = msg.payload;
    }

    // 2) wrapped: msg.payload.payload is frame
    if (!out.frame && msg.payload && msg.payload.payload && msg.payload.payload.rows) {
        out.frame = msg.payload.payload;
    }

    // 3) sometimes whole msg IS the frame
    if (!out.frame && msg.rows && msg.w && msg.h) {
        out.frame = msg;
    }

    // Stats candidates:
    // 1) root stats
    if (msg.stats && typeof msg.stats === "object") out.stats = msg.stats;

    // 2) wrapped stats
    if (!out.stats && msg.payload && msg.payload.stats && typeof msg.payload.stats === "object") out.stats = msg.payload.stats;

    // info payload (trainer mem messages etc.)
    if (out.topic === "snake/info") {
        out.infoPayload = msg.payload;
    } else if (msg.payload && msg.payload.topic === "snake/info") {
        out.infoPayload = msg.payload.payload || msg.payload; // tolerate wrapper
    }

    return out;
}

// ---- HUD updates (keep compatible with your existing HUD elements) ----
function updateInfoPanel(textLines) {
    infoEl.textContent = textLines.join("\n");
}

function updateSystemHud(stats) {
    const t = stats?.trainer || {};
    const now = Date.now();

    const sysAge = now - (lastFrameTs || now);
    $("sysAge") && ($("sysAge").textContent = fmtAge(sysAge));

    const tempC = t.tempC;
    $("sysTempVal") && ($("sysTempVal").textContent = tempC == null ? "—" : `${tempC.toFixed(1)}°C`);

    let tempPct = 0;
    let tempLevel = "ok";
    if (Number.isFinite(tempC)) {
        tempPct = Math.max(0, Math.min(100, ((tempC - 40) / 45) * 100));
        if (tempC >= 82) tempLevel = "bad";
        else if (tempC >= 75) tempLevel = "warn";
    }
    setBar($("sysTempBar"), tempPct, tempLevel);

    // we don't have CPU% unless you pipe it; show IPC load instead in sysCpu
    $("sysCpuVal") && ($("sysCpuVal").textContent = stats.pendingIPC != null ? `IPC ${fmtNum(stats.pendingIPC)}` : "—");
    setBar($("sysCpuBar"), stats.pendingIPC != null ? Math.min(100, (stats.pendingIPC / 2000) * 100) : 0, "cold");

    // memory line from trainer mem (if available)
    if (lastTrainerMem) {
        const heap = lastTrainerMem.heapUsedMB;
        const rss = lastTrainerMem.rssMB;
        $("sysMemVal") && ($("sysMemVal").textContent =
            `${heap != null ? "Heap " + fmtMB(heap) : ""}${(heap != null && rss != null) ? " / " : ""}${rss != null ? "RSS " + fmtMB(rss) : ""}` || "—"
        );
        $("sysMemMB") && ($("sysMemMB").textContent = "");
        const rssPct = rss == null ? 0 : Math.max(0, Math.min(100, (rss / 2500) * 100));
        setBar($("sysMemBar"), rssPct, rssPct > 90 ? "warn" : "ok");
    } else {
        $("sysMemVal") && ($("sysMemVal").textContent = "—");
        $("sysMemMB") && ($("sysMemMB").textContent = "—");
        setBar($("sysMemBar"), 0, "ok");
    }

    const ok = (now - lastFrameTs) < 2000;
    setDot($("sysDot"), ok ? tempLevel : "muted");
    $("sysStatus") && ($("sysStatus").textContent = ok ? "live" : "keine Daten");
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
    const now = Date.now();
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
    if (hot) { level = "warn"; text = t.pausedHot ? "Thermal Pause" : "Thermal nahe Limit"; }
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

    const ok = (now - lastFrameTs) < 2000;
    setDot($("qualDot"), ok ? "ok" : "muted");
    $("qualStatus") && ($("qualStatus").textContent = ok ? "live" : "warte…");
}

// ---- Start uibuilder ----
function boot() {
    clearCanvas();
    updateInfoPanel([
        "UI gestartet.",
        "Warte auf Daten…",
        "",
        "Debug-Tipp: Öffne Browser-Konsole (F12) → dort siehst du, ob Messages reinkommen."
    ]);

    try {
        uibuilder.start();
    } catch (e) {
        updateInfoPanel([
            "FEHLER: uibuilder.start() fehlgeschlagen",
            String(e && (e.stack || e)),
            "",
            "Prüfe: script src ../uibuilder/uibuilder.iife.min.js"
        ]);
        return;
    }

    uibuilder.onChange("msg", (msg) => {
        try {
            const n = normalizeMsg(msg);

            // Debug in console
            console.log("uibuilder msg:", msg);

            // Show last received meta ALWAYS (so you never get 'black hole' again)
            const debugLines = [
                `Last msg topic: ${n.topic || "—"}`,
                `Root keys: ${safeKeys(msg) || "—"}`,
                `Payload keys: ${safeKeys(msg?.payload) || "—"}`,
                `Has frame: ${n.frame ? "ja" : "nein"}   Has stats: ${n.stats ? "ja" : "nein"}`,
            ];

            // Handle trainer mem info
            if (n.topic === "snake/info" && n.infoPayload && n.infoPayload.msg === "mem") {
                lastTrainerMem = n.infoPayload;
                debugLines.push("Trainer mem update: ja");
            }

            // Handle frame
            if (n.frame && n.frame.w === W && n.frame.h === H) {
                drawFrame(n.frame);
                lastFrameTs = n.frame.ts || Date.now();
                debugLines.push(`Frame ts age: ${fmtAge(Date.now() - lastFrameTs)}`);
            }

            // Handle stats (prefer newest)
            if (n.stats && typeof n.stats === "object") {
                lastStats = n.stats;
            }

            // Update HUDs if we have stats
            if (lastStats) {
                updateSystemHud(lastStats);
                updateMemHud();
                updateTrainHud(lastStats);
                updateQualityHud(lastStats);

                debugLines.push("");
                debugLines.push(`Episode: ${fmtNum(lastStats.episode)}  Steps: ${fmtNum(lastStats.totalSteps)}  Mode: ${lastStats.mode || "—"}`);
                debugLines.push(`Len: ${fmtNum(lastStats.len)}  BestLen: ${fmtNum(lastStats.bestLen)}  ε: ${lastStats.eps != null ? lastStats.eps.toFixed(3) : "—"}`);
                const t = lastStats.trainer || {};
                debugLines.push(`Replay: ${fmtNum(t.replayN)}  Trains: ${fmtNum(t.trains)}  Errors: ${fmtNum(t.trainErrors)}  Temp: ${t.tempC != null ? t.tempC.toFixed(1) + "°C" : "—"}`);
            }

            updateInfoPanel(debugLines);
        } catch (e) {
            updateInfoPanel([
                "UI FEHLER beim Verarbeiten der Nachricht:",
                String(e && (e.stack || e)),
                "",
                "Wenn das hier erscheint: Topic/Payload passt, aber JS crashed irgendwo."
            ]);
            console.error(e);
        }
    });

    // heartbeat: stale indicator
    setInterval(() => {
        if (lastStats) {
            updateSystemHud(lastStats);
            updateQualityHud(lastStats);
        }
    }, 1000);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}