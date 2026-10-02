// Picking a product's picture from its maker's page. Pure, tested in Node.
// A page for one product: its share image (og:image), else the best-matching picture.
// A page listing several products: only a picture whose name or description matches this product; never a guess.

const GENERIC = new Set(['with', 'and', 'the', 'no', 'added', 'sugar', 'free', 'beverage', 'drink', 'cups', 'cup', 'full', 'cream', 'ltr', 'ml', 'kids', 'premium', 'juice', 'milk']);
/** The words that tell this product apart, e.g. "Mango Peach Beverage (0% Sugar) 250ml" → mango, peach. */
export function keyWords(name: string): string[] {
  return [...new Set(name.toLowerCase().replace(/[^a-z\u0600-\u06ff ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w)))];
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? null;
const abs = (src: string, base: string) => { try { return new URL(src.replace(/&amp;/g, '&'), base).href; } catch { return null; } };
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** Only the maker's own sites (kddc.com, www.kddc.com, eshop.kddc.com): no picture from anywhere else is accepted. */
export const ALLOWED = ['kddc.com'];
export function allowedHost(u: string): boolean {
  try { const h = new URL(u).hostname.toLowerCase(); return ALLOWED.some((d) => h === d || h.endsWith('.' + d)); } catch { return false; }
}
/** http links are read as https (the maker's sites serve both). */
export const toHttps = (u: string) => u.replace(/^http:\/\//i, 'https://');
const isPicture = (u: string) => /^https:\/\//.test(u) && allowedHost(u) && !/\.(svg|gif)(\?|$)/i.test(u) && !/(logo|icon|sprite|placeholder|banner|flag|payment)/i.test(u);

export interface Candidate { url: string; text: string }
/** Every picture on the page with the words around it (alt, title, file name). */
export function pictures(html: string, base: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'data-src') ?? attr(tag, 'data-lazy-src') ?? attr(tag, 'src') ?? attr(tag, 'srcset')?.split(/[ ,]/)[0] ?? null;
    const url = src ? abs(src, base) : null;
    if (!url || !isPicture(url)) continue;
    const text = [attr(tag, 'alt'), attr(tag, 'title'), safeDecode(url.split('/').pop() ?? '').replace(/[-_]+/g, ' ')].filter(Boolean).join(' ').toLowerCase();
    out.push({ url, text });
  }
  // pictures the page loads another way (lazy-load attributes, srcset, background images, scripts): every image
  // link in the page, described by its file name
  const seen = new Set(out.map((c) => c.url));
  for (const m of html.replace(/\\\//g, '/').matchAll(/(?:https?:)?\/\/[^\s"'()<>,]+?\.(?:png|jpe?g|webp)(?:\?[^\s"'()<>,]*)?|\/wp-content\/[^\s"'()<>,]+?\.(?:png|jpe?g|webp)/gi)) {
    const url = abs(m[0].startsWith('//') ? 'https:' + m[0] : m[0], base);
    if (!url || seen.has(url) || !isPicture(url)) continue;
    seen.add(url);
    out.push({ url, text: safeDecode(url.split('/').pop() ?? '').toLowerCase().replace(/[-_]+/g, ' ') });
  }
  return out;
}
export function shareImage(html: string, base: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const p = (attr(m[0], 'property') ?? attr(m[0], 'name') ?? '').toLowerCase();
    if (p === 'og:image' || p === 'og:image:secure_url' || p === 'twitter:image') { const u = attr(m[0], 'content'); const a = u ? abs(u, base) : null; if (a && isPicture(a)) return a; }
  }
  return null;
}

/** The picture for `name` on this page, or null when none can be told apart with confidence. */
export function pickImage(html: string, base: string, name: string, shared: boolean): string | null {
  if (!allowedHost(base)) return null;
  const words = keyWords(name);
  const scored = pictures(html, base).map((c) => ({ ...c, s: words.filter((w) => c.text.includes(w)).length }));
  const best = scored.filter((c) => c.s > 0).sort((a, b) => b.s - a.s)[0];
  if (shared) return best && best.s >= Math.min(2, words.length) ? best.url : null;
  return shareImage(html, base) ?? best?.url ?? byFullName(scored, name);
}

