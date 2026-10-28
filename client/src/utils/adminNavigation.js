// URL hash navigation for the Admin Panel.
// Format: #/admin/{tab}/{section}/{subsection}[/{detail}]
// Examples:
//   #/admin                        — admin open, first tab
//   #/admin/family                 — Family tab, its first section (Users)
//   #/admin/family/chores/history  — Family tab, Chores section, History
//   #/admin/plugins/open/FamilyLists.html
//                                  — Plugins section, Open view for one plugin
// No hash (or unrecognized) — admin closed.
//
// Exception: the Open view drops the tab segment. Every other place
// carries its tab, but the open view's hash is #/admin/plugins/open/
// <file> — shorter, and the only shape the panel builds for it. The
// older dashboard-prefixed shape (#/admin/dashboard/plugins/open/
// <file>) still parses to the same location and is canonicalized to
// the short shape on build, so existing bookmarks keep working.
//
// The hash is kept current with history.replaceState, so a refresh or a
// bookmark returns to the same place without every tab click adding a history
// entry. Editing the hash by hand while the panel is open switches tabs.
//
// The optional fourth segment, detail, is only meaningful for the Plugins
// Open view, where it is the plugin's filename. It is kept verbatim (not
// lowercased): filenames are case-sensitive. Everywhere else it is null,
// so a location is always { tab, section, subsection, detail }.

// The panel's tabs, grouped by what you're managing (issue #230), each with
// its sections in display order. The first section of each list is the one a
// tab opens on. Section names are unique across tabs.
export const ADMIN_LAYOUT = [
  { tab: 'dashboard', sections: ['widgets', 'plugins', 'homeassistant', 'tabs'] },
  { tab: 'look', sections: [] },
  { tab: 'displays', sections: ['devices', 'screensaver', 'thisdisplay'] },
  {
    tab: 'family',
    sections: ['users', 'chores', 'routines', 'prizes', 'vacation'],
    subsections: { chores: ['definitions', 'history', 'settings'], routines: ['routines', 'steps'] },
  },
  { tab: 'security', sections: [] },
  { tab: 'system', sections: ['region', 'connections', 'notifications', 'about'] },
];

export const ADMIN_TABS = ADMIN_LAYOUT.map((entry) => entry.tab);

// Names from before #230, so old bookmarks and links land in the section's
// new home. The hash is then rewritten to the new name.
const LEGACY_TABS = {
  widgets: { tab: 'dashboard', section: 'widgets' },
  interface: { tab: 'look' },
  users: { tab: 'family', section: 'users' },
  chores: { tab: 'family', section: 'chores' },
  prizes: { tab: 'family', section: 'prizes' },
  connections: { tab: 'system', section: 'connections' },
  about: { tab: 'system', section: 'about' },
};

const layoutFor = (tab) => ADMIN_LAYOUT.find((entry) => entry.tab === tab) || ADMIN_LAYOUT[0];

// Fill in and correct a location: an unknown tab is the first tab, an unknown
// or missing section the tab's first, and likewise for a subsection. The
// Open view only exists under Plugins and only with a filename: an "open"
// without one, or a detail anywhere else, falls back to the plain section.
export function normalizeAdminLocation({ tab, section, subsection, detail } = {}) {
  const layout = layoutFor(tab);
  const sections = layout.sections;
  const normalSection = sections.includes(section) ? section : (sections[0] || null);
  const subsections = (normalSection && layout.subsections?.[normalSection]) || [];
  const normalSubsection = subsections.includes(subsection) ? subsection : (subsections[0] || null);
  const normalDetail = (normalSection === 'plugins' && subsection === 'open' && typeof detail === 'string' && detail)
    ? detail
    : null;
  const normalOpen = normalSection === 'plugins' && subsection === 'open' && normalDetail;
  return {
    tab: layout.tab,
    section: normalSection,
    subsection: normalOpen ? 'open' : normalSubsection,
    detail: normalDetail,
  };
}

// "#/admin" with up to four path segments, optionally with a trailing slash,
// and nothing else: "#/administrator" is not the Admin Panel.
const ADMIN_HASH = /^#\/admin(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?\/?$/;

export function isAdminHash(hash = window.location.hash) {
  return ADMIN_HASH.test(hash || '');
}

function decodeSegment(part) {
  if (!part) return '';
  try {
    return decodeURIComponent(part);
  } catch (e) {
    return part;
  }
}

export function parseAdminHash(hash = window.location.hash) {
  const match = (hash || '').match(ADMIN_HASH);
  if (!match) return null;
  const [first, second, third] = match.slice(1, 4).map((part) => (part || '').toLowerCase());
  // The filename keeps its case; the section names above do not.
  const detail = decodeSegment(match[4] || '');

  // The Open view drops the tab segment: #/admin/plugins/open/<file>.
  // 'plugins' is not a tab and 'open' is not a section, so this shape
  // cannot collide with a normal location. It must be exactly three
  // segments; a fourth falls through to normal parsing (and its generic
  // fallback) below. Without a filename it is the plain Plugins list,
  // the same rule as the dashboard-prefixed shape.
  if (first === 'plugins' && second === 'open' && !match[4]) {
    const file = decodeSegment(match[3] || '');
    if (file) return normalizeAdminLocation({ tab: 'dashboard', section: 'plugins', subsection: 'open', detail: file });
    return normalizeAdminLocation({ tab: 'dashboard', section: 'plugins' });
  }

  const legacy = LEGACY_TABS[first];
  if (legacy) {
    // Old links had at most one level below the tab: chores/history.
    return normalizeAdminLocation({ ...legacy, subsection: second });
  }
  return normalizeAdminLocation({ tab: first, section: second, subsection: third, detail });
}

// The canonical hash for a location. A section or subsection that is the
// default for its parent is left off, so "#/admin/family" rather than
// "#/admin/family/users". A detail is always shown (the Open view has no
// default plugin), URL-encoded so filenames with spaces round-trip.
// The Open view drops the tab segment: #/admin/plugins/open/<file>.
export function buildAdminHash(location) {
  const { tab, section, subsection, detail } = normalizeAdminLocation(location);
  if (section === 'plugins' && subsection === 'open' && detail) {
    return `#/admin/plugins/open/${encodeURIComponent(detail)}`;
  }
  const layout = layoutFor(tab);
  const parts = [tab];
  const subsections = (section && layout.subsections?.[section]) || [];
  const subsectionShown = subsection && subsection !== subsections[0];
  if (section && (section !== layout.sections[0] || subsectionShown)) parts.push(section);
  if (subsectionShown) parts.push(subsection);
  if (detail) parts.push(encodeURIComponent(detail));
  return `#/admin/${parts.join('/')}`;
}

export function clearAdminHash() {
  if (isAdminHash()) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function setAdminHash(location) {
  const hash = buildAdminHash(location);
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash);
  }
}
