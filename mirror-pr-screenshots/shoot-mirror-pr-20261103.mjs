// Mirror PR final screenshots (2026-11-03) + tab-isolation check.
// Captures, with NEW filenames: Devices (local Admin), mirror Fit, mirror 2x,
// mirror-Admin Devices (banner-above-panel chrome, Exit-only).
// Also asserts: mirror banner has NO Admin button; mirror tab switch to
// Extras leaves the wall on Home (wall still shows 2 Home items while the
// mirror shows 1 Extras item); mirror-Admin dialog has exactly ONE banner
// with Exit and neither Unlock nor Lock.
// Exits 0 only if every assertion passes and all 4 shots are written.
import { spawn } from "node:child_process";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = "http://localhost:3001/api";
const WALL = "mirror-wall";
const PHONE = "mirror-phone";
const OUT = "/home/ecker-house/mirror-pr/";
let failures = 0;
const check = (label, cond, extra) => {
  console.log((cond ? "PASS: " : "FAIL: ") + label + (cond ? "" : " :: " + (extra || "")));
  if (!cond) failures++;
};

const api = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + String(t).slice(0, 200));
  return j;
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
  await send("Page.enable", {});
  const ev = async (expr) => {
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    const inner = res.result ? res.result.result : undefined;
    if (inner && inner.subtype === "error") throw new Error("EVAL: " + (inner.description || expr.slice(0, 120)));
    return inner ? inner.value : undefined;
  };
  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", {
    type, x, y, button: "left", clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
  });
  const shot = async (path) => {
    const res = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path, Buffer.from(res.result.data, "base64"));
    console.log("SHOT: " + path + " bytes=" + fs.statSync(path).size);
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
    chrome, ws, send, ev, mouse, shot, waitFor,
    kill() { try { ws.close(); } catch { /* ignore */ } chrome.kill(); },
  };
}

const clickButtonText = async (b, text) => b.ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '${text}');
  if (!btn) return false;
  btn.click();
  return true;
})()`);
const enterMirror = async (b, deviceNames, target) => b.ev(`(() => {
  const names = ${JSON.stringify(deviceNames)};
  for (const btn of document.querySelectorAll('button[aria-label*="Remote control"]')) {
    let el = btn, rowName = null;
    for (let i = 0; i < 12 && el && !rowName; i++) {
      el = el.parentElement;
      if (!el) break;
      const span = [...el.querySelectorAll('span')].find(s => names.includes(s.innerText));
      if (span) rowName = span.innerText;
    }
    if (rowName === '${target}') { btn.click(); return true; }
  }
  return false;
})()`);
const bannerButtonsEval = (target) => `(() => {
  const leaf = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.innerText && e.innerText.trim() === 'Mirroring ${target}');
  if (!leaf) return 'NO_BANNER';
  const box = leaf.parentElement;
  if (!box) return 'NO_BOX';
  const btns = [...box.querySelectorAll('button')].map(b => b.innerText.trim());
  return { buttons: btns, hasAdmin: btns.includes('Admin'), hasExit: btns.includes('Exit mirror') };
})()`;
const dialogBannerEval = (target) => `(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return 'NO_DIALOG';
  const leaves = [...d.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.innerText || '').includes('Mirroring ${target}')).length;
  const btns = [...d.querySelectorAll('button')].map(b => b.innerText.trim());
  return { leaves, hasExit: btns.includes('Exit mirror'), hasUnlock: btns.includes('Unlock layout'), hasLock: btns.includes('Lock layout') };
})()`;
const clickDockSettings = async (b, mx, my) => {
  await b.mouse("mouseMoved", mx, my);
  await sleep(600);
  const logo = await b.ev(`(() => {
    const img = document.querySelector('img[alt="HomeGlow"]');
    if (!img) return false;
    img.parentElement.click();
    return true;
  })()`);
  if (!logo) return "NO_LOGO";
  await sleep(500);
  const item = await b.ev(`(() => {
    const leaf = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.innerText && e.innerText.trim() === 'Settings');
    if (!leaf) return false;
    leaf.click();
    return true;
  })()`);
  return item ? "CLICKED" : "NO_ITEM";
};
const clickTab = async (b, label) => b.ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '${label}');
  if (btn) { btn.click(); return 'BUTTON'; }
  const leaf = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.innerText && e.innerText.trim() === '${label}');
  if (leaf) { leaf.click(); return 'LEAF'; }
  return false;
})()`);
const gridCount = async (b) => b.ev("document.querySelectorAll('.react-grid-item').length");
const hideDemo = async (b) => b.ev(`(() => {
  const els = [...document.querySelectorAll('*')].filter(el => {
    if (!el.textContent || !el.textContent.includes('Demo Mode')) return false;
    return getComputedStyle(el).position === 'fixed';
  });
  els.forEach(el => { el.style.display = 'none'; });
  return els.length;
})()`);

