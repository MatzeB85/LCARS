/* global uibuilder */
"use strict";

uibuilder.start();

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");
const info = document.getElementById("info");
const scale = 12;

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

  // Snake (green): draw all bits from rows
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

  // Info overlay
  if (info) {
    const lagMs = Date.now() - (frame?.ts || Date.now());
    if (stats) {
      info.textContent =
        `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} ` +
        `len=${stats.len} best=${stats.bestLen} score=${stats.score} ` +
        `lag=${lagMs}ms`;
    } else {
      info.textContent = `lag=${lagMs}ms`;
    }
  }
}

/**
 * Supports both message formats:
 * 1) Direct: msg.topic === "max7219/frame", msg.payload = frame, msg.stats = stats
 * 2) Exec->JSON: msg.payload = { topic, payload: frame, stats }
 */
function unwrap(msg) {
  // Direct format
  if (msg?.topic === "max7219/frame" && msg?.payload?.rows) {
    return { frame: msg.payload, stats: msg.stats };
  }

  // Exec->JSON format
  const obj = msg?.payload;
  if (obj?.topic === "max7219/frame" && obj?.payload?.rows) {
    return { frame: obj.payload, stats: obj.stats };
  }

  return null;
}

// --- Smooth rendering: keep only the latest frame and draw via requestAnimationFrame ---
let latest = null;
let scheduled = false;

function scheduleDraw() {
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    if (!latest) return;
    drawFrame(latest.frame, latest.stats);
  });
}

uibuilder.onChange("msg", (msg) => {
  const u = unwrap(msg);
  if (!u) return;

  // "latest wins": overwrite any older pending frame
  latest = u;

  // draw at most once per animation frame
  scheduleDraw();
});