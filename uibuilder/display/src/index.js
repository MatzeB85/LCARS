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
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function fmtAge(ms) {
  const m = Math.max(0, ms | 0);
  if (m < 1000) return `${m}ms`;
  return `${(m / 1000).toFixed(1)}s`;
}

// ------- DOM -------
let canvas, ctx, info;
const scale = 12;

// System HUD (matches your HTML)
let elSysAge, elSysDot, elSysStatus, elSysCpuVal, elSysCpuBar, elSysMemVal, elSysMemMB, elSysMemBar, elSysTempVal, elSysTempBar;

// Trainer Memory HUD (matches your HTML)
let elTfTensorsVal, elTfMemVal, elHeapVal, elRssVal, elTfBar, elHeapBar, elRssBar;
let elMemAge, elMemDot, elMemStatus;

function initDom() {
  canvas = document.getElementById("matrix");
  info = document.getElementById("info");

  if (!canvas) {
    console.error('Canvas with id="matrix" not found.');
    return false;
  }
  ctx = canvas.getContext("2d");

  // --- System HUD ---
  elSysAge = document.getElementById("sysAge");
  elSysDot = document.getElementById("sysDot");
  elSysStatus = document.getElementById("sysStatus");

  elSysCpuVal = document.getElementById("sysCpuVal");
  elSysCpuBar = document.getElementById("sysCpuBar");

  elSysMemVal = document.getElementById("sysMemVal");
  elSysMemMB = document.getElementById("sysMemMB");
  elSysMemBar = document.getElementById("sysMemBar");

  elSysTempVal = document.getElementById("sysTempVal");
  elSysTempBar = document.getElementById("sysTempBar");

  // --- Trainer Memory HUD ---
  elTfTensorsVal = document.getElementById("memTfTensorsVal");
  elTfMemVal = document.getElementById("memTfMemVal");
  elHeapVal = document.getElementById("memHeapVal");
  elRssVal = document.getElementById("memRssVal");

  elTfBar = document.getElementById("memTfBar");
  elHeapBar = document.getElementById("memHeapBar");
  elRssBar = document.getElementById("memRssBar");

  elMemAge = document.getElementById("memAge");
  elMemDot = document.getElementById("memDot");
  elMemStatus = document.getElementById("memStatus");

  return true;
}

function setSize(w, h) {
  canvas.width = w * scale;
  canvas.height = h * scale;
}

// ------- state -------
let latestFrame = null;   // {frame, stats}
let latestMem = null;     // {tfT, tfMB, heapMB, rssMB, replay, ts}
let latestAdapt = null;   // {dynMaxTrainsPerSec, procCpuPct, memUsedPct, tempC, ts}
let latestSys = null;     // {cpuPct, memPct, memUsedMB, memTotalMB, tempC, ts}

// ------- HUD helpers -------
function setBar(el, frac01, level /* "ok"|"warn"|"bad"|null */) {
  if (!el) return;
  const w = Math.round(100 * clamp01(frac01));
  el.style.width = `${w}%`;
  if (!level) return;
  if (level === "ok") el.style.backgroundColor = "var(--ok)";
  else if (level === "warn") el.style.backgroundColor = "var(--warn)";
  else if (level === "bad") el.style.backgroundColor = "var(--bad)";
}

