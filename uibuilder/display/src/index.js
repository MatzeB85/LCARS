/* global uibuilder */
uibuilder.start();

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");
const info = document.getElementById("info");

const scale = 12;

function setSize(w, h) {
  canvas.width = w * scale;
  canvas.height = h * scale;
}

function drawFrame(frame, stats) {
  const w = frame?.w ?? 32;
  const h = frame?.h ?? 8;
  const rows = frame?.rows;

  if (!Array.isArray(rows) || rows.length < h) return;

  setSize(w, h);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Snake+Food (alles erstmal grün)
  ctx.fillStyle = "#00ff66";
  for (let y = 0; y < h; y++) {
    const row = rows[y];
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

  // Food rot (wenn vorhanden)
  if (frame.food && Number.isInteger(frame.food.x) && Number.isInteger(frame.food.y)) {
    ctx.fillStyle = "#ff3355";
    ctx.fillRect(frame.food.x * scale, frame.food.y * scale, scale, scale);
  }

  // Head blau (wenn vorhanden)
  if (frame.head && Number.isInteger(frame.head.x) && Number.isInteger(frame.head.y)) {
    ctx.fillStyle = "#00aaff";
    ctx.fillRect(frame.head.x * scale, frame.head.y * scale, scale, scale);
  }

  if (info && stats) {
    info.textContent =
      `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} ` +
      `len=${stats.len} best=${stats.bestLen} score=${stats.score}`;
  }
}

uibuilder.onChange("msg", (msg) => {
  if (!msg) return;

  // Fall 1: du sendest direkt msg.topic / msg.payload
  if (msg.topic === "max7219/frame" && msg.payload?.rows) {
    drawFrame(msg.payload, msg.stats || msg.payload?.stats);
    return;
  }

  // Fall 2: exec -> json: Objekt steckt in msg.payload
  const obj = msg.payload;
  if (obj?.topic === "max7219/frame" && obj?.payload?.rows) {
    drawFrame(obj.payload, obj.stats);
    return;
  }

  // Optional: Episode summaries
  if (obj?.topic === "snake/episode") {
    // console.log("episode", obj.payload);
  }
});