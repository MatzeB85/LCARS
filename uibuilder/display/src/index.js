/* global uibuilder */
"use strict";

uibuilder.start();

// ------- progress tracking -------
const WIN = 50;
const hist = { len: [], score: [], ret: [] };
const best = { len: 0, score: 0, ret: -Infinity };

function pushHist(arr, v) {
  arr.push(v);
  if (arr.length > WIN) arr.shift();
}
function avg(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}
function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}
function fmtInt(n) {
  return Number.isFinite(n) ? String(Math.trunc(n)) : "n/a";
}

function resetProgress(reason = "") {
  hist.len.length = 0;
  hist.score.length = 0;
  hist.ret.length = 0;

  best.len = 0;
  best.score = 0;
  best.ret = -Infinity;

  if (reason) console.log(`Progress reset: ${reason}`);
}

// ------- DOM -------
let canvas, ctx, info;
const scale = 12;

// HUD elements (System: CPU/MEM/TEMP)
let elCpuVal,
  elMemVal,
  elMemMB,
  elTempVal,
  elCpuBar,
  elMemBar,
  elTempBar,
  elSysAge,
  elSysDot,
  elSysStatus;

// HUD elements (Trainer memory: TF/Heap/RSS)
let elTfTensorsVal,
  elTfMemVal,
  elHeapVal,
  elRssVal,
  elTfBar,
  elHeapBar,
  elRssBar;

// latest system metrics
let latestSys = null; // {cpuPct, memUsedPct, memUsedMB, memTotalMB, tempC, ts}

// latest trainer memory metrics
// {rssMB, heapUsedMB, heapTotalMB, externalMB, arrayBuffersMB, tfNumTensors, tfNumBytesMB, replayN, trains, ts}
let latestMem = null;

function initDom() {
  canvas = document.getElementById("matrix");
  info = document.getElementById("info");

  if (!canvas) {
    console.error('Canvas with id="matrix" not found.');
    return false;
  }
  ctx = canvas.getContext("2d");

  // System HUD (existing ids from our index.html)
  elCpuVal = document.getElementById("sysCpuVal");
  elMemVal = document.getElementById("sysMemVal");
  elMemMB = document.getElementById("sysMemMB");
  elTempVal = document.getElementById("sysTempVal");
  elCpuBar = document.getElementById("sysCpuBar");
  elMemBar = document.getElementById("sysMemBar");
  elTempBar = document.getElementById("sysTempBar");
  elSysAge = document.getElementById("sysAge");
  elSysDot = document.getElementById("sysDot");
  elSysStatus = document.getElementById("sysStatus");

  // Trainer Memory HUD (optional ids — only update if they exist in your HTML)
  // If you haven't added these elements yet, it will just fall back to info-line text.
  elTfTensorsVal = document.getElementById("memTfTensorsVal");
  elTfMemVal = document.getElementById("memTfMemVal");
  elHeapVal = document.getElementById("memHeapVal");
  elRssVal = document.getElementById("memRssVal");
  elTfBar = document.getElementById("memTfBar");
  elHeapBar = document.getElementById("memHeapBar");
  elRssBar = document.getElementById("memRssBar");

  return true;
}