function updateSysHud() {
  if (!latestSys) return;

  const now = Date.now();
  const ageMs = Number.isFinite(latestSys.ts) ? Math.max(0, now - latestSys.ts) : Infinity;
  const stale = ageMs > 30000;

  if (elSysAge) elSysAge.textContent = fmtAge(ageMs);
  if (elSysDot) elSysDot.style.backgroundColor = stale ? "var(--warn)" : "var(--ok)";
  if (elSysStatus) elSysStatus.textContent = stale ? "daten alt" : "live";

  // CPU
  if (elSysCpuVal) elSysCpuVal.textContent = Number.isFinite(latestSys.cpuPct) ? `${latestSys.cpuPct.toFixed(1)}%` : "—";
  if (elSysCpuBar) {
    const cpu01 = clamp01((latestSys.cpuPct ?? 0) / 100);
    const lvl = cpu01 < 0.65 ? "ok" : cpu01 < 0.85 ? "warn" : "bad";
    setBar(elSysCpuBar, cpu01, stale ? null : lvl);
  }

  // RAM
  if (elSysMemVal) elSysMemVal.textContent = Number.isFinite(latestSys.memPct) ? `${latestSys.memPct.toFixed(1)}%` : "—";
  if (elSysMemMB) {
    if (Number.isFinite(latestSys.memUsedMB) && Number.isFinite(latestSys.memTotalMB)) {
      elSysMemMB.textContent = `${latestSys.memUsedMB.toFixed(0)}/${latestSys.memTotalMB.toFixed(0)}MB`;
    } else {
      elSysMemMB.textContent = "—";
    }
  }
  if (elSysMemBar) {
    const mem01 = clamp01((latestSys.memPct ?? 0) / 100);
    const lvl = mem01 < 0.70 ? "ok" : mem01 < 0.85 ? "warn" : "bad";
    setBar(elSysMemBar, mem01, stale ? null : lvl);
  }

  // Temp
  if (elSysTempVal) elSysTempVal.textContent = Number.isFinite(latestSys.tempC) ? `${latestSys.tempC.toFixed(1)}°C` : "—";
  if (elSysTempBar) {
    const t = latestSys.tempC;
    const t01 = Number.isFinite(t) ? clamp01((t - 30) / 60) : 0; // 30..90 -> 0..1
    const lvl = !Number.isFinite(t) ? "ok" : t < 70 ? "ok" : t < 80 ? "warn" : "bad";
    setBar(elSysTempBar, t01, stale ? null : lvl);
  }
}

function updateMemHud() {
  if (!latestMem) return;

  const now = Date.now();
  const ageMs = Number.isFinite(latestMem.ts) ? Math.max(0, now - latestMem.ts) : Infinity;
  const stale = ageMs > 30000;

  if (elMemAge) elMemAge.textContent = fmtAge(ageMs);
  if (elMemDot) elMemDot.style.backgroundColor = stale ? "var(--warn)" : "var(--ok)";
  if (elMemStatus) elMemStatus.textContent = stale ? "daten alt" : "live";

  if (elTfTensorsVal) elTfTensorsVal.textContent = Number.isFinite(latestMem.tfT) ? `${Math.trunc(latestMem.tfT)}` : "—";
  if (elTfMemVal) elTfMemVal.textContent = Number.isFinite(latestMem.tfMB) ? `${latestMem.tfMB.toFixed(1)}MB` : "—";
  if (elHeapVal) elHeapVal.textContent = Number.isFinite(latestMem.heapMB) ? `${latestMem.heapMB.toFixed(1)}MB` : "—";
  if (elRssVal) elRssVal.textContent = Number.isFinite(latestMem.rssMB) ? `${latestMem.rssMB.toFixed(1)}MB` : "—";

  const tf01 = Number.isFinite(latestMem.tfMB) ? clamp01(latestMem.tfMB / 800) : 0;
  const heap01 = Number.isFinite(latestMem.heapMB) ? clamp01(latestMem.heapMB / 1000) : 0;
  const rss01 = Number.isFinite(latestMem.rssMB) ? clamp01(latestMem.rssMB / 2000) : 0;

  const tfLvl = tf01 < 0.50 ? "ok" : tf01 < 0.75 ? "warn" : "bad";
  const heapLvl = heap01 < 0.50 ? "ok" : heap01 < 0.75 ? "warn" : "bad";
  const rssLvl = rss01 < 0.50 ? "ok" : rss01 < 0.75 ? "warn" : "bad";

  setBar(elTfBar, tf01, stale ? null : tfLvl);
  setBar(elHeapBar, heap01, stale ? null : heapLvl);
  setBar(elRssBar, rss01, stale ? null : rssLvl);
}

