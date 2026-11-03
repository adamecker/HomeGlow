// Mirror Admin-banner + Devices-target :3001 verification (follow-up fixes).
// Two simulated devices (wall 1280px, phone 390px) against the mirror branch
// deployed on :3001. Asserts:
//  (B) panel-top "Mirroring <target>" banner on EVERY Admin page in
//      mirror-Admin (Devices + Widgets tabs checked);
//  (A) mirror-Admin Devices: section banner text, Target chip on the wall
//      row, NO delete button on the wall row, phone row still Current with
//      its (disabled) delete;
//  (DOCK, corrected expectation) the dock is PRESENT in mirror mode — the
//      dock-hiding change was cancelled by direction change, so the dock
//      must NOT be hidden by mirroring;
//  regression: mirror drag lands on the wall via bump WITHOUT reload, and
//      a mirror-Admin calendar toggle flips the WALL, not the phone;
//  exit: Admin Devices normal again (no mirror banner, Current = phone,
//      wall row delete back), and the dock renders on the phone dashboard.
// Exits 0 only if every assertion passes.
import { spawn } from "node:child_process";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = "http://localhost:3001/api";
const WALL = "mirror-wall";
const PHONE = "mirror-phone";
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
const getLayout = async (dev) => {
  const tabs = await api("GET", "/devices/" + dev + "/tabs");
  const tab = Array.isArray(tabs) ? tabs[0] : null;
  return tab && tab.config_json ? JSON.parse(tab.config_json) : {};
};
const getSettings = async (dev) => api("GET", "/devices/" + dev + "/settings");

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
  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", {
    type, x, y, button: "left", clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
  });
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
    chrome, ws, send, ev, mouse, waitFor,
    kill() { try { ws.close(); } catch { /* ignore */ } chrome.kill(); },
  };
}

// Map rows: for each element matching `selector`, walk up to the smallest
// ancestor that also contains a device-name span, and report that name.
const rowMapEval = (selector, deviceNames) => `(() => {
  const names = ${JSON.stringify(deviceNames)};
  const out = [];
  for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
    let node = el, rowName = null;
    for (let i = 0; i < 14 && node && !rowName; i++) {
      node = node.parentElement;
      if (!node) break;
      const span = [...node.querySelectorAll('span')].find(s => names.includes(s.innerText));
      if (span) rowName = span.innerText;
    }
    out.push({ text: (el.innerText || '').trim(), row: rowName });
  }
  return out;
})()`;

