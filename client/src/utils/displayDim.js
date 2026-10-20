// Kiosk display dimming for wall panels whose backlight floor is still too
// bright: dims the rendered pixels themselves with a CSS brightness filter,
// so the screen can go darker than the hardware allows. The video signal
// stays live (a dim-but-live image does not trip the panel's no-signal
// power save) and Chrome does the compositing internally.
//
// Behavior mirrors a screensaver overlay: full brightness while the panel
// is being used, fading to the target level after an idle delay, and back
// to full brightness on the next touch/click/keypress.
//
// Configuration (URL query parameter wins over localStorage):
//   ?dim=0.08       target brightness while dimmed (0-1; unset = disabled)
//   ?dimAfter=20    idle seconds before dimming (default 20; 0 = always)
// Persisted to localStorage 'hg-dim' / 'hg-dim-after'. Live tuning from
// devtools: hgSetDim(0.08) sets the target, hgSetDim() disables dimming.
//
// While dimmed, the page background is forced black: the filter only covers
// painted content, and any unpainted sliver of the default white canvas
// would otherwise show as a bright edge line.
const KEY = 'hg-dim';
const AFTER_KEY = 'hg-dim-after';
const DEFAULT_AFTER_S = 20;

let target = null;
let idleAfterMs = DEFAULT_AFTER_S * 1000;
let dimmed = false;
let lastActivity = Date.now();
let shield = null;

function stored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function param(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function parseLevel(raw) {
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}

function resolveConfig() {
  target = parseLevel(param('dim') ?? stored(KEY));
  const afterRaw = param('dimAfter') ?? stored(AFTER_KEY);
  const after = parseFloat(afterRaw);
  idleAfterMs = (Number.isFinite(after) && after >= 0 ? after : DEFAULT_AFTER_S) * 1000;
}

function render() {
  const el = document.documentElement;
  el.style.transition = 'filter 0.6s ease';
  // Scrollbars are composited by Chrome outside the filtered layer and
  // would stay full-brightness (a white strip at the edge); hide them
  // while dimmed via the hg-dimmed class styled in ensureStyle().
  el.classList.toggle('hg-dimmed', dimmed && target != null);
  if (shield) shield.style.display = dimmed && target != null ? 'block' : 'none';
  if (dimmed && target != null) {
    el.style.filter = `brightness(${target})`;
    el.style.backgroundColor = '#000';
    if (document.body) document.body.style.backgroundColor = '#000';
  } else {
    el.style.filter = '';
    el.style.backgroundColor = '';
    if (document.body) document.body.style.backgroundColor = '';
  }
}

function ensureStyle() {
  if (document.getElementById('hg-dim-style')) return;
  const style = document.createElement('style');
  style.id = 'hg-dim-style';
  style.textContent =
    'html.hg-dimmed, html.hg-dimmed * { scrollbar-width: none !important; }' +
    'html.hg-dimmed::-webkit-scrollbar, html.hg-dimmed *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
  document.head.appendChild(style);
}

// Plugin widgets render in iframes, whose pointer events never reach this
// document — a wake listener here is blind to taps/scrolls inside plugins.
// While dimmed, a transparent shield above everything (iframes included)
// catches the first interaction anywhere and wakes the panel; the wake
// gesture is consumed, like a screensaver dismiss.
function ensureShield() {
  if (shield) return;
  shield = document.createElement('div');
  shield.id = 'hg-dim-shield';
  shield.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:transparent;display:none;touch-action:none;';
  for (const ev of ['pointerdown', 'touchstart', 'wheel']) {
    shield.addEventListener(ev, poke, { passive: true });
  }
  document.body.appendChild(shield);
}

function setDimmed(next) {
  if (dimmed === next) return;
  dimmed = next;
  render();
}

function poke() {
  lastActivity = Date.now();
  if (dimmed) setDimmed(false);
}

export function applyDim(v) {
  target = v == null ? null : parseLevel(v);
  store(KEY, target == null ? null : String(target));
  if (target == null) setDimmed(false);
  else if (idleAfterMs === 0) setDimmed(true);
}

export function initDisplayDim() {
  resolveConfig();
  ensureStyle();
  ensureShield();
  window.hgSetDim = (v) => applyDim(v == null ? null : v);
  if (target == null) return;
  for (const ev of ['pointerdown', 'touchstart', 'keydown', 'wheel']) {
    window.addEventListener(ev, poke, { passive: true, capture: true });
  }
  lastActivity = Date.now();
  if (idleAfterMs === 0) setDimmed(true);
  window.setInterval(() => {
    if (!dimmed && Date.now() - lastActivity >= idleAfterMs) setDimmed(true);
  }, 1000);
}
