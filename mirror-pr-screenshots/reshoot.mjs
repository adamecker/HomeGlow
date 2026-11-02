// PR re-shoot: mirror fit + 2x zoom views with the fixed demo overlay hidden
// (screenshot framing only — the overlay is test scaffolding, not mirror UI).
// No state changes except navigation/zoom/pan view state. Exits 0 on success.
import { spawn } from "node:child_process";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WALL = "mirror-wall";
const PHONE = "mirror-phone";
let failures = 0;
const check = (label, cond, extra) => {
  console.log((cond ? "PASS: " : "FAIL: ") + label + (cond ? "" : " :: " + (extra || "")));
  if (!cond) failures++;
};

async function launch({ port, profile, width, height }) {
  const chrome = spawn("/opt/google/chrome/chrome", [
    "--headless=new", `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, `--window-size=${width},${height}`,
    "--no-first-run", "--disable-gpu", "about:blank",
  ], { stdio: "ignore" });
  let page = null;
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
      page = targets.find((t) => t.type === "page") || targets[0];
      if (page) break;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  if (!page) throw new Error("NO_PAGE_TARGET port " + port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    const inner = res.result ? res.result.result : undefined;
    if (inner && inner.subtype === "error") throw new Error("EVAL: " + (inner.description || expr.slice(0, 120)));
    return inner ? inner.value : undefined;
  };
  const shot = async (path) => {
    const res = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path, Buffer.from(res.result.data, "base64"));
  };
  const waitFor = async (label, fn, timeoutMs = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (await fn()) return true; } catch { /* retry */ }
      await sleep(500);
    }
    console.log("TIMEOUT waiting for: " + label);
    return false;
  };
  return {
    chrome, ws, send, ev, shot, waitFor,
    kill() { try { ws.close(); } catch { /* ignore */ } chrome.kill(); },
  };
}

const phone = await launch({ port: 9244, profile: "/home/ecker-house/mirror-pr-phone", width: 390, height: 844 });
try {
  // Restore the wall device to a photogenic state first: the earlier full
  // test pass left its calendar dragged and disabled. (Test device only.)
  await fetch("http://localhost:3001/api/devices/" + WALL + "/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widgetSettings: { calendar: { enabled: true }, weather: { enabled: true } } }),
  });
  await fetch("http://localhost:3001/api/devices/" + WALL + "/widget-assignments/layout/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layouts: [
      { widget_name: "calendar", tabNumber: 1, layout_x: 0, layout_y: 0, layout_w: 6, layout_h: 4 },
      { widget_name: "weather", tabNumber: 1, layout_x: 6, layout_y: 0, layout_w: 6, layout_h: 4 },
    ] }),
  });
  await phone.send("Page.navigate", { url: "http://localhost:3001/#/mirror/" + WALL });
  await sleep(3000);
  await phone.ev("localStorage.setItem('homeglow_device_name', '" + PHONE + "'); localStorage.setItem('widgetsLocked', 'false');");
  await phone.send("Page.reload", { ignoreCache: true });
  check("mirror banner names the target", await phone.waitFor("mirror banner", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes("Mirroring " + WALL);
  }));
  await phone.waitFor("mirror grid items", async () => {
    const n = await phone.ev("document.querySelectorAll('.react-grid-item').length");
    return n && n > 0;
  }, 15000);
  // Hide ONLY the fixed demo overlay (position:fixed + "Demo Mode" text).
  // Ancestors share the text but are not fixed, so this cannot hide app UI.
  const hidden = await phone.ev(`(() => {
    const els = [...document.querySelectorAll('*')].filter(el => {
      if (!el.textContent || !el.textContent.includes('Demo Mode')) return false;
      return getComputedStyle(el).position === 'fixed';
    });
    els.forEach(el => { el.style.display = 'none'; });
    return els.length;
  })()`);
  console.log("demo overlays hidden:", hidden);
  check("demo overlay hidden", hidden > 0, "hidden=" + hidden);
  await phone.ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Fit');
    if (b) b.click();
    return true;
  })()`);
  await sleep(800);
  await phone.shot("/home/ecker-house/mirror-pr/shot-mirror-fit-pr-202611021345.png");
  console.log("fit screenshot saved");
  const zoomed = await phone.ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '2×');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check("2x zoom button clicked", zoomed === true);
  await sleep(1000);
  const scrolled = await phone.ev(`(() => {
    const grid = document.querySelector('.react-grid-layout');
    let el = grid;
    while (el) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowX === 'auto') && (el.scrollHeight > el.clientHeight + 10 || el.scrollWidth > el.clientWidth + 10)) {
        el.scrollTop = 100; el.scrollLeft = 60;
        return { top: el.scrollTop, left: el.scrollLeft };
      }
      el = el.parentElement;
    }
    return null;
  })()`);
  console.log("zoom pan:", JSON.stringify(scrolled));
  await phone.shot("/home/ecker-house/mirror-pr/shot-mirror-zoom-pr-202611021345.png");
  console.log("zoom screenshot saved");
} finally {
  phone.kill();
}

console.log(failures === 0 ? "RESHOOT: OK" : "RESHOOT: " + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