const wall = await launch({ port: 9241, profile: "/home/ecker-house/mirror-verify-wall", width: 1280, height: 1200 });
const phone = await launch({ port: 9242, profile: "/home/ecker-house/mirror-verify-phone", width: 390, height: 844 });
try {
  // ---- setup (same devices/layout as the earlier mirror run) ----
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
  await api("GET", "/devices/" + PHONE + "/settings");
  await api("PATCH", "/devices/" + PHONE + "/settings", { widgetSettings: { calendar: { enabled: true }, weather: { enabled: true } } });
  try { await api("POST", "/devices/" + PHONE + "/widget-assignments", { widget_name: "calendar", tabNumber: 1 }); } catch (e) { if (!/already exists/.test(e.message)) throw e; }

  // ---- wall browser baseline ----
  await wall.send("Page.navigate", { url: "http://localhost:3001/" });
  await sleep(3000);
  await wall.ev("localStorage.setItem('homeglow_device_name', '" + WALL + "'); localStorage.setItem('widgetsLocked', 'true');");
  await wall.send("Page.reload", { ignoreCache: true });
  check("wall renders 2 grid items", await wall.waitFor("wall grid", async () =>
    (await wall.ev("document.querySelectorAll('.react-grid-item').length")) >= 2));
  const wallCalBefore = await wall.ev(`(() => {
    const items = [...document.querySelectorAll('.react-grid-item')];
    const r = items[0].getBoundingClientRect();
    return { top: r.top, left: r.left };
  })()`);
  let wallViewport = null;
  for (let i = 0; i < 20 && !wallViewport; i++) {
    const v = await api("GET", "/devices/" + WALL + "/viewport");
    if (v.viewport) wallViewport = v.viewport;
    else await sleep(500);
  }
  check("wall reported a viewport", !!wallViewport, JSON.stringify(wallViewport));

  // ---- phone: Admin Devices -> mirror entry ----
  await phone.send("Page.navigate", { url: "http://localhost:3001/#/admin/displays" });
  await sleep(3000);
  await phone.ev("localStorage.setItem('homeglow_device_name', '" + PHONE + "'); localStorage.setItem('widgetsLocked', 'false');");
  await phone.send("Page.reload", { ignoreCache: true });
  check("phone Admin Devices lists both devices", await phone.waitFor("devices list", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes(WALL) && t.includes(PHONE);
  }));
  const deviceNames = (await api("GET", "/devices")).map((d) => d.name);
  const entered = await phone.ev(`(() => {
    const names = ${JSON.stringify(deviceNames)};
    for (const b of document.querySelectorAll('button[aria-label*="Remote control"]')) {
      let el = b, rowName = null;
      for (let i = 0; i < 12 && el && !rowName; i++) {
        el = el.parentElement;
        if (!el) break;
        const span = [...el.querySelectorAll('span')].find(s => names.includes(s.innerText));
        if (span) rowName = span.innerText;
      }
      if (rowName === '${WALL}') { b.click(); return true; }
    }
    return false;
  })()`);
  check("remote-control button click entered mirror", entered === true);
  check("mirror banner names the target", await phone.waitFor("mirror banner", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes("Mirroring " + WALL);
  }));
  await phone.waitFor("mirror grid items", async () => {
    const n = await phone.ev("document.querySelectorAll('.react-grid-item').length");
    return n && n > 0;
  }, 15000);
  // DOCK (corrected expectation): the dock renders in mirror mode — the
  // dock-hiding change was cancelled, so the logo img (dock-only) is in DOM.
  const dockInMirror = await phone.ev("!!document.querySelector('img[alt=\"HomeGlow\"]')");
  check("dock renders in mirror mode (dock-hiding cancelled)", dockInMirror === true);

  // ---- banner Admin -> mirror-Admin: panel-top banner on Devices ----
  const adminClicked = await phone.ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Admin');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check("mirror banner Admin clicked", adminClicked === true);
  check("mirror-Admin opens on Devices", await phone.waitFor("admin devices", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes(WALL) && t.includes("Current Device Name");
  }, 15000));
  const panelBannerDevices = await phone.ev("document.body.innerText").then((t) => t && t.includes("Mirroring " + WALL));
  check("(B) panel-top Mirroring banner on Devices page", panelBannerDevices === true);
  const devicesBannerText = await phone.ev("document.body.innerText").then((t) =>
    t && t.includes("device changes here apply to the wall, not this phone"));
  check("(A) Devices section banner text", devicesBannerText === true);
  const chips = await phone.ev(rowMapEval(".MuiChip-label", deviceNames));
  console.log("chips by row:", JSON.stringify(chips));
  const targetChip = chips.find((c) => c.text === "Target");
  const currentChip = chips.find((c) => c.text === "Current");
  check("(A) Target chip on the wall row", targetChip && targetChip.row === WALL, JSON.stringify(chips));
  check("(A) Current chip still on the phone row", currentChip && currentChip.row === PHONE, JSON.stringify(chips));
  const deletes = await phone.ev(rowMapEval('button[aria-label="Delete device"]', deviceNames));
  console.log("delete buttons by row:", JSON.stringify(deletes));
  check("(A) NO delete button on the wall row in mirror-Admin",
    !deletes.some((d) => d.row === WALL), JSON.stringify(deletes));
  check("(A) phone row still offers its (disabled) delete",
    deletes.some((d) => d.row === PHONE), JSON.stringify(deletes));

  // ---- (B) panel-top banner on another Admin page (Widgets) ----
  await phone.ev("window.location.hash = '#/admin/dashboard';");
  check("(B) panel-top Mirroring banner on Widgets page", await phone.waitFor("widgets banner", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.toUpperCase().includes("CALENDAR WIDGET") && t.includes("Mirroring " + WALL);
  }, 15000));

  // ---- close Admin -> back to mirror -> drag regression ----
  await phone.ev(`(() => {
    const b = document.querySelector('button[aria-label="Close"]');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1000);
  check("closing Admin from mirror returns to the mirror", await phone.waitFor("mirror returns", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.includes("Mirroring " + WALL);
  }));
  const readCanvas = async () => phone.ev(`(() => {
    const grid = document.querySelector('.react-grid-layout');
    if (!grid) return null;
    let el = grid;
    while (el) {
      const cs = getComputedStyle(el);
      if (cs.transform && cs.transform !== 'none') {
        const m = /matrix\(([^,]+),/.exec(cs.transform);
        return { width: parseFloat(cs.width), scale: m ? parseFloat(m[1]) : null };
      }
      el = el.parentElement;
    }
    return null;
  })()`);
  const canvas = await readCanvas();
  const fitScale = canvas ? canvas.scale : null;
  await phone.ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Fit');
    if (b) b.click();
    return true;
  })()`);
  await sleep(800);
  const unlockState = await phone.ev(`(() => {
    const unlock = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Unlock layout');
    if (unlock) { unlock.click(); return 'UNLOCKED'; }
    const lock = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Lock layout');
    return lock ? 'ALREADY_UNLOCKED' : 'NO_BUTTON';
  })()`);
  check("mirror banner unlock ready for drag", unlockState === 'UNLOCKED' || unlockState === 'ALREADY_UNLOCKED', unlockState);
  await sleep(500);
  const dragResult = await (async () => {
    const first = await phone.ev(`(() => {
      const items = [...document.querySelectorAll('.react-grid-item')];
      items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      if (!items.length) return null;
      const r = items[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!first) return "NO_ITEM";
    await phone.mouse("mouseMoved", first.x, first.y);
    await sleep(200);
    await phone.mouse("mousePressed", first.x, first.y);
    await sleep(200);
    await phone.mouse("mouseReleased", first.x, first.y);
    await sleep(600);
    const h = await phone.ev(`(() => {
      const items = [...document.querySelectorAll('.react-grid-item')];
      items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const hd = items[0] ? items[0].querySelector('.drag-handle') : null;
      if (!hd) return null;
      const r = hd.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!h) return "NO_HANDLE";
    await phone.mouse("mouseMoved", h.x, h.y);
    await sleep(200);
    await phone.mouse("mousePressed", h.x, h.y);
    await sleep(200);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await phone.mouse("mouseMoved", h.x, h.y + (150 * i) / steps);
      await sleep(60);
    }
    await phone.mouse("mouseReleased", h.x, h.y + 150);
    await sleep(3000);
    return "DRAGGED";
  })();
  check("mirror drag executed", dragResult === "DRAGGED", dragResult);
  const layoutAfterDrag = await getLayout(WALL);
  const yAfter = layoutAfterDrag.calendar ? layoutAfterDrag.calendar.layout_y : null;
  const expectedY = fitScale ? Math.round((150 / fitScale) / 116) : null;
  console.log("wall layout after mirror drag:", JSON.stringify(layoutAfterDrag), "expected y:", expectedY);
  check("mirror drag lands on the correct row", yAfter === expectedY, "y=" + yAfter + " expected=" + expectedY);
  const wallMoved = await wall.waitFor("wall picks up drag without reload", async () => {
    const r = await wall.ev(`(() => {
      const items = [...document.querySelectorAll('.react-grid-item')];
      return items.length ? items[0].getBoundingClientRect().top : -1;
    })()`);
    return r > wallCalBefore.top + 300;
  }, 25000);
  check("wall picks up mirror drag via bump WITHOUT reload", wallMoved === true);
  const phoneLayout = await getLayout(PHONE);
  const phoneY = phoneLayout.calendar ? phoneLayout.calendar.layout_y : null;
  check("phone's own layout untouched by the mirror drag", phoneY === 0 || phoneY === null, "phone y=" + phoneY);

  // ---- mirror-Admin toggle regression: WALL flips, phone stays ----
  const adminClicked2 = await phone.ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Admin');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check("mirror banner Admin clicked (2nd time)", adminClicked2 === true);
  await phone.ev("window.location.hash = '#/admin/dashboard';");
  await phone.waitFor("widgets section", async () => {
    const t = await phone.ev("document.body.innerText");
    return t && t.toUpperCase().includes("CALENDAR WIDGET");
  }, 15000);
  const toggled = await phone.ev(`(() => {
    const titles = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.innerText && e.innerText.trim().toUpperCase() === 'CALENDAR WIDGET');
    if (!titles.length) return 'NO_TITLE';
    let section = titles[0];
    for (let i = 0; i < 8 && section; i++) {
      const container = section.parentElement;
      if (!container) break;
      const sw = container.querySelector('input[aria-label="Enabled"]') || container.querySelector('input[type="checkbox"]');
      if (sw) { sw.click(); return 'CLICKED'; }
      section = container;
    }
    return 'NO_SWITCH';
  })()`);
  check("calendar Enabled switch toggled in mirror-Admin", toggled === "CLICKED", toggled);
  const saved = await phone.ev(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.innerText.trim().startsWith('Save'));
    if (!btns.length) return false;
    btns[0].click();
    return true;
  })()`);
  check("Admin Save clicked", saved === true);
  await sleep(2500);
  const wallSettingsAfter = await getSettings(WALL);
  const phoneSettingsAfter = await getSettings(PHONE);
  check("mirror-Admin setting changes the TARGET", wallSettingsAfter?.widgetSettings?.calendar?.enabled === false,
    "wall=" + wallSettingsAfter?.widgetSettings?.calendar?.enabled);
  check("mirror-Admin setting leaves the PHONE unchanged", phoneSettingsAfter?.widgetSettings?.calendar?.enabled === true,
    "phone=" + phoneSettingsAfter?.widgetSettings?.calendar?.enabled);

  // ---- exit -> Admin Devices normal again ----
  await phone.ev(`(() => {
    const b = document.querySelector('button[aria-label="Close"]');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1000);
  const exitClicked = await phone.ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Exit mirror');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check("mirror Exit clicked", exitClicked === true);
  check("exit returns to Admin Devices", await phone.waitFor("exit lands", async () => {
    const h = await phone.ev("window.location.hash");
    const t = await phone.ev("document.body.innerText");
    return h === "#/admin/displays" && t && t.includes(WALL);
  }));
  const afterExitText = await phone.ev("document.body.innerText");
  check("no Mirroring banner after exit", !(afterExitText && afterExitText.includes("Mirroring " + WALL)));
  check("no Devices mirror banner after exit",
    !(afterExitText && afterExitText.includes("device changes here apply to the wall")));
  const chipsAfter = await phone.ev(rowMapEval(".MuiChip-label", deviceNames));
  const currentAfter = chipsAfter.find((c) => c.text === "Current");
  const targetAfter = chipsAfter.find((c) => c.text === "Target");
  check("Current chip back on the phone row after exit", currentAfter && currentAfter.row === PHONE, JSON.stringify(chipsAfter));
  check("no Target chip after exit", !targetAfter, JSON.stringify(chipsAfter));
  const deletesAfter = await phone.ev(rowMapEval('button[aria-label="Delete device"]', deviceNames));
  check("wall row delete back after exit", deletesAfter.some((d) => d.row === WALL), JSON.stringify(deletesAfter));
  // Close Admin -> phone dashboard: dock renders again.
  await phone.ev(`(() => {
    const b = document.querySelector('button[aria-label="Close"]');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1500);
  const dockAfter = await phone.ev("!!document.querySelector('img[alt=\"HomeGlow\"]')");
  check("dock renders on the phone dashboard after exit", dockAfter === true);
} finally {
  wall.kill();
  phone.kill();
}

console.log(failures === 0 ? "VERIFY: ALL ASSERTIONS PASSED" : "VERIFY: " + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
