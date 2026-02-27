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

// ------- DOM (init after DOMContentLoaded to avoid null errors) -------
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

  // Snake (green): draw all bits from rows
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

  // Info overlay: live stats + progress
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

// ------- message unwrap (super robust) -------
// Your Node-RED setup typically sends to uibuilder:
// msg.payload = { topic:"max7219/frame", payload:{...frame...}, stats:{...} }
function unwrap(msg) {
  if (!msg) return null;

  // Direct format: {topic, payload(frame), stats}
  if (msg.topic === "max7219/frame" && msg.payload?.rows) {
    return { topic: msg.topic, frame: msg.payload, stats: msg.stats };
  }
  if (msg.topic === "snake/episode" && msg.payload) {
    return { topic: msg.topic, payload: msg.payload };
  }

  // Exec->JSON (Node-RED json node output): payload is the emitted object
  // { payload: { topic, payload: frame, stats } }
  const o = msg.payload;
  if (o?.topic === "max7219/frame" && o?.payload?.rows) {
    return { topic: o.topic, frame: o.payload, stats: o.stats };
  }
  if (o?.topic === "snake/episode" && o?.payload) {
    return { topic: o.topic, payload: o.payload };
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

  // If we currently have no frame, still show progress text
  if (info && !latestFrame) {
    info.textContent =
      `ep=${ep.episode} steps=${ep.totalSteps} eps=${ep.eps} len=${ep.len} bestLen=${ep.bestLen} score=${ep.score} ret=${fmt(ep.epReturn, 2)}` +
      ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
      `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`;
  }
}

// ------- smooth rendering: latest wins + requestAnimationFrame -------
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

// ------- start after DOM is ready -------
document.addEventListener("DOMContentLoaded", () => {
  if (!initDom()) return;

  // Optional: comment out after first successful test
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
      // refresh overlay on next draw if we have a frame
      if (latestFrame) scheduleDraw();
    }
  });
});