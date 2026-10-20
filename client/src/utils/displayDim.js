// Kiosk display dimming for wall panels whose backlight floor is still too
// bright: applies a CSS brightness filter to the whole app so the rendered
// pixels themselves are darker. The video signal stays live (a dim-but-live
// image does not trip the panel's no-signal power save) and Chrome does the
// compositing internally, so no compositor alpha is involved.
//
// Value comes from the ?dim= URL parameter first, then localStorage 'hg-dim'
// (the kiosk autostart URL can carry it). 1.0 or absent = no dimming.
// Live tuning from devtools: hgSetDim(0.6) to dim, hgSetDim() to clear.
//
// Note: a filter on <html> makes it the containing block for fixed-position
// descendants; since <html> is viewport-sized in this app, in-app modals and
// toasts keep their layout and dim along with everything else.
const KEY = 'hg-dim';

export function resolveDim() {
  let raw = null;
  try {
    raw = new URLSearchParams(window.location.search).get('dim');
  } catch {
    // ignore
  }
  if (raw == null) {
    try {
      raw = window.localStorage.getItem(KEY);
    } catch {
      // ignore
    }
  }
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}

export function applyDim(v) {
  const el = document.documentElement;
  if (v == null || !Number.isFinite(v) || v <= 0 || v > 1) {
    el.style.filter = '';
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    return;
  }
  el.style.filter = `brightness(${v})`;
  try {
    window.localStorage.setItem(KEY, String(v));
  } catch {
    // ignore
  }
}

export function initDisplayDim() {
  window.hgSetDim = (v) => applyDim(v == null ? null : parseFloat(v));
  const v = resolveDim();
  if (v != null) applyDim(v);
}
