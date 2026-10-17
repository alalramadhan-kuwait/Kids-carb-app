// Nutrition labels read on the phone, with no AI and no key: the barcode (front photo) is looked up in Open Food
// Facts, and the nutrition table photo is read by on-device text recognition (Tesseract). Only fills a form that the
// parents check; anything unclear is left blank and flagged.
import { cleanLabel, type Label } from '../../supabase/functions/carb-food/estimate';

const NUM = String.raw`(\d{1,3}(?:[.,]\d)?)`;
const ROWS: [keyof Label['per100'], RegExp][] = [
  ['kcal', /(?:energy|calories|energie|kcal)/i],
  ['fat', /(?:^|\b)(?:total\s+)?fat\b(?!.*saturat)/i],
  ['carbs', /carbohydrate|carbs\b|glucides/i],
  ['sugar', /sugars?\b/i],
  ['fiber', /fib(?:re|er)/i],
  ['protein', /protein/i],
];

/** The first number on the line after the row name (per-100 is the first column on EU and Gulf labels). */
function firstNumber(line: string, key: keyof Label['per100'], guessed: Set<string>): number | null {
  if (key === 'kcal') {
    const k = line.match(new RegExp(NUM + String.raw`\s*kcal`, 'i')) ?? line.match(new RegExp(String.raw`kcal\D{0,6}` + NUM, 'i'));
    if (k) return Number(k[1].replace(',', '.'));
  }
  const m = line.replace(/\b\d+\s*%/g, '').match(new RegExp(NUM + String.raw`\s*(?:g|9|q)?\b`));
  if (!m) return null;
  // "26g" is often read as "269": a gram amount over 100 ending in 9 lost its g
  if (/^\d{2}9$/.test(m[1])) { guessed.add(key); return Number(m[1].slice(0, 2)); }
  return Number(m[1].replace(',', '.'));
}

/** Turns the recognised text of a nutrition table into label values. Pure, so it is tested. */
export function parseLabelText(text: string): Label {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const guessed = new Set<string>();
  const per100: Record<string, number | null> = { carbs: null, sugar: null, fiber: null, fat: null, protein: null, kcal: null };
  for (const line of lines) {
    for (const [k, re] of ROWS) {
      if (per100[k] !== null || !re.test(line)) continue;
      if (k === 'carbs' && /of which|sugars?/i.test(line) && !/carbohydrate/i.test(line)) continue;
      if (k === 'fat' && /saturat|trans/i.test(line)) continue;
      per100[k] = firstNumber(line.replace(re, ' '), k, guessed);
    }
  }
  const per100Header = /per\s*100\s*(g|ml)/i.exec(text);
  const serv = /(?:serving(?:\s*size)?|per\s+[a-z]+)\s*[:(]?\s*(\d{1,4})\s*(g|ml)/i.exec(text);
  const uncertain = ['carbs', 'sugar', 'fiber', 'fat', 'protein', 'kcal'].filter((k) => per100[k] === null || guessed.has(k));
  if (!per100Header) uncertain.push('carbs');
  return cleanLabel({
    is_label: true, name: '', brand: '', barcode: '', category: '',
    unit: per100Header?.[1].toLowerCase() === 'ml' ? 'ml' : 'g',
    serving: serv ? Number(serv[1]) : null, pack: null, per100,
    label_style: per100.fiber !== null && /fib(re|er)/i.test(text) && !/total\s+carbohydrate/i.test(text) ? 'eu_fibre_excluded' : /total\s+carbohydrate/i.test(text) ? 'fibre_included' : 'unknown',
    uncertain,
  });
}

/**
 * Black text on white, table lines removed (they confuse the text reader): long straight dark runs are rulings, not text. Works on RGBA pixels in place. Pure, so it is tested.
 */
export function cleanForOcr(px: Uint8ClampedArray, w: number, h: number): void {
  const dark = new Uint8Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
  const cut = Math.min(160, (sum / (w * h)) * 0.75);
  for (let i = 0; i < w * h; i++) dark[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11 < cut ? 1 : 0;
  // a straight dark run far longer than any letter is a ruling: whiten that run only
  const minH = Math.max(80, w * 0.15), minV = Math.max(60, h * 0.05);
  const kill: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0, run = 0; x <= w; x++) {
    if (x < w && dark[y * w + x]) { run++; continue; }
    if (run >= minH) for (let k = x - run; k < x; k++) kill.push(y * w + k);
    run = 0;
  }
  for (let x = 0; x < w; x++) for (let y = 0, run = 0; y <= h; y++) {
    if (y < h && dark[y * w + x]) { run++; continue; }
    if (run >= minV) for (let k = y - run; k < y; k++) kill.push(k * w + x);
    run = 0;
  }
  for (const i of kill) dark[i] = 0;
  for (let i = 0; i < w * h; i++) { const v = dark[i] ? 0 : 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
}

/** The table photo scaled so text is big enough, cleaned. */
async function prepare(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(2, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  cleanForOcr(img.data, c.width, c.height);
  g.putImageData(img, 0, 0);
  return c;
}

/** Front photo → barcode → Open Food Facts; table photo → on-device text recognition. Table values win. */
export async function readLabelLocal(front: Blob | undefined, table: Blob | undefined, lang: 'ar' | 'en'): Promise<Label> {
  const { findBarcode, lookupBarcode } = await import('./food');
  let off: Awaited<ReturnType<typeof lookupBarcode>> = null, code: string | null = null;
  for (const b of [front, table]) if (b && !code) code = await findBarcode(b);
  if (code) off = await lookupBarcode(code, lang).catch(() => null);
  let read: Label | null = null;
  if (table) {
    const { createWorker } = (await import('tesseract.js')).default;
    const base = `${import.meta.env.BASE_URL}ocr`; // served with the app: no outside service, works offline once cached
    const worker = await createWorker('eng', 1, { workerPath: `${base}/worker.min.js`, corePath: base, langPath: base });
    const { data } = await worker.recognize(await prepare(table)).finally(() => worker.terminate());
    read = parseLabelText(data.text);
  }
  const p = read?.per100;
  const o = off?.per100;
  const pick = (k: 'carbs' | 'fat' | 'protein' | 'fiber' | 'kcal') => p?.[k] ?? (o as Record<string, number | null> | undefined)?.[k] ?? null;
  const merged = cleanLabel({
    is_label: true, name: off?.name ?? '', brand: off?.brand ?? '', barcode: code ?? '', category: '',
    unit: read?.unit ?? 'g', serving: read?.serving ?? off?.serving ?? null, pack: null,
    per100: { carbs: pick('carbs'), sugar: p?.sugar ?? null, fiber: pick('fiber'), fat: pick('fat'), protein: pick('protein'), kcal: pick('kcal') },
    label_style: read?.label_style ?? 'unknown',
    uncertain: [...(read?.uncertain ?? []), ...(off ? [] : ['name'])],
  });
  return merged;
}
