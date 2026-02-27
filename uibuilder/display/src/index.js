/* global uibuilder */
"use strict";

uibuilder.start();

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");
const info = document.getElementById("info");
const scale = 12;

// ------- progress tracking -------
const WIN = 50; // rolling window size
const hist = {
  len: [],
  score: [],
  ret: [],
};
const best = {
  len: 0,
  score: 0,
  ret: -Infinity,
};
let lastEpisode = null; // last episode payload

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

// ------- rendering -------
function setSize(w, h) {
  if (!canvas) return;
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

  // Snake (green) from rows bits
  ctx.fillStyle = "#00ff66";
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (!Array.isArray(row)) continue;

    for (let m = 0; m < row.length; m++) {
      const b = row[m] & 0xff;
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

  // Overlay text (frame stats + progress)
  if (info) {
    const lagMs = Date.now() - (frame?.ts || Date.now());

    const live = stats
      ? `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} len=${stats.len} bestLen=${stats.bestLen} score=${stats.score} ret=${fmt(stats.epReturn, 2)} lag=${lagMs}ms`
      : `lag=${lagMs}ms`;

    const progress =
      hist.len.length
        ? ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
          `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`
        : "";

    info.textContent = live + progress;
  }
}

// ------- message unwrap (supports both formats) -------
function unwrap(msg) {
  // Direct format
  if (msg?.topic && msg?.payload) return { topic: msg.topic, payload: msg.payload, stats: msg.stats };

  // Exec->JSON format
  if (msg?.payload?.topic && msg?.payload?.payload) return { topic: msg.payload.topic, payload: msg.payload.payload, stats: msg.payload.stats };

  // Some nodes may send only {payload:{topic,...}} without payload.payload
  if (msg?.payload?.topic && msg?.payload) return { topic: msg.payload.topic, payload: msg.payload.payload, stats: msg.payload.stats };

  return null;
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

function handleEpisode(ep) {
  if (!ep) return;
  lastEpisode = ep;

  // update bests
  if (Number.isFinite(ep.len)) best.len = Math.max(best.len, ep.len);
  if (Number.isFinite(ep.score)) best.score = Math.max(best.score, ep.score);
  if (Number.isFinite(ep.epReturn)) best.ret = Math.max(best.ret, ep.epReturn);

  // update rolling window
  if (Number.isFinite(ep.len)) pushHist(hist.len, ep.len);
  if (Number.isFinite(ep.score)) pushHist(hist.score, ep.score);
  if (Number.isFinite(ep.epReturn)) pushHist(hist.ret, ep.epReturn);

  // If no frames are coming (or paused), still update the info box
  if (info && !latestFrame) {
    info.textContent =
      `ep=${ep.episode} steps=${ep.totalSteps} eps=${ep.eps} len=${ep.len} bestLen=${ep.bestLen} score=${ep.score} ret=${fmt(ep.epReturn, 2)}` +
      ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
      `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`;
  }
}

uibuilder.onChange("msg", (msg) => {
  const u = unwrap(msg);
  if (!u) return;

  // frames
  if (u.topic === "max7219/frame" && u.payload?.rows) {
    latestFrame = { frame: u.payload, stats: u.stats };
    scheduleDraw();
    return;
  }

  // episode summaries
  if (u.topic === "snake/episode") {
    // episode payload is directly u.payload (because snake-dqn emits {topic, payload:{...}})
    handleEpisode(u.payload);
    // also redraw overlay if we have a frame already
    if (latestFrame) scheduleDraw();
    return;
  }
});