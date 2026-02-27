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

// ------- DOM init -------
let canvas, ctx, info;
const scale = 12;

function initDom() {
  canvas = document.getElementById("matrix");
  info = document.getElementById("info");

  if (!canvas) {
    console.error('Canvas with id="matrix" not found.');
    return false;
  }
  ctx = canvas.getContext("2d");
  return true;
}

function setSize(w, h) {
  canvas.width = w * scale;
  canvas.height = h * scale;
}

function drawFrame(frame, stats) {
  if (!canvas || !ctx) return;

  const w = frame?.w ?? 32;
  const h = frame?.h ?? 8;
  const rows = frame?.rows;
  if (!Array.isArray(rows) || rows.length < h) return;

  setSize(w, h);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Snake (green)
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

  // Food (red)
  if (frame.food && Number.isInteger(frame.food.x) && Number.isInteger(frame.food.y)) {
    ctx.fillStyle = "#ff3355";
    ctx.fillRect(frame.food.x * scale, frame.food.y * scale, scale, scale);
  }

  // Head (blue)
  if (frame.head && Number.isInteger(frame.head.x) && Number.isInteger(frame.head.y)) {
    ctx.fillStyle = "#00aaff";
    ctx.fillRect(frame.head.x * scale, frame.head.y * scale, scale, scale);
  }

  // Overlay
  if (info) {
    const lagMs = Date.now() - (frame?.ts || Date.now());

    const live = stats
      ? `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} ` +
      `len=${stats.len} bestLen=${stats.bestLen} score=${stats.score} ` +
      `ret=${fmt(stats.epReturn, 2)} lag=${lagMs}ms`
      : `lag=${lagMs}ms`;

    const progress =
      hist.len.length
        ? ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
        `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`
        : "";

    info.textContent = live + progress;
  }
}

// ------- robust extraction -------
// Your typical uibuilder message from exec->split->json is:
// msg.payload = { topic:"max7219/frame", payload:{...frame...}, stats:{...} }
function extract(msg) {
  if (!msg) return null;

  // Try direct
  if (msg.topic && msg.payload) {
    // stats might be msg.stats or msg.payload.stats (rare)
    const stats = msg.stats ?? msg.payload?.stats ?? null;
    return { topic: msg.topic, payload: msg.payload, stats };
  }

  // Exec->JSON wrapped in msg.payload
  const o = msg.payload;
  if (o?.topic) {
    const stats = o.stats ?? o.payload?.stats ?? msg.stats ?? null;
    return { topic: o.topic, payload: o.payload, stats, raw: o };
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

  // If no frame yet, still show something
  if (info && !latestFrame) {
    info.textContent =
      `ep=${ep.episode} steps=${ep.totalSteps} eps=${ep.eps} len=${ep.len} bestLen=${ep.bestLen} score=${ep.score} ret=${fmt(ep.epReturn, 2)}` +
      ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
      `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`;
  }
}

// ------- smooth render: latest wins -------
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

document.addEventListener("DOMContentLoaded", () => {
  if (!initDom()) return;

  uibuilder.onChange("msg", (msg) => {
    const m = extract(msg);
    if (!m) return;

    if (m.topic === "max7219/frame" && m.payload?.rows) {
      latestFrame = { frame: m.payload, stats: m.stats };
      scheduleDraw();
      return;
    }

    if (m.topic === "snake/episode") {
      // IMPORTANT: snake/episode payload is the episode object itself
      handleEpisode(m.payload);
      if (latestFrame) scheduleDraw();
      return;
    }
  });
});