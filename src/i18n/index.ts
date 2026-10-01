// Two languages: Arabic (the source text, right-to-left) and English (left-to-right). The Arabic string is the
// key, so the code reads in Arabic as before; English comes from the dictionaries in ./en. A missing English entry
// falls back to the Arabic text (and the test suite fails on it). Chosen per phone; push alerts follow each
// parent's choice through carb.members.lang.
import { useEffect, useState } from 'react';
import { EN } from './en';

export type Lang = 'ar' | 'en';
const KEY = 'lang';

function initial(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'ar' || v === 'en') return v; } catch { /* private mode */ }
  return 'ar';
}
let current: Lang = typeof localStorage === 'undefined' ? 'ar' : initial();

export const lang = () => current;
export const isEn = () => current === 'en';
export const dir = (): 'rtl' | 'ltr' => (current === 'en' ? 'ltr' : 'rtl');
/** For dates and times: Latin digits in both languages. */
export const locale = () => (current === 'en' ? 'en-GB' : 'ar-KW');

type Params = Record<string, string | number | null | undefined>;

/**
 * t('نص {x}', { x }) → the text in the current language with {x} filled in.
 * English plurals: "one|many" picks by params.n (1 → first form).
 */
export function t(ar: string, p?: Params): string {
  let s = current === 'en' ? EN[ar] ?? ar : ar;
  if (current === 'en' && p && s.includes('|') && 'n' in p) { const [one, many] = s.split('|'); s = Number(p.n) === 1 ? one : many; }
  if (p) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k] ?? '') : m));
  return s;
}

/**
 * A lookup table kept in Arabic whose string values are translated when read: TREND_WORDS[3] → 'Steady' in
 * English. (Object.entries/values see the raw Arabic; read through the keys instead.)
 */
export function tr<T extends object>(o: T): T {
  return new Proxy(o, { get: (x, k) => { const v = Reflect.get(x, k); return typeof v === 'string' ? t(v) : v; } });
}

/** For values that may be user data (category names): translated when the dictionary knows them. */
export const tMaybe = (s: string | null | undefined) => (s ? (current === 'en' ? EN[s] ?? s : s) : '');

export function applyLang(l: Lang = current) {
  current = l;
  if (typeof document !== 'undefined') { document.documentElement.lang = l; document.documentElement.dir = dir(); document.title = t('ليان'); }
}
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  applyLang(l);
  window.dispatchEvent(new Event('langchange'));
}
/** Re-renders when the language changes; returns it so it can key a subtree. */
export function useLang(): Lang {
  const [l, setL] = useState(current);
  useEffect(() => { const f = () => setL(current); window.addEventListener('langchange', f); return () => window.removeEventListener('langchange', f); }, []);
  return l;
}
/** Only for tests. */
export const __setLangForTest = (l: Lang) => { current = l; };
