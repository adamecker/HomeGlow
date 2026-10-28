// The Admin Panel Open view's plugin iframe src (Phase 2a, mechanism only).
//
// Mobile contract: the SHELL decides mobile context from the viewport and
// hands it to the frame as a `mobile=1` query param; the frame trusts the
// signal. No plugin UA-sniffing, and no second breakpoint: the caller passes
// the same `useIsMobile()` value the rest of the app uses —
// `(max-width:599.95px)`, MUI's `sm` cutoff — which is the dashboard phone
// layout's cutoff (MobileDashboard replaces the grid below 600px, issue
// #118). A viewport at or above 600px gets no mobile param at all, so a
// desktop/wall Open view renders exactly what it rendered before this file
// existed: same theme/device/lang params, same order, nothing else appended.
//
// What this does NOT do: it does not change what any plugin renders. A
// plugin that ignores `mobile=1` looks exactly as before; adopting the
// signal (e.g. a compact layout) is each plugin's own decision, and the
// Family Lists adoption belongs with the Simple/Manage widget split, not
// here. Later phases (a manifest companion file, core widgets as a
// single-widget stack) are separate decisions, not extensions of this param.
export function buildPluginOpenSrc({ apiBaseUrl, filename, theme, device, lang, isMobile }) {
  const base = `${apiBaseUrl}/widgets/${encodeURIComponent(filename)}?theme=${theme || 'light'}&device=${encodeURIComponent(device)}&lang=${lang || 'en'}`;
  return isMobile ? `${base}&mobile=1` : base;
}