function setSize(w, h) {
  canvas.width = w * scale;
  canvas.height = h * scale;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function setBar(el, pct01, level) {
  if (!el) return;
  const w = `${Math.round(clamp01(pct01) * 100)}%`;
  el.style.width = w;

  // Use CSS vars defined in index.css
  if (level === "ok") el.style.backgroundColor = "var(--ok)";
  else if (level === "warn") el.style.backgroundColor = "var(--warn)";
  else if (level === "bad") el.style.backgroundColor = "var(--bad)";
  else if (level === "cold") el.style.backgroundColor = "var(--cold)";
  else el.style.backgroundColor = "var(--muted2)";
}

// ===== System HUD =====
function updateSysHud() {
  if (!latestSys) return;

  const now = Date.now();
  const ageMs = now - (latestSys.ts || now);
  const ageTxt = ageMs < 1000 ? `${ageMs}ms` : `${(ageMs / 1000).toFixed(1)}s`;
  if (elSysAge) elSysAge.textContent = `vor ${ageTxt}`;

  const stale = ageMs > 3000;

  // CPU
  if (elCpuVal) elCpuVal.textContent = Number.isFinite(latestSys.cpuPct) ? `${latestSys.cpuPct.toFixed(1)}%` : "n/a";
  const cpu01 = Number.isFinite(latestSys.cpuPct) ? latestSys.cpuPct / 100 : 0;
  let cpuLevel = "ok";
  if (latestSys.cpuPct >= 85) cpuLevel = "bad";
  else if (latestSys.cpuPct >= 65) cpuLevel = "warn";
  setBar(elCpuBar, cpu01, stale ? null : cpuLevel);

  // MEM
  if (elMemVal) elMemVal.textContent = Number.isFinite(latestSys.memUsedPct) ? `${latestSys.memUsedPct.toFixed(1)}%` : "n/a";
  if (elMemMB) {
    if (Number.isFinite(latestSys.memUsedMB) && Number.isFinite(latestSys.memTotalMB)) {
      elMemMB.textContent = `${fmtInt(latestSys.memUsedMB)}/${fmtInt(latestSys.memTotalMB)}MB`;
    } else {
      elMemMB.textContent = "—";
    }
  }
  const mem01 = Number.isFinite(latestSys.memUsedPct) ? latestSys.memUsedPct / 100 : 0;
  let memLevel = "ok";
  if (latestSys.memUsedPct >= 90) memLevel = "bad";
  else if (latestSys.memUsedPct >= 75) memLevel = "warn";
  setBar(elMemBar, mem01, stale ? null : memLevel);

  // TEMP
  const t = latestSys.tempC;
  if (elTempVal) elTempVal.textContent = Number.isFinite(t) ? `${t.toFixed(1)}°C` : "n/a";
  let temp01 = 0;
  if (Number.isFinite(t)) temp01 = clamp01((t - 30) / (85 - 30));
  let tempLevel = "cold";
  if (Number.isFinite(t)) {
    tempLevel = "ok";
    if (t >= 80) tempLevel = "bad";
    else if (t >= 70) tempLevel = "warn";
  }
  setBar(elTempBar, temp01, stale ? null : tempLevel);

  // status dot/text
  if (elSysDot) elSysDot.style.backgroundColor = stale ? "var(--warn)" : "var(--ok)";
  if (elSysStatus) elSysStatus.textContent = stale ? "daten alt / prüfen" : "live";
}

// ===== Trainer Memory HUD =====
// We render it either in dedicated elements (if you added them), and always append summary to #info.
function memAgeMs() {
  if (!latestMem || !Number.isFinite(latestMem.ts)) return null;
  return Date.now() - latestMem.ts;
}

function formatMemSummary() {
  if (!latestMem) return "";
  const age = memAgeMs();
  const stale = Number.isFinite(age) ? age > 30000 : true;
  const staleTxt = stale ? " (stale)" : "";

  const tfT = Number.isFinite(latestMem.tfNumTensors) ? latestMem.tfNumTensors : null;
  const tfMB = Number.isFinite(latestMem.tfNumBytesMB) ? latestMem.tfNumBytesMB : null;
  const heap = Number.isFinite(latestMem.heapUsedMB) ? latestMem.heapUsedMB : null;
  const rss = Number.isFinite(latestMem.rssMB) ? latestMem.rssMB : null;
  const rep = Number.isFinite(latestMem.replayN) ? latestMem.replayN : null;

  const parts = [];
  if (tfT !== null) parts.push(`tfT=${tfT}`);
  if (tfMB !== null) parts.push(`tfMB=${tfMB.toFixed(1)}`);
  if (heap !== null) parts.push(`heapMB=${heap.toFixed(1)}`);
  if (rss !== null) parts.push(`rssMB=${rss.toFixed(1)}`);
  if (rep !== null) parts.push(`replay=${rep}`);

  return parts.length ? ` MEM ${parts.join(" ")}${staleTxt}` : "";
}

function updateMemHud() {
  if (!latestMem) return;

  // Values
  if (elTfTensorsVal) elTfTensorsVal.textContent = Number.isFinite(latestMem.tfNumTensors) ? String(latestMem.tfNumTensors) : "—";
  if (elTfMemVal) elTfMemVal.textContent = Number.isFinite(latestMem.tfNumBytesMB) ? `${latestMem.tfNumBytesMB.toFixed(1)}MB` : "—";
  if (elHeapVal) elHeapVal.textContent = Number.isFinite(latestMem.heapUsedMB) ? `${latestMem.heapUsedMB.toFixed(1)}MB` : "—";
  if (elRssVal) elRssVal.textContent = Number.isFinite(latestMem.rssMB) ? `${latestMem.rssMB.toFixed(1)}MB` : "—";

  // Bars: we don't know absolute limits, so we map with reasonable soft scales:
  // TF MB: 0..800MB (soft), Heap: 0..800MB, RSS: 0..2000MB
  const tf01 = Number.isFinite(latestMem.tfNumBytesMB) ? latestMem.tfNumBytesMB / 800 : 0;
  const heap01 = Number.isFinite(latestMem.heapUsedMB) ? latestMem.heapUsedMB / 800 : 0;
  const rss01 = Number.isFinite(latestMem.rssMB) ? latestMem.rssMB / 2000 : 0;

  // Levels: TF tensors growth is often the leak indicator -> mark warn/bad by amount
  let tfLevel = "ok";
  if (Number.isFinite(latestMem.tfNumBytesMB)) {
    if (latestMem.tfNumBytesMB >= 700) tfLevel = "bad";
    else if (latestMem.tfNumBytesMB >= 450) tfLevel = "warn";
  }

  let heapLevel = "ok";
  if (Number.isFinite(latestMem.heapUsedMB)) {
    if (latestMem.heapUsedMB >= 650) heapLevel = "bad";
    else if (latestMem.heapUsedMB >= 400) heapLevel = "warn";
  }

  let rssLevel = "ok";
  if (Number.isFinite(latestMem.rssMB)) {
    if (latestMem.rssMB >= 1600) rssLevel = "bad";
    else if (latestMem.rssMB >= 1100) rssLevel = "warn";
  }

  // Stale detection
  const age = memAgeMs();
  const stale = Number.isFinite(age) ? age > 30000 : true;

  setBar(elTfBar, tf01, stale ? null : tfLevel);
  setBar(elHeapBar, heap01, stale ? null : heapLevel);
  setBar(elRssBar, rss01, stale ? null : rssLevel);
}

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
    const lagMs = Date.now() - (frame?.ts || Date.now());

    const pending = stats?.pendingIPC;
    const dropped = stats?.droppedIPC;
    const pipeTxt =
      (Number.isFinite(pending) || Number.isFinite(dropped))
        ? ` pend=${fmtInt(pending)} drop=${fmtInt(dropped)}`
        : "";

    const sinceEatTxt = Number.isFinite(stats?.sinceEat) ? ` sinceEat=${fmtInt(stats.sinceEat)}` : "";

    // features (if provided by runner)
    const spaceF = stats?.spaceF;
    const spaceL = stats?.spaceL;
    const spaceR = stats?.spaceR;
    const foodDist = stats?.foodDist;
    const tailReach = stats?.tailReach;

    const foodReachF = stats?.foodReachF;
    const foodReachL = stats?.foodReachL;
    const foodReachR = stats?.foodReachR;

    let featTxt = "";

    const hasSpace =
      Number.isFinite(spaceF) || Number.isFinite(spaceL) || Number.isFinite(spaceR);
    const hasFoodDist = Number.isFinite(foodDist);
    const hasTailReach = Number.isFinite(tailReach);
    const hasFoodReach =
      Number.isFinite(foodReachF) || Number.isFinite(foodReachL) || Number.isFinite(foodReachR);

    if (hasSpace || hasFoodDist || hasTailReach || hasFoodReach) {
      const sf = Number.isFinite(spaceF) ? spaceF.toFixed(3) : "n/a";
      const sl = Number.isFinite(spaceL) ? spaceL.toFixed(3) : "n/a";
      const sr = Number.isFinite(spaceR) ? spaceR.toFixed(3) : "n/a";
      const fd = Number.isFinite(foodDist) ? foodDist.toFixed(3) : "n/a";
      const tr = Number.isFinite(tailReach) ? String(tailReach | 0) : "n/a";

      featTxt += ` space(F/L/R)=${sf}/${sl}/${sr} foodDist=${fd} tailReach=${tr}`;

      if (hasFoodReach) {
        const frf = Number.isFinite(foodReachF) ? String(foodReachF | 0) : "n/a";
        const frl = Number.isFinite(foodReachL) ? String(foodReachL | 0) : "n/a";
        const frr = Number.isFinite(foodReachR) ? String(foodReachR | 0) : "n/a";
        featTxt += ` foodReach(F/L/R)=${frf}/${frl}/${frr}`;
      }
    }

    const memTxt = formatMemSummary();

    const live = stats
      ? `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} ` +
      `len=${stats.len} bestLen=${stats.bestLen} score=${stats.score} ` +
      `ret=${fmt(stats.epReturn, 2)} lag=${lagMs}ms` +
      sinceEatTxt +
      pipeTxt +
      (featTxt ? ` ${featTxt}` : "") +
      memTxt
      : `lag=${lagMs}ms${memTxt}`;

    const progress =
      hist.len.length
        ? ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
        `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`
        : "";

    info.textContent = live + progress;
  }
}

