// How a brand looks on the Nutrition page: a coloured badge with its initials and a food picture, worked out from the
// brand's own products, unless the family chose a colour, a picture or a logo photo (carb.brand_looks). Pure.
import { groupOf } from './productGroups';

export interface BrandLookRow { brand: string; kind: 'restaurant' | 'brand' | null; bg: string | null; emoji: string | null; photo_path: string | null }
export interface BrandLook { bg: string; fg: string; mark: string; emoji: string; photo: string | null; kind: 'restaurant' | 'brand' }

/** The colours offered (strong enough for white letters). */
export const BRAND_COLOURS = ['#E4002B', '#DA291C', '#E07B1F', '#C8962E', '#2E7D4F', '#1B6E3A', '#0B5FA5', '#2C5282', '#7B3FA0', '#8C1D18', '#B83280', '#334155'];
/** The food pictures offered. */
export const BRAND_EMOJI = ['🍗', '🍟', '🍔', '🍕', '🌯', '🥗', '🍦', '🍨', '🥛', '🧃', '🧀', '🍞', '🥣', '🍫', '🍪', '🍩', '🍰', '🥔', '🌾', '🥜', '🍝', '🍚', '🍯', '☕'];

const hash = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

/** Up to three letters: the first letter of each word («Diet Care» → DC), or the first two of one word (Almarai →
 *  AL); an all-capitals name stays as it is (KDD, PICK). Arabic drops «ال» first (المطاحن → مط). */
export function brandMark(brand: string): string {
  const b = brand.trim().replace(/[’']/g, '');
  if (/^[A-Z0-9&]{2,4}$/.test(b)) return b;
  const words = b.split(/[\s\-_.]+/).filter(Boolean).map((w) => w.replace(/^ال/, '')); // i18n-ok: the Arabic article
  if (words.length > 1) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? '?').slice(0, 2).replace(/^./, (c) => c.toUpperCase()).replace(/^(.)(.)$/, (_, a, c) => a + c.toUpperCase());
}

/** The look of one brand from its products (most common food group picks the picture) and the family's choice. */
export function brandLook(brand: string, products: { category: string | null }[], row?: BrandLookRow | null, restaurant = false): BrandLook {
  const n = new Map<string, number>();
  for (const p of products) { const e = groupOf(p.category).emoji; n.set(e, (n.get(e) ?? 0) + 1); }
  const top = [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '🛒';
  return {
    bg: row?.bg ?? BRAND_COLOURS[hash(brand) % BRAND_COLOURS.length], fg: '#FFFFFF', mark: brandMark(brand),
    emoji: row?.emoji ?? top, photo: row?.photo_path ?? null, kind: row?.kind ?? (restaurant ? 'restaurant' : 'brand'),
  };
}
