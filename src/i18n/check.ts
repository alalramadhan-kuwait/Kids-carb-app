// Node-only check used by the test suite: every t('…') key has an English entry with the same {params}, no t()
// is given a template literal, and no Arabic text is left outside t(). A line may opt out with `// i18n-ok`
// (data that must stay Arabic, e.g. matching stored category names).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from './en';

const AR = /[\u0600-\u06FF]/;
const CALL = /\b(?:t|tMaybe)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'en') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && f !== 'check.ts') out.push(p);
  }
  return out;
}

/** Strip comments, keeping line numbers. */
function code(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => {
    let q: string | null = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; }
      else if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '/' && l[i + 1] === '/' && !/[:=(,]\s*$/.test(l.slice(0, i)) ) return l.slice(0, i);
    }
    return l;
  });
}

export function checkI18n(root: string) {
  const missing: string[] = [], params: string[] = [], bare: string[] = [], templ: string[] = [];
  const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1');
  for (const f of walk(root)) {
    const lines = code(readFileSync(f, 'utf8'));
    const raw = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (raw[i].includes('i18n-ok')) return;
      if (/\bt\(\s*`/.test(l)) templ.push(`${f}:${i + 1}`);
      for (const m of l.matchAll(CALL)) {
        const key = unescape(m[2]);
        if (!AR.test(key)) continue;
        const en = EN[key];
        if (en === undefined) { if (!/tMaybe\(/.test(m[0])) missing.push(`${f}:${i + 1}  ${key}`); continue; }
        const ps = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
        const enPs = [...new Set(en.split('|').flatMap((part) => ps(part).split(',').filter(Boolean)))].sort().join(',');
        if (ps(key) !== enPs) params.push(`${f}:${i + 1}  ${key}  →  ${en}`);
      }
      if (AR.test(l.replace(CALL, ''))) bare.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
    });
  }
  return { missing, params, bare, templ };
}
