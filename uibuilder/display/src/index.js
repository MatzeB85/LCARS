/* global uibuilder */
"use strict";

/**
 * index.js - Snake RL Monitor UI
 * - Draws 32x8 matrix as scaled grid
 * - Shows rich HUD stats (system, memory, training, policy quality)
 * - Works with runner output topic "max7219/frame" containing payload+stats
 */

const canvas = document.getElementById("matrix");
const infoEl = document.getElementById("info");

const ctx = canvas.getContext("2d", { alpha: false });

const W = 32;
const H = 8;

// UI tuning
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

function fmtPct(x, digits = 0) {
    if (x == null || !Number.isFinite(x)) return "—";
    return `${x.toFixed(digits)}%`;
}

function fmtMB(x) {
    if (x == null || !Number.isFinite(x)) return "—";
    return `${x.toFixed(0)} MB`;
}

function setDot(dotEl, level) {
    // level: "ok" | "warn" | "bad" | "cold" | "muted"
    const map = {
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
        cold: "var(--cold)",
        muted: "var(--muted2)",
    };
    dotEl.style.background = map[level] || map.muted;
}

function setBar(barEl, pct, level) {
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

    // frame: {w,h,rows,head,food}
    // rows: H x 4 bytes (bitset 32)
    // We'll draw: snake body = green, head = cold blue, food = warn
    const rows = frame?.rows;
    const head = frame?.head;
    const food = frame?.food;

    // build occupancy
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

    // draw grid
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = y * W + x;
            if (occ[idx]) {
                ctx.fillStyle = "rgba(53, 208, 127, 0.9)";
                ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
            } else {
                ctx.fillStyle = "rgba(255,255,255,0.03)";
                ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
            }
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

let lastFrameTs = 0;
let lastStats = null;

function updateInfoPanel(stats) {
    if (!stats) return;

    const lines = [];
    lines.push(`Episode: ${fmtNum(stats.episode)}   Steps: ${fmtNum(stats.totalSteps)}   Mode: ${stats.mode || "—"}`);
    lines.push(`Len: ${fmtNum(stats.len)}   BestLen: ${fmtNum(stats.bestLen)}   Score: ${fmtNum(stats.score)}   SinceEat: ${fmtNum(stats.sinceEat)}`);
    lines.push(`Return: ${stats.epReturn != null ? stats.epReturn.toFixed(2) : "—"}   FoodDist: ${stats.foodDist != null ? stats.foodDist.toFixed(3) : "—"}`);
    lines.push(`ε: ${stats.eps != null ? stats.eps.toFixed(3) : "—"}   ε(train): ${stats.epsTrain != null ? stats.epsTrain.toFixed(3) : "—"}`);
    lines.push(`IPC pending: ${fmtNum(stats.pendingIPC)}   dropped: ${fmtNum(stats.droppedIPC)}   trainEvery: ${fmtNum(stats.trainEvery)}   hold: ${fmtNum(stats.hold)}`);

    // trainer status summary
    const t = stats.trainer || {};
    const tr = [];
    tr.push(`Trainer connected: ${t.connected ? "ja" : "nein"}`);
    if (t.replayN != null) tr.push(`Replay=${fmtNum(t.replayN)} Trains=${fmtNum(t.trains)} TPS=${t.tps ?? "—"}`);
    if (t.lossEma != null || t.tdAbsEma != null) tr.push(`LossEMA=${t.lossEma ?? "—"} TD-EMA=${t.tdAbsEma ?? "—"}`);
    if (t.lastTrainErr) tr.push(`LastTrainErr=${t.lastTrainErr}`);
    if (t.tempC != null) tr.push(`Temp=${t.tempC}°C pausedHot=${t.pausedHot ? "ja" : "nein"}`);
    lines.push("");
    lines.push(tr.join("   "));

    infoEl.textContent = lines.join("\n");
}

function updateSystemHud(stats) {
    const t = stats?.trainer || {};
    const now = Date.now();

    // Use trainer.tempC if present, else runner might not have it
    const tempC = t.tempC;

    // We don't have real CPU/RAM from runner by default; show what we have:
    // - CPU: approximated from runner "adapt" messages could be wired later
    // Here: show IPC pressure + temp as "system"
    const cpuPct = null;

    const sysAge = now - (lastFrameTs || now);
    $("sysAge").textContent = fmtAge(sysAge);

    $("sysCpuVal").textContent = cpuPct == null ? "—" : fmtPct(cpuPct, 0);
    setBar($("sysCpuBar"), cpuPct ?? 0, "ok");

    // RAM: show as node heap/rss if available from trainer mem HUD (updated below)
    $("sysMemVal").textContent = "—";
    $("sysMemMB").textContent = "—";
    setBar($("sysMemBar"), 0, "ok");

    $("sysTempVal").textContent = tempC == null ? "—" : `${tempC.toFixed(1)}°C`;

    let tempPct = 0;
    let tempLevel = "ok";
    if (Number.isFinite(tempC)) {
        // map 40..85°C => 0..100
        tempPct = Math.max(0, Math.min(100, ((tempC - 40) / 45) * 100));
        if (tempC >= 82) tempLevel = "bad";
        else if (tempC >= 75) tempLevel = "warn";
    }
    setBar($("sysTempBar"), tempPct, tempLevel);

    const ok = (now - lastFrameTs) < 2000;
    setDot($("sysDot"), ok ? (tempLevel === "bad" ? "bad" : tempLevel === "warn" ? "warn" : "ok") : "muted");
    $("sysStatus").textContent = ok ? (tempLevel === "bad" ? "heiß (Limit!)" : tempLevel === "warn" ? "warm" : "ok") : "keine Daten";
}

function updateMemHud(memMsg, stats) {
    // memMsg comes from trainer "mem" info; stats.trainer also has some values
    const now = Date.now();
    const age = memMsg?.ts ? (now - memMsg.ts) : null;
    $("memAge").textContent = fmtAge(age);

    const tfTensors = memMsg?.tfNumTensors;
    const tfMB = memMsg?.tfNumBytesMB;
    const heapMB = memMsg?.heapUsedMB;
    const rssMB = memMsg?.rssMB;

    $("memTfTensorsVal").textContent = tfTensors == null ? "—" : fmtNum(tfTensors);
    $("memTfMemVal").textContent = tfMB == null ? "—" : fmtMB(tfMB);
    $("memHeapVal").textContent = heapMB == null ? "—" : fmtMB(heapMB);
    $("memRssVal").textContent = rssMB == null ? "—" : fmtMB(rssMB);

    // bars: TF memory up to ~1400MB, heap up to 1000MB, rss up to 2500MB (rough)
    const tfPct = tfMB == null ? 0 : Math.max(0, Math.min(100, (tfMB / 1400) * 100));
    const heapPct = heapMB == null ? 0 : Math.max(0, Math.min(100, (heapMB / 1000) * 100));
    const rssPct = rssMB == null ? 0 : Math.max(0, Math.min(100, (rssMB / 2500) * 100));

    setBar($("memTfBar"), tfPct, tfPct > 85 ? "warn" : "ok");
    setBar($("memHeapBar"), heapPct, heapPct > 85 ? "warn" : "ok");
    setBar($("memRssBar"), rssPct, rssPct > 90 ? "warn" : "ok");

    const ok = (age != null && age < 4000);
    setDot($("memDot"), ok ? "ok" : "muted");
    $("memStatus").textContent = ok ? "live" : "warte…";

    // also map some memory info into system RAM line
    if (heapMB != null || rssMB != null) {
        const ramLine = [];
        if (heapMB != null) ramLine.push(`Heap ${fmtMB(heapMB)}`);
        if (rssMB != null) ramLine.push(`RSS ${fmtMB(rssMB)}`);
        $("sysMemVal").textContent = ramLine.join(" / ");
        $("sysMemMB").textContent = "";
        setBar($("sysMemBar"), rssPct || heapPct, (rssPct > 90 || heapPct > 90) ? "warn" : "ok");
    }
}

function updateTrainHud(stats) {
    const t = stats?.trainer || {};
    const now = Date.now();

    const age = t.ageMs;
    $("trainAge").textContent = fmtAge(age);

    $("trainReplayVal").textContent = t.replayN == null ? "—" : fmtNum(t.replayN);
    $("trainTrainsVal").textContent = t.trains == null ? "—" : fmtNum(t.trains);

    $("trainAttemptsVal").textContent = t.trainAttempts == null ? "—" : fmtNum(t.trainAttempts);
    $("trainErrorsVal").textContent = t.trainErrors == null ? "—" : `Errors ${fmtNum(t.trainErrors)}`;

    $("trainLossVal").textContent = t.lossEma == null ? "—" : String(t.lossEma);
    $("trainTdVal").textContent = t.tdAbsEma == null ? "—" : String(t.tdAbsEma);

    // Loss bar: map 0..0.02 => 0..100 (small)
    const loss = (t.lossEma == null) ? null : Number(t.lossEma);
    const lossPct = loss == null ? 0 : Math.max(0, Math.min(100, (loss / 0.02) * 100));
    setBar($("trainLossBar"), lossPct, lossPct > 80 ? "warn" : "ok");

    // TD bar: map 0..0.3 => 0..100
    const td = (t.tdAbsEma == null) ? null : Number(t.tdAbsEma);
    const tdPct = td == null ? 0 : Math.max(0, Math.min(100, (td / 0.3) * 100));
    setBar($("trainTdBar"), tdPct, tdPct > 85 ? "warn" : "ok");

    // Epsilon values from runner stats
    $("trainEpsVal").textContent = stats.eps == null ? "—" : `ε ${stats.eps.toFixed(3)}`;
    $("trainEpsTrainVal").textContent = stats.epsTrain == null ? "—" : `train ${stats.epsTrain.toFixed(3)}`;
    const epsPct = stats.eps == null ? 0 : Math.max(0, Math.min(100, stats.eps * 100));
    setBar($("trainEpsBar"), epsPct, stats.eps != null && stats.eps > 0.4 ? "cold" : "ok");

    // status
    const connected = !!t.connected;
    const errRate = (t.trainAttempts && t.trainErrors != null) ? (t.trainErrors / Math.max(1, t.trainAttempts)) : null;
    const hot = (t.tempC != null && t.tempC >= 82) || !!t.pausedHot;

    let level = connected ? "ok" : "muted";
    let text = connected ? "live" : "kein Trainer";

    if (errRate != null && errRate > 0.05) { level = "warn"; text = "Fehler im Training"; }
    if (hot) { level = "warn"; text = "Thermal nahe Limit"; }
    if (t.pausedHot) { level = "bad"; text = "Thermal Pause"; }

    setDot($("trainDot"), level);
    $("trainStatus").textContent = text;
}

function updateQualityHud(stats) {
    const now = Date.now();
    $("qualAge").textContent = fmtAge(now - (lastFrameTs || now));

    const pol = stats?.policy || {};
    const modelFrac = pol.modelFrac;
    const randomFrac = pol.randomFrac;

    $("qualModelFrac").textContent = modelFrac == null ? "—" : `Model ${(modelFrac * 100).toFixed(1)}%`;
    $("qualRandomFrac").textContent = randomFrac == null ? "—" : `Random ${(randomFrac * 100).toFixed(1)}%`;

    setBar($("qualModelBar"), modelFrac == null ? 0 : modelFrac * 100, modelFrac != null && modelFrac < 0.5 ? "cold" : "ok");

    $("qualQMax").textContent = pol.qMax == null ? "—" : `Qmax ${pol.qMax.toFixed(3)}`;
    $("qualQSpread").textContent = pol.qSpread == null ? "—" : `spread ${pol.qSpread.toFixed(3)}`;

    $("qualLen").textContent = stats.len == null ? "—" : `Len ${fmtNum(stats.len)}`;
    $("qualBestLen").textContent = stats.bestLen == null ? "—" : `Best ${fmtNum(stats.bestLen)}`;

    const lenPct = (stats.len == null) ? 0 : Math.max(0, Math.min(100, (stats.len / (W * H)) * 100));
    setBar($("qualLenBar"), lenPct, lenPct > 70 ? "ok" : "cold");

    $("qualReturn").textContent = stats.epReturn == null ? "—" : stats.epReturn.toFixed(2);

    const ok = (now - lastFrameTs) < 2000;
    setDot($("qualDot"), ok ? "ok" : "muted");
    $("qualStatus").textContent = ok ? "live" : "warte…";
}

// keep last trainer mem message
let lastTrainerMem = null;

// --- uibuilder wiring ---
uibuilder.start();

uibuilder.onChange("msg", (msg) => {
    try {
        if (!msg) return;

        // Accept either:
        // - msg.topic === "max7219/frame" with msg.payload + msg.stats
        // - or msg.payload.topic embedded (some flows wrap it)
        const topic = msg.topic || msg?.payload?.topic;

        if (topic === "snake/info") {
            // trainer info messages can include mem
            const p = msg.payload;
            if (p && p.msg === "mem") {
                lastTrainerMem = p;
            }
            return;
        }

        if (topic === "max7219/frame") {
            const frame = msg.payload || msg?.payload?.payload;
            const stats = msg.stats || msg?.payload?.stats;

            if (frame) {
                drawFrame(frame);
                lastFrameTs = frame.ts || Date.now();
            }
            if (stats) {
                lastStats = stats;
                updateInfoPanel(stats);
                updateSystemHud(stats);
                updateTrainHud(stats);
                updateQualityHud(stats);
                updateMemHud(lastTrainerMem, stats);
            }
            return;
        }

        // fallback: sometimes node-red sends full object into payload
        if (msg.payload && msg.payload.rows && msg.payload.w === W && msg.payload.h === H) {
            drawFrame(msg.payload);
            lastFrameTs = msg.payload.ts || Date.now();
            if (msg.stats) {
                lastStats = msg.stats;
                updateInfoPanel(msg.stats);
                updateSystemHud(msg.stats);
                updateTrainHud(msg.stats);
                updateQualityHud(msg.stats);
                updateMemHud(lastTrainerMem, msg.stats);
            }
        }
    } catch (e) {
        console.error(e);
    }
});

// initial paint
clearCanvas();

// heartbeat: if no updates, show stale indicators
setInterval(() => {
    const now = Date.now();
    if (lastStats) {
        updateSystemHud(lastStats);
        updateQualityHud(lastStats);
    }
}, 1000);