// ------- message unwrap -------
function unwrap(msg) {
  if (!msg) return null;

  // Direct
  if (msg.topic === "max7219/frame" && msg.payload?.rows) {
    return { topic: msg.topic, frame: msg.payload, stats: msg.stats };
  }
  if (msg.topic === "snake/episode" && msg.payload) {
    return { topic: msg.topic, payload: msg.payload };
  }
  if (msg.topic === "snake/info" && msg.payload) {
    return { topic: msg.topic, payload: msg.payload };
  }
  if (msg.topic === "sys/metrics" && msg.payload) {
    return { topic: msg.topic, payload: msg.payload };
  }

  // Wrapped
  const o = msg.payload;
  if (o?.topic === "max7219/frame" && o?.payload?.rows) {
    return { topic: o.topic, frame: o.payload, stats: o.stats };
  }
  if (o?.topic === "snake/episode" && o?.payload) {
    return { topic: o.topic, payload: o.payload };
  }
  if (o?.topic === "snake/info" && o?.payload) {
    return { topic: o.topic, payload: o.payload };
  }
  if (o?.topic === "sys/metrics" && o?.payload) {
    return { topic: o.topic, payload: o.payload };
  }

  return null;
}

let lastEpisodeSeen = null;

function handleInfo(payload) {
  if (!payload) return;

  // Reset progress on runner_start (UI only)
  if (payload.msg === "runner_start") {
    resetProgress("runner_start");
    lastEpisodeSeen = null;

    if (info && !latestFrame) {
      info.textContent = "Runner gestartet – Progress zurückgesetzt.";
    }
  }

  // Trainer memory reports: msg: "mem" (from our trainer)
  // We support several shapes:
  //  1) payload.msg === "mem" and payload has tfNumTensors, rssMB, heapUsedMB, tfNumBytesMB, ...
  //  2) payload.tag exists (start/periodic/after_trains)
  if (payload.msg === "mem" || payload.tfNumTensors !== undefined || payload.tfNumBytesMB !== undefined) {
    latestMem = {
      rssMB: Number.isFinite(payload.rssMB) ? payload.rssMB : null,
      heapUsedMB: Number.isFinite(payload.heapUsedMB) ? payload.heapUsedMB : null,
      heapTotalMB: Number.isFinite(payload.heapTotalMB) ? payload.heapTotalMB : null,
      externalMB: Number.isFinite(payload.externalMB) ? payload.externalMB : null,
      arrayBuffersMB: Number.isFinite(payload.arrayBuffersMB) ? payload.arrayBuffersMB : null,
      tfNumTensors: Number.isFinite(payload.tfNumTensors) ? payload.tfNumTensors : null,
      tfNumBytesMB: Number.isFinite(payload.tfNumBytesMB) ? payload.tfNumBytesMB : null,
      replayN: Number.isFinite(payload.replayN) ? payload.replayN : null,
      trains: Number.isFinite(payload.trains) ? payload.trains : null,
      ts: Number.isFinite(payload.ts) ? payload.ts : Date.now(),
      tag: payload.tag || payload.memTag || null,
    };
    updateMemHud();
    // also refresh overlay on next draw
    if (latestFrame) scheduleDraw();
  }
}