// ------- drawing -------
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

  // Info overlay
  if (info) {
    const lagMs = Math.max(0, Date.now() - (frame?.ts || Date.now()));

    const pending = stats?.pendingIPC;
    const dropped = stats?.droppedIPC;
    const pendTxt = Number.isFinite(pending) ? ` pend=${Math.trunc(pending)}` : "";
    const dropTxt = Number.isFinite(dropped) ? ` drop=${Math.trunc(dropped)}` : "";

    const te = stats?.trainEvery;
    const trainEveryTxt = Number.isFinite(te) ? ` trainEvery=${Math.trunc(te)}` : "";

    const live = stats
      ? `ep=${stats.episode} steps=${stats.totalSteps} eps=${stats.eps} ` +
        `len=${stats.len} bestLen=${stats.bestLen} score=${stats.score} ` +
        `ret=${fmt(stats.epReturn, 2)} lag=${lagMs}ms ` +
        `sinceEat=${stats.sinceEat ?? "n/a"}` +
        pendTxt + dropTxt + trainEveryTxt +
        `  space(F/L/R)=${fmt(stats.spaceF, 3)}/${fmt(stats.spaceL, 3)}/${fmt(stats.spaceR, 3)} ` +
        `foodDist=${fmt(stats.foodDist, 3)} tailReach=${stats.tailReach ?? "n/a"} ` +
        `foodReach(F/L/R)=${stats.foodReachF ?? "n/a"}/${stats.foodReachL ?? "n/a"}/${stats.foodReachR ?? "n/a"}`
      : `lag=${lagMs}ms`;

    // MEM summary (trainer)
    let memTxt = "";
    if (latestMem) {
      const tfT = Number.isFinite(latestMem.tfT) ? Math.trunc(latestMem.tfT) : "n/a";
      const tfMB = Number.isFinite(latestMem.tfMB) ? latestMem.tfMB.toFixed(1) : "n/a";
      const heapMB = Number.isFinite(latestMem.heapMB) ? latestMem.heapMB.toFixed(1) : "n/a";
      const rssMB = Number.isFinite(latestMem.rssMB) ? latestMem.rssMB.toFixed(1) : "n/a";
      const rep = Number.isFinite(latestMem.replay) ? Math.trunc(latestMem.replay) : "n/a";
      memTxt = `  MEM tfT=${tfT} tfMB=${tfMB} heapMB=${heapMB} rssMB=${rssMB} replay=${rep}`;
    }

    // ADAPT summary (trainer)
    let adaptTxt = "";
    if (latestAdapt && Number.isFinite(latestAdapt.dynMaxTrainsPerSec)) {
      const tps = Math.trunc(latestAdapt.dynMaxTrainsPerSec);
      const cpu = Number.isFinite(latestAdapt.procCpuPct) ? latestAdapt.procCpuPct.toFixed(1) : "n/a";
      const mem = Number.isFinite(latestAdapt.memUsedPct) ? latestAdapt.memUsedPct.toFixed(1) : "n/a";
      const tmp = Number.isFinite(latestAdapt.tempC) ? latestAdapt.tempC.toFixed(1) : "n/a";
      adaptTxt = ` | adapt tps=${tps} cpu=${cpu}% mem=${mem}% temp=${tmp}°C`;
    }

    const progress =
      hist.len.length
        ? ` | avg(${WIN}) len=${fmt(avg(hist.len), 2)} score=${fmt(avg(hist.score), 2)} ret=${fmt(avg(hist.ret), 2)} ` +
          `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`
        : "";

    info.textContent = live + memTxt + adaptTxt + progress;
  }
}

// ------- detect/parse system stats from unknown formats -------
function looksLikeSysObj(o) {
  if (!o || typeof o !== "object") return false;
  return (
    Number.isFinite(o.cpuPct) ||
    Number.isFinite(o.memPct) ||
    Number.isFinite(o.tempC) ||
    Number.isFinite(o.memUsedMB) ||
    Number.isFinite(o.memTotalMB)
  );
}

