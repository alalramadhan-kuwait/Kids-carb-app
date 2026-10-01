// Appearance on this phone: automatic (the phone's dark mode, plus night colours in the night window), or
// always day / always night. Kept per device, not shared, because each parent's phone is different.
export type ThemePref = 'auto' | 'day' | 'night';
const KEY = 'theme_pref';

export function themePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); return v === 'day' || v === 'night' ? v : 'auto'; } catch { return 'auto'; }
}
export function setThemePref(p: ThemePref) {
  try { if (p === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* private mode */ }
  window.dispatchEvent(new Event('themepref'));
}