const wall = await launch({ port: 9248, profile: "/home/ecker-house/mirror-pr-wall2", width: 1280, height: 1200 });
const phone = await launch({ port: 9249, profile: "/home/ecker-house/mirror-pr-phone2", width: 390, height: 844 });
try {
  // ---- setup: photogenic wall (Home: calendar+weather; Extras: weather) ----
  await api("GET", "/devices/" + WALL + "/settings");
  await api("PATCH", "/devices/" + WALL + "/settings", { widgetSettings: { calendar: { enabled: true }, weather: { enabled: true } } });
  for (const w of ["calendar", "weather"]) {
    try { await api("POST", "/devices/" + WALL + "/widget-assignments", { widget_name: w, tabNumber: 1 }); } catch (e) { if (!/already exists/.test(e.message)) throw e; }
  }
  await api("PATCH", "/devices/" + WALL + "/widget-assignments/layout/bulk", {
    layouts: [
      { widget_name: "calendar", tabNumber: 1, layout_x: 0, layout_y: 0, layout_w: 6, layout_h: 4 },
      { widget_name: "weather", tabNumber: 1, layout_x: 6, layout_y: 0, layout_w: 6, layout_h: 4 },
    ],
  });
  const existingTabs = await api("GET", "/devices/" + WALL + "/tabs");
  let extrasTab = (Array.isArray(existingTabs) ? existingTabs : []).find((t) => t.label === "Extras");
  if (!extrasTab) extrasTab = await api("POST", "/devices/" + WALL + "/tabs", { label: "Extras", icon: "star", show_label: 1 });
  try { await api("POST", "/devices/" + WALL + "/widget-assignments", { widget_name: "weather", tabNumber: extrasTab.number }); } catch (e) { if (!/already exists/.test(e.message)) throw e; }
  await api("PATCH", "/devices/" + WALL + "/widget-assignments/layout/bulk", {
    layouts: [{ widget_name: "weather", tabNumber: extrasTab.number, layout_x: 0, layout_y: 0, layout_w: 6, layout_h: 4 }],
  });
  await api("GET", "/devices/" + PHONE + "/settings");
  await api("PATCH", "/devices/" + PHONE + "/settings", { widgetSettings: { calendar: { enabled: true }, weather: { enabled: true } } });
  try { await api("POST", "/devices/" + PHONE + "/widget-assignments", { widget_name: "calendar", tabNumber: 1 }); } catch (e) { if (!/already exists/.test(e.message)) throw e; }

  await wall.send("Page.navigate", { url: "http://localhost:3001/" });
  await sleep(3000);
  await wall.ev("localStorage.setItem('homeglow_device_name', '" + WALL + "'); localStorage.setItem('widgetsLocked', 'true');");
  await wall.send("Page.reload", { ignoreCache: true });
  check("wall renders 2 grid items (Home)", await wall.waitFor("wall grid", async () => (await gridCount(wall)) >= 2));

  await phone.send("Page.navigate", { url: "http://localhost:3001/#/admin/displays" });
  await sleep(3000);
  await phone.ev("localStorage.setItem('homeglow_device_name', '" + PHONE + "'); localStorage.setItem('widgetsLocked', 'true');");
  await phone.send("Page.reload", { ignoreCache: true });
  check("phone Admin Devices lists both devices", await phone.waitFor("devices list", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes(WALL) && t.includes(PHONE);
  }));
  await sleep(800);
  await phone.shot(OUT + "shot-devices-pr-20261103.png");

  const deviceNames = (await api("GET", "/devices")).map((d) => d.name);
  check("remote-control button click entered mirror", (await enterMirror(phone, deviceNames, WALL)) === true);
  check("mirror banner names the target", await phone.waitFor("mirror banner", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes("Mirroring " + WALL);
  }));
  await phone.waitFor("mirror grid items", async () => (await gridCount(phone)) >= 2, 15000);
  const mvBtns = await phone.ev(bannerButtonsEval(WALL));
  console.log("mirror-view banner buttons:", JSON.stringify(mvBtns));
  check("mirror banner has NO Admin button (new chrome)", mvBtns && mvBtns.hasAdmin === false, JSON.stringify(mvBtns));
  check("mirror banner has Exit mirror", mvBtns && mvBtns.hasExit === true, JSON.stringify(mvBtns));

  // ---- Fit shot ----
  await clickButtonText(phone, "Fit");
  await sleep(800);
  const hidden = await hideDemo(phone);
  console.log("demo overlays hidden:", hidden);
  await phone.shot(OUT + "shot-mirror-fit-pr-20261103.png");

  // ---- Tab isolation: mirror -> Extras, wall stays on Home ----
  const tabClicked = await clickTab(phone, "Extras");
  console.log("mirror Extras tab click:", tabClicked);
  check("mirror Extras tab clicked", tabClicked === "BUTTON" || tabClicked === "LEAF", String(tabClicked));
  await sleep(1500);
  const mirrorCount = await gridCount(phone);
  const wallCount = await gridCount(wall);
  console.log("after mirror tab switch: mirror items=" + mirrorCount + " wall items=" + wallCount);
  check("mirror on Extras shows 1 item (weather only)", mirrorCount === 1, "mirror=" + mirrorCount);
  check("wall stayed on Home (still 2 items)", wallCount === 2, "wall=" + wallCount);
  const backClicked = await clickTab(phone, "Home");
  check("mirror Home tab clicked back", backClicked === "BUTTON" || backClicked === "LEAF", String(backClicked));
  await sleep(1500);
  check("mirror back on Home shows 2 items", (await gridCount(phone)) === 2);

  // ---- 2x zoom shot (page-scroll pan, new architecture) ----
  await clickButtonText(phone, "2×");
  await sleep(1000);
  await phone.ev("window.scrollTo(60, 0);");
  await sleep(600);
  await hideDemo(phone);
  await phone.shot(OUT + "shot-mirror-zoom-pr-20261103.png");

  // ---- Mirror-Admin Devices shot (banner above panel, Exit-only) ----
  await clickButtonText(phone, "Fit");
  await sleep(500);
  check("dock Settings opens mirror-Admin", (await clickDockSettings(phone, 195, 800)) === "CLICKED");
  check("mirror-Admin opens on the top-level menu page", await phone.waitFor("admin top-level", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes("Admin Panel") && t.includes("Widgets");
  }, 15000));
  check("Devices list item clicked", (await phone.ev(`(() => {
    const leaf = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.innerText && e.innerText.trim() === 'Devices');
    if (!leaf) return false;
    leaf.click();
    return true;
  })()`)) === true);
  check("mirror-Admin Devices page loaded", await phone.waitFor("admin devices", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes(WALL) && t.includes("Current Device Name");
  }, 15000));
  const dlg = await phone.ev(dialogBannerEval(WALL));
  console.log("mirror-Admin dialog banner:", JSON.stringify(dlg));
  check("mirror-Admin dialog has exactly ONE banner", dlg && dlg.leaves === 1, JSON.stringify(dlg));
  check("mirror-Admin dialog banner has Exit, no Unlock/Lock", dlg && dlg.hasExit === true && dlg.hasUnlock === false && dlg.hasLock === false, JSON.stringify(dlg));
  await sleep(800);
  await phone.shot(OUT + "shot-mirror-admin-pr-20261103.png");
} finally {
  wall.kill();
  phone.kill();
}
console.log(failures === 0 ? "SHOOT: OK" : "SHOOT: " + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