function parseSysTextBlock(txt) {
  // Accepts your multiline style:
  // CPU\n53.1%\nRAM\n20.6% 1665/8063MB\nTemp\n84.8°C\n...
  if (typeof txt !== "string") return null;
  const t = txt.replace(/\r/g, "");

  const cpuM = t.match(/CPU\s*[\n: ]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
  const ramPctM = t.match(/RAM\s*[\n: ]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
  const ramMbM = t.match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*MB/i);
  const tempM = t.match(/Temp\s*[\n: ]\s*([0-9]+(?:\.[0-9]+)?)\s*°?C/i);

  if (!cpuM && !ramPctM && !ramMbM && !tempM) return null;

  const cpuPct = cpuM ? parseFloat(cpuM[1]) : null;
  const memPct = ramPctM ? parseFloat(ramPctM[1]) : null;
  const memUsedMB = ramMbM ? parseFloat(ramMbM[1]) : null;
  const memTotalMB = ramMbM ? parseFloat(ramMbM[2]) : null;
  const tempC = tempM ? parseFloat(tempM[1]) : null;

  return {
    cpuPct: Number.isFinite(cpuPct) ? cpuPct : null,
    memPct: Number.isFinite(memPct) ? memPct : null,
    memUsedMB: Number.isFinite(memUsedMB) ? memUsedMB : null,
    memTotalMB: Number.isFinite(memTotalMB) ? memTotalMB : null,
    tempC: Number.isFinite(tempC) ? tempC : null,
    ts: Date.now(),
  };
}

// ------- message unwrap (super robust) -------
function unwrap(msg) {
  if (!msg) return null;

  // direct
  if (msg.topic === "max7219/frame" && msg.payload?.rows) return { topic: "max7219/frame", frame: msg.payload, stats: msg.stats };
  if (msg.topic === "snake/episode" && msg.payload) return { topic: "snake/episode", payload: msg.payload };
  if (msg.topic === "snake/info" && msg.payload) return { topic: "snake/info", payload: msg.payload };
  if ((msg.topic === "sys/stats" || msg.topic === "system/stats" || msg.topic === "host/stats") && msg.payload) {
    return { topic: "sys/stats", payload: msg.payload };
  }

  // nested object (common with json node)
  const o = msg.payload;
  if (o?.topic === "max7219/frame" && o?.payload?.rows) return { topic: "max7219/frame", frame: o.payload, stats: o.stats };
  if (o?.topic === "snake/episode" && o?.payload) return { topic: "snake/episode", payload: o.payload };
  if (o?.topic === "snake/info" && o?.payload) return { topic: "snake/info", payload: o.payload };
  if ((o?.topic === "sys/stats" || o?.topic === "system/stats" || o?.topic === "host/stats") && o?.payload) {
    return { topic: "sys/stats", payload: o.payload };
  }

  // --- AUTO DETECT SYSTEM STATS even if topic differs ---
  // 1) object itself looks like sys
  if (looksLikeSysObj(msg.payload)) return { topic: "sys/stats", payload: msg.payload };
  if (looksLikeSysObj(o)) return { topic: "sys/stats", payload: o };

  // 2) maybe payload contains a sys/system field
  if (msg.payload?.sys && looksLikeSysObj(msg.payload.sys)) return { topic: "sys/stats", payload: msg.payload.sys };
  if (msg.payload?.system && looksLikeSysObj(msg.payload.system)) return { topic: "sys/stats", payload: msg.payload.system };
  if (o?.sys && looksLikeSysObj(o.sys)) return { topic: "sys/stats", payload: o.sys };
  if (o?.system && looksLikeSysObj(o.system)) return { topic: "sys/stats", payload: o.system };

  // 3) text block style
  const txt = typeof msg.payload === "string" ? msg.payload : (typeof o === "string" ? o : null);
  const parsed = txt ? parseSysTextBlock(txt) : null;
  if (parsed) return { topic: "sys/stats", payload: parsed };

  return null;
}

// ------- handlers -------
function handleEpisode(ep) {
  if (!ep) return;

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
      `best len=${best.len} score=${best.score} ret=${fmt(best.ret, 2)}`;
  }
}

