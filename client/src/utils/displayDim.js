// Kiosk display dimming for wall panels whose backlight floor is still too
// bright: dims the rendered pixels themselves with a CSS brightness filter,
// so the screen can go darker than the hardware allows. The video signal
// stays live (a dim-but-live image does not trip the panel's no-signal
// power save) and Chrome does the compositing internally.
//
// Behavior mirrors a screensaver overlay: full brightness while the panel
// is being used, fading to the target level after an idle delay, and back
// to full brightness on the next interaction. Two target levels are
// supported on a schedule: a milder daytime level and a much darker
// night level (default window 00:00-06:00).
//
// Configuration (URL query parameter wins over localStorage):
//   ?dim=0.6        daytime target brightness (0-1; unset = no day dim)
//   ?dimNight=0.08  night target brightness (unset = same as day)
//   ?nightStart=0   night window start hour, local time (default 0)
//   ?nightEnd=6     night window end hour, local time (default 6)
//   ?dimAfter=20    idle seconds before dimming (default 20; 0 = always)
// Levels persist to localStorage 'hg-dim' / 'hg-dim-night'. Live tuning
// from devtools: hgSetDim(0.6) sets the day level, hgSetDim() disables.
//
// While dimmed, the page background is forced black (unpainted canvas
// would otherwise show as a bright edge) and scrollbars are hidden
// (Chrome composites them outside the filtered layer, full-brightness).
// Wake detection uses a transparent full-screen shield while dimmed:
// plugin widgets render in iframes whose pointer events never reach this
// document, but the shield sits above them and catches the first tap.
const KEY = 'hg-dim';
const NIGHT_KEY = 'hg-dim-night';
const AFTER_KEY = 'hg-dim-after';
const DEFAULT_AFTER_S = 20;
const DEFAULT_NIGHT_START = 0;
const DEFAULT_NIGHT_END = 6;

let dayTarget = null;
let nightTarget = null;
let nightStart = DEFAULT_NIGHT_START;
let nightEnd = DEFAULT_NIGHT_END;
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

function parseHour(raw, fallback) {
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v >= 0 && v <= 24 ? v : fallback;
}

function resolveConfig() {
  dayTarget = parseLevel(param('dim') ?? stored(KEY));
  nightTarget = parseLevel(param('dimNight') ?? stored(NIGHT_KEY));
  if (nightTarget == null) nightTarget = dayTarget;
  nightStart = parseHour(param('nightStart'), DEFAULT_NIGHT_START);
  nightEnd = parseHour(param('nightEnd'), DEFAULT_NIGHT_END);
  const afterRaw = param('dimAfter') ?? stored(AFTER_KEY);
  const after = parseFloat(afterRaw);
  idleAfterMs = (Number.isFinite(after) && after >= 0 ? after : DEFAULT_AFTER_S) * 1000;
}

function isNight(now = new Date()) {
  const h = now.getHours();
  if (nightStart === nightEnd) return false;
  if (nightStart < nightEnd) return h >= nightStart && h < nightEnd;
  return h >= nightStart || h < nightEnd;
}

function activeTarget() {
  return isNight() ? nightTarget : dayTarget;
}

function render() {
  const el = document.documentElement;
  const t = activeTarget();
  el.style.transition = 'filter 0.6s ease';
  // Scrollbars are composited by Chrome outside the filtered layer and
  // would stay full-brightness (a white strip at the edge); hide them
  // while dimmed via the hg-dimmed class styled in ensureStyle().
  el.classList.toggle('hg-dimmed', dimmed && t != null);
  if (shield) shield.style.display = dimmed && t != null ? 'block' : 'none';
  if (dimmed && t != null) {
    el.style.filter = `brightness(${t})`;
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
  dayTarget = v == null ? null : parseLevel(v);
  store(KEY, dayTarget == null ? null : String(dayTarget));
  if (nightTarget == null) nightTarget = dayTarget;
  if (activeTarget() == null) setDimmed(false);
  else if (idleAfterMs === 0) setDimmed(true);
  else render();
}

export function initDisplayDim() {
  resolveConfig();
  ensureStyle();
  ensureShield();
  window.hgSetDim = (v) => applyDim(v == null ? null : v);
  if (dayTarget == null && nightTarget == null) return;
  for (const ev of ['pointerdown', 'touchstart', 'keydown', 'wheel']) {
    window.addEventListener(ev, poke, { passive: true, capture: true });
  }
  lastActivity = Date.now();
  if (idleAfterMs === 0) setDimmed(true);
  window.setInterval(() => {
    if (!dimmed && activeTarget() != null && Date.now() - lastActivity >= idleAfterMs) {
      setDimmed(true);
    } else if (dimmed) {
      // Re-render so a day/night boundary crossing retargets the level.
      render();
    }
  }, 1000);
}
