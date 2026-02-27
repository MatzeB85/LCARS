function drawRows(frame) {
  const w = frame.w || 32;
  const h = frame.h || 8;
  const rows = frame.rows;

  canvas.width = w * scale;
  canvas.height = h * scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // alles grün zeichnen
  ctx.fillStyle = "#00ff66";
  for (let y = 0; y < h; y++) {
    for (let m = 0; m < rows[y].length; m++) {
      const b = rows[y][m] & 0xff;
      for (let bit = 0; bit < 8; bit++) {
        if ((b >> bit) & 1) {
          const x = m * 8 + bit;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }

  // Head + Food extra (wenn wir sie gleich mitsenden)
  if (frame.head) {
    ctx.fillStyle = "#00aaff";
    ctx.fillRect(frame.head.x * scale, frame.head.y * scale, scale, scale);
  }
  if (frame.food) {
    ctx.fillStyle = "#ff3355";
    ctx.fillRect(frame.food.x * scale, frame.food.y * scale, scale, scale);
  }
}