function normalizeTrainerMem(p) {
  const tfT = p.tfNumTensors ?? p.tfT ?? p.tfTensors ?? null;
  const tfMB = p.tfNumBytesMB ?? p.tfMB ?? p.tfMemMB ?? null;
  const heapMB = p.heapUsedMB ?? p.heapMB ?? null;
  const rssMB = p.rssMB ?? p.rss ?? null;
  const replay = p.replayN ?? p.replay ?? null;
  const ts = p.ts ?? Date.now();

  return {
    tfT: Number.isFinite(tfT) ? tfT : null,
    tfMB: Number.isFinite(tfMB) ? tfMB : null,
    heapMB: Number.isFinite(heapMB) ? heapMB : null,
    rssMB: Number.isFinite(rssMB) ? rssMB : null,
    replay: Number.isFinite(replay) ? replay : null,
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
}

function handleInfoPayload(p) {
  if (!p) return;

  // Some flows forward system stats in snake/info
  if (p.msg === "sys" || p.msg === "system") {
    handleSysStatsPayload(p);
    return;
  }

  if (p.msg === "mem") {
    latestMem = normalizeTrainerMem(p);
    updateMemHud();
    return;
  }

  if (p.msg === "adapt") {
    latestAdapt = {
      dynMaxTrainsPerSec: Number.isFinite(p.dynMaxTrainsPerSec) ? p.dynMaxTrainsPerSec : null,
      procCpuPct: Number.isFinite(p.procCpuPct) ? p.procCpuPct : null,
      memUsedPct: Number.isFinite(p.memUsedPct) ? p.memUsedPct : null,
      tempC: Number.isFinite(p.tempC) ? p.tempC : null,
      ts: Date.now(),
    };
    return;
  }

  // Fallback: direct mem fields without msg==="mem"
  if (Number.isFinite(p.tfNumTensors) || Number.isFinite(p.tfNumBytesMB)) {
    latestMem = normalizeTrainerMem(p);
    updateMemHud();
  }
}

function handleSysStatsPayload(p) {
  if (!p) return;

  const ts = p.ts ?? Date.now();
  const cpuPct = p.cpuPct ?? p.cpu ?? p.cpu_percent ?? null;
  const memPct = p.memPct ?? p.mem ?? p.ramPct ?? null;
  const memUsedMB = p.memUsedMB ?? p.ramUsedMB ?? p.usedMB ?? null;
  const memTotalMB = p.memTotalMB ?? p.ramTotalMB ?? p.totalMB ?? null;
  const tempC = p.tempC ?? p.temp ?? p.temperature ?? null;

  latestSys = {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    cpuPct: Number.isFinite(cpuPct) ? cpuPct : null,
    memPct: Number.isFinite(memPct) ? memPct : null,
    memUsedMB: Number.isFinite(memUsedMB) ? memUsedMB : null,
    memTotalMB: Number.isFinite(memTotalMB) ? memTotalMB : null,
    tempC: Number.isFinite(tempC) ? tempC : null,
  };

  // CRITICAL: update container immediately
  updateSysHud();
}

// ------- smooth rendering: latest wins + requestAnimationFrame -------
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

// ------- tiny debug logging (throttled) -------
let dbgCount = 0;
let dbgLast = 0;
function dbg(msg) {
  const now = Date.now();
  if (now - dbgLast < 1000) return;
  dbgLast = now;
  if (dbgCount++ < 20) console.log("[UI msg]", msg);
}

// ------- start -------
document.addEventListener("DOMContentLoaded", () => {
  if (!initDom()) return;

  console.log("UI ready: waiting for messages…");

  // keep age/dot ticking even when messages pause
  setInterval(() => {
    updateSysHud();
    updateMemHud();
  }, 500);

  uibuilder.onChange("msg", (msg) => {
    dbg(msg);

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
      handleInfoPayload(u.payload);
      // mem/adapt/sys might have updated; refresh canvas line if we have frame
      if (latestFrame) scheduleDraw();
      return;
    }

    if (u.topic === "sys/stats") {
      handleSysStatsPayload(u.payload);
      // not necessary, but keeps info line fresh if you want:
      if (latestFrame) scheduleDraw();
      return;
    }
  });
});