function handleEpisode(ep) {
  if (!ep) return;

  if (Number.isFinite(ep.episode)) {
    if (lastEpisodeSeen !== null && ep.episode < lastEpisodeSeen) {
      resetProgress("episode counter went backwards");
    }
    lastEpisodeSeen = ep.episode;
  }

  if (Number.isFinite(ep.len)) best.len = Math.max(best.len, ep.len);
  if (Number.isFinite(ep.score)) best.score = Math.max(best.score, ep.score);
  if (Number.isFinite(ep.epReturn)) best.ret = Math.max(best.ret, ep.epReturn);

  if (Number.isFinite(ep.len)) pushHist(hist.len, ep.len);
  if (Number.isFinite(ep.score)) pushHist(hist.score, ep.score);
  if (Number.isFinite(ep.epReturn)) pushHist(hist.ret, ep.epReturn);

  if (info && !latestFrame) {
    info.textContent =
      `ep=${ep.episode} steps=${ep.totalSteps} eps=${ep.eps} len=${ep.len} bestLen=${ep.bestLen} score=${ep.score} ret=${fmt(ep.epReturn, 2)}` +
      ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
      `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}` +
      formatMemSummary();
  }
}

function handleSys(payload) {
  if (!payload) return;
  latestSys = {
    cpuPct: Number.isFinite(payload.cpuPct) ? payload.cpuPct : null,
    memUsedPct: Number.isFinite(payload.memUsedPct) ? payload.memUsedPct : null,
    memUsedMB: Number.isFinite(payload.memUsedMB) ? payload.memUsedMB : null,
    memTotalMB: Number.isFinite(payload.memTotalMB) ? payload.memTotalMB : null,
    tempC: Number.isFinite(payload.tempC) ? payload.tempC : null,
    ts: Number.isFinite(payload.ts) ? payload.ts : Date.now(),
  };
  updateSysHud();
}

// Refresh HUD age/stale indicator periodically
setInterval(() => {
  if (latestSys) updateSysHud();
  if (latestMem) updateMemHud();
}, 500);

// ------- smooth rendering -------
let latestFrame = null;
let scheduled = false;

function scheduleDraw() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (!latestFrame) return;
    drawFrame(latestFrame.frame, latestFrame.stats);
  });
}

// ------- start -------
document.addEventListener("DOMContentLoaded", () => {
  if (!initDom()) return;

  console.log("UI ready: waiting for messages…");

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
      handleInfo(u.payload);
      if (latestFrame) scheduleDraw();
      return;
    }

    if (u.topic === "sys/metrics") {
      handleSys(u.payload);
      if (latestFrame) scheduleDraw();
    }
  });
});