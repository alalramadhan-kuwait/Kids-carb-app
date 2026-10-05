// The same meal again: what she ate in one sitting (entries less than 30 minutes apart, however they were logged)
// compared with earlier sittings by food, not by exact product or size: "Fries (Small)" and "World Famous Fries
// (Regular)" are the same food, "Chicken McNuggets 6 pcs" and "9 pcs" too. Two sittings are the same meal when most
// of the carbs of each are foods the other also had. Pure, so it is tested.
import type { HistoryEntry } from '../lib/types';

const MIN = 60000;
export const SITTING_GAP_MIN = 30;  // entries closer than this are one sitting
export const SAME_SCORE = 0.6;      // share of each sitting's carbs that must be food the other had too
const SMALL_G = 5;                  // a sitting below this is not a meal to compare

export interface SittingItem { key: string[]; label: string; carbs: number }
export interface Sitting { id: string; ids: string[]; t0: number; carbs: number; items: SittingItem[]; entries: HistoryEntry[] }

// sizes, counts and marketing words that do not change what the food is
const NOISE = new Set(['small', 'regular', 'medium', 'large', 'kids', 'kid', 'world', 'famous', 'original', 'mini', 'big', 'pcs', 'pc', 'pieces', 'piece',
  'صغير', 'صغيرة', 'وسط', 'كبير', 'كبيرة', 'حبة', 'حبات', 'قطع', 'قطعة']); // i18n-ok: data words
const UNIT = /^\d+([.,]\d+)?(g|gm|ml|l|kg|غ|مل)?$/i; // i18n-ok: unit words in data
const FILLER = new Set(['with', 'and', 'مع', 'و']); // i18n-ok: data words
// one word per food: «عيش» is rice in Kuwait, and «أرز»/«رز» are the same word
const SAME_WORD: Record<string, string> = { 'عيش': 'رز', 'ارز': 'رز', 'rice': 'رز' }; // i18n-ok: data words
/** Arabic spellings that differ only in alef, taa marbuta or alef maqsura, and the article. */
const plain = (w: string) => {
  const x = w.replace(/[\u0623\u0625\u0622]/g, '\u0627').replace(/\u0629/g, '\u0647').replace(/\u0649/g, '\u064A').replace(/^\u0627\u0644(?=\p{L}{3,})/u, '');
  return SAME_WORD[x] ?? x;
};

/** The words that say what a food is: brand, sizes, counts and amounts left out. */
export function foodKey(name: string): string[] {
  const base = name.split(' — ')[0].toLowerCase();
  const words = base.split(/[^\p{L}\p{N}.]+/u).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  return [...new Set(words.filter((w) => !NOISE.has(w) && !FILLER.has(w) && !UNIT.test(w) && w.length > 1).map(plain))];
}

/** Two foods are the same when one's words contain the other's, or most of their words are shared. */
export function sameFood(a: string[], b: string[]) {
  if (!a.length || !b.length) return false;
  const A = new Set(a), B = new Set(b), both = a.filter((w) => B.has(w)).length;
  return both === A.size || both === B.size || both / new Set([...a, ...b]).size >= 0.6;
}

const itemsOf = (h: HistoryEntry): SittingItem[] => {
  const lines = (h.lines ?? []).filter((l) => (l.carbs ?? 0) > 0 || l.role === 'main');
  if (!lines.length) return [{ key: foodKey(h.name), label: h.name, carbs: Number(h.total_carbs) || 0 }];
  return lines.map((l) => ({ key: foodKey(l.product ?? l.name), label: l.name, carbs: Number(l.carbs) || 0 }));
};

/** Every sitting, oldest first. A sitting is named after its first entry. */
export function sittings(history: HistoryEntry[]): Sitting[] {
  const hs = [...history].sort((a, b) => Date.parse(a.eaten_at) - Date.parse(b.eaten_at));
  const out: Sitting[] = [];
  for (const h of hs) {
    const t = Date.parse(h.eaten_at), last = out[out.length - 1];
    const lastT = last ? Date.parse(last.entries[last.entries.length - 1].eaten_at) : -Infinity;
    const s = last && t - lastT <= SITTING_GAP_MIN * MIN ? last : (out.push({ id: h.id, ids: [], t0: t, carbs: 0, items: [], entries: [] }), out[out.length - 1]);
    s.ids.push(h.id); s.entries.push(h); s.items.push(...itemsOf(h)); s.carbs += Number(h.total_carbs) || 0;
  }
  return out.filter((s) => s.carbs >= SMALL_G);
}

const shareMatched = (a: Sitting, b: Sitting) => {
  const total = a.items.reduce((n, i) => n + i.carbs, 0);
  if (total <= 0) return 0;
  return a.items.filter((i) => b.items.some((j) => sameFood(i.key, j.key))).reduce((n, i) => n + i.carbs, 0) / total;
};

/** 0–1: the smaller of "how much of A was in B" and "how much of B was in A", by carbs. The same recipe is 1. */
export function similarity(a: Sitting, b: Sitting) {
  const ra = a.entries.map((h) => h.recipe_id).filter(Boolean);
  if (ra.length && b.entries.some((h) => h.recipe_id && ra.includes(h.recipe_id))) return 1;
  return Math.min(shareMatched(a, b), shareMatched(b, a));
}

/** Earlier sittings that were the same meal, most alike first, then the most recent. */
export function sameMeals(target: Sitting, all: Sitting[], o: { days?: number; max?: number } = {}) {
  const from = target.t0 - (o.days ?? 90) * 86400000;
  return all
    .filter((s) => s.t0 < target.t0 - 2 * 3600000 && s.t0 >= from)
    .map((s) => ({ s, score: similarity(target, s) }))
    .filter((x) => x.score >= SAME_SCORE)
    .sort((a, b) => (Math.abs(b.score - a.score) > 0.05 ? b.score - a.score : b.s.t0 - a.s.t0))
    .slice(0, o.max ?? 3);
}

/** The sitting an entry belongs to. */
export const sittingOf = (id: string, all: Sitting[]) => all.find((s) => s.ids.includes(id)) ?? null;