/** A page for one product whose name is all common words ("Full Cream Milk 250ml"): the picture labelled with
 *  most of the full name, the largest size of it (e.g. 543x543 over a 114x114 thumbnail), English before Arabic. */
function byFullName(cands: Candidate[], name: string): string | null {
  const all = [...new Set(name.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3))];
  if (!all.length) return null;
  const size = (u: string) => { const m = /(\d{2,4})x(\d{2,4})/.exec(u); return m ? +m[1] * +m[2] : 0; };
  const fit = cands.map((c) => ({ ...c, f: all.filter((w) => c.text.includes(w)).length / all.length }))
    .filter((c) => c.f >= 0.6)
    .sort((a, b) => b.f - a.f || size(b.url) - size(a.url) || Number(/-en[-.]/.test(b.url)) - Number(/-en[-.]/.test(a.url)));
  return fit[0]?.url ?? null;
}

/** A maker's nutrition table (page text) as values per 100 g or ml, or null when it has no carbohydrate line.
 *  Tables for another amount ("per 94 g") are scaled to 100. */
export interface Label { basis: number; unit: 'g' | 'ml'; kcal: number | null; fat: number | null; carbs: number; fiber: number | null; sugars: number | null; protein: number | null }
export function parseLabel(text: string): Label | null {
  const at = text.search(/nutrition (facts|information|value)/i);
  if (at < 0) return null;
  const end = text.slice(at).search(/write a review|ingredients|storage/i);
  const t = text.slice(at, end > 0 ? at + end : at + 2000);
  const b = /per\s*(\d+(?:\.\d+)?)\s*(ml|millilit|g\b|gm|grm|gram)/i.exec(t);
  const basis = b ? Number(b[1]) : 100, unit: 'g' | 'ml' = b && /^m/i.test(b[2]) ? 'ml' : b ? 'g' : 'ml';
  const get = (label: RegExp) => {
    const m = new RegExp('(?:' + label.source + ')' + String.raw`\s*(?:\([^)]*\))?\s*:?\s*(\d+(?:\.\d+)?)`, 'i').exec(t);
    return m ? Math.round((Number(m[1]) * 100 / basis) * 10) / 10 : null;
  };
  const carbs = get(/(?:total\s+)?carbohydrates?/);
  if (carbs === null || !(basis > 0)) return null;
  return { basis, unit, carbs, kcal: get(/energy|calories(?!\s+from)/), fat: get(/total\s+fat/) ?? get(/(?<!from\s)\bfat/), fiber: get(/dietary\s+fib(?:re|er)s?/) ?? get(/\bfib(?:re|er)s?/),
    sugars: get(/total\s+sugars?/) ?? get(/(?<!added\s)\bsugars?/), protein: get(/protein/) };
}
/** Pack size from a product name: "Mango Nectar 250ml" → 250 ml, "Apple Juice 1 LTR" → 1000 ml, "Labneh 500 GRM." → 500 g. */
export function packOf(name: string): { size: number; unit: 'g' | 'ml' } | null {
  const m = /(\d+(?:\.\d+)?)\s*(ml|ltr|litre|liter|l|grms?|gms?|gm|g|kg)(?![a-z])/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]), u = m[2].toLowerCase();
  if (/^(ltr|litre|liter|l)$/.test(u)) return { size: n * 1000, unit: 'ml' };
  if (u === 'kg') return { size: n * 1000, unit: 'g' };
  return u === 'ml' ? { size: n, unit: 'ml' } : { size: n, unit: 'g' };
}
/** Does the label add up? Energy within 20% (or 10 kcal) of 4·carbs + 4·protein + 9·fat. */
export function labelAddsUp(l: Label): boolean {
  if (l.kcal === null || l.fat === null || l.protein === null) return false;
  const est = 4 * l.carbs + 4 * l.protein + 9 * l.fat;
  return Math.abs(est - l.kcal) <= Math.max(10, 0.2 * l.kcal);
}
