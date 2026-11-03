// Diag2: replicate shoot flow (enter mirror, Fit, hide demo) then dump tabs.
import { spawn } from "node:child_process";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WALL = "mirror-wall";
const PHONE = "mirror-phone";
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
    if (inner && inner.subtype === "error") throw new Error("EVAL: " + inner.description);
    return inner ? inner.value : undefined;
  };
  return { chrome, ws, send, ev, kill() { try { ws.close(); } catch {} chrome.kill(); } };
}
const phone = await launch({ port: 9251, profile: "/home/ecker-house/mirror-pr-phone2", width: 390, height: 844 });
try {
  await phone.send("Page.navigate", { url: "http://localhost:3001/#/admin/displays" });
  await sleep(3000);
  await phone.ev("localStorage.setItem('homeglow_device_name', '" + PHONE + "'); localStorage.setItem('widgetsLocked', 'true');");
  await phone.send("Page.reload", { ignoreCache: true });
  await sleep(2000);
  const deviceNames = (await (await fetch("http://localhost:3001/api/devices")).json()).map((d) => d.name);
  const entered = await phone.ev(`(() => {
    const names = ${JSON.stringify(deviceNames)};
    for (const btn of document.querySelectorAll('button[aria-label*="Remote control"]')) {
      let el = btn, rowName = null;
      for (let i = 0; i < 12 && el && !rowName; i++) {
        el = el.parentElement;
        if (!el) break;
        const span = [...el.querySelectorAll('span')].find(s => names.includes(s.innerText));
        if (span) rowName = span.innerText;
      }
      if (rowName === '${WALL}') { btn.click(); return true; }
    }
    return false;
  })()`);
  console.log("entered:", entered);
  await sleep(3000);
  console.log("aria BEFORE Fit:", JSON.stringify(await phone.ev(`[...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'))`)));
  const fitClicked = await phone.ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Fit');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  console.log("fit clicked:", fitClicked);
  await sleep(800);
  const hidden = await phone.ev(`(() => {
    const els = [...document.querySelectorAll('*')].filter(el => {
      if (!el.textContent || !el.textContent.includes('Demo Mode')) return false;
      return getComputedStyle(el).position === 'fixed';
    });
    els.forEach(el => { el.style.display = 'none'; });
    return els.length;
  })()`);
  console.log("hidden:", hidden);
  console.log("aria AFTER Fit+hide:", JSON.stringify(await phone.ev(`[...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'))`)));
  const tabResult = await phone.ev(`(() => {
    const el = [...document.querySelectorAll('[aria-label="Extras"], [title="Extras"]')][0];
    if (!el) return 'NOT_FOUND';
    (el.closest('button') || el).click();
    return 'CLICKED tag=' + el.tagName;
  })()`);
  console.log("tab click:", tabResult);
  await sleep(1500);
  console.log("mirror items:", await phone.ev("document.querySelectorAll('.react-grid-item').length"));
  console.log("banner text:", JSON.stringify((await phone.ev("document.body.innerText")).slice(0, 200)));
} finally {
  phone.kill();
}
