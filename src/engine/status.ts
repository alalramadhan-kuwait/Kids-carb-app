// The Status page (Gluroo-style "On board"). Pure, tested in Node. Display only: it adds up what was already
// logged with the doctor's numbers. Nothing here, or anywhere in the app, turns it into an amount to give.
import { absorbOf, carbsFrom, cobAt, dosesFrom, iobAt, iobParamsOk, type IobParams } from './iob';
import type { EventRow, HistoryEntry } from '../lib/types';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** One time block of the doctor's plan: from HH:MM (Kuwait time) until the next block. */
export interface Ratio { from: string; cr: number; isf: number } // cr: g per unit, isf: mg/dL per unit

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
export const ratioOk = (r: Ratio) => /^\d{2}:\d{2}$/.test(r.from) && toMin(r.from) < 1440 && r.cr >= 3 && r.cr <= 100 && r.isf >= 10 && r.isf <= 500;

/** The block in effect at a Kuwait minute of the day (blocks wrap: before the first one, the last one applies). */
export function ratioAt(ratios: Ratio[], kuwaitMin: number): Ratio | null {
  const ok = ratios.filter(ratioOk).sort((a, b) => toMin(a.from) - toMin(b.from));
  if (!ok.length) return null;
  let cur = ok[ok.length - 1];
  for (const r of ok) if (toMin(r.from) <= kuwaitMin) cur = r;
  return cur;
}

export interface OnBoard {
  iob: number | null;      // units of rapid insulin still working (null: no model)
  cob: number | null;      // grams still being absorbed (null: no absorption time)
  /** current + COB ÷ CR × ISF − IOB × ISF, once both are used up; null when anything it needs is missing or old */
  est: number | null;
  estBy: number | null;    // when everything logged so far is used up
  ratio: Ratio | null;
}

export interface OnBoardInput {
  now: number; kuwaitMin: number;
  glucose: { mg: number; at: number } | null;
  history: HistoryEntry[]; events: EventRow[];
  iob: IobParams | null; absorbMin: number | null; ratios: Ratio[];
}

/** The estimate needs a reading no older than 15 minutes, both models and the doctor's ratios. */
export function onBoard(p: OnBoardInput): OnBoard {
  const iobP = iobParamsOk(p.iob) ? p.iob : null;
  const doses = dosesFrom(p.events), carbs = carbsFrom(p.history, p.events);
  const iob = iobP ? iobAt(p.now, doses, iobP) : null;
  const cob = p.absorbMin ? cobAt(p.now, carbs, p.absorbMin) : null;
  const ratio = ratioAt(p.ratios, p.kuwaitMin);
  let estBy: number | null = null;
  if (iobP) for (const d of doses) if (d.t <= p.now && p.now - d.t < iobP.dia * MIN) estBy = Math.max(estBy ?? 0, d.t + iobP.dia * MIN);
  if (p.absorbMin) for (const c of carbs) { const a = absorbOf(c, p.absorbMin); if (c.t <= p.now && p.now - c.t < a * MIN) estBy = Math.max(estBy ?? 0, c.t + a * MIN); }
  const fresh = p.glucose && p.now - p.glucose.at <= 15 * MIN;
  const est = fresh && ratio && iob !== null && cob !== null
    ? p.glucose!.mg + (cob / ratio.cr) * ratio.isf - iob * ratio.isf : null;
  return { iob, cob, est, estBy: est !== null ? estBy ?? p.now : null, ratio };
}

/** Sensor life: Libre 2 lasts 14 days, Libre 2 Plus 15; the first hour is warm-up. */
export function sensorLife(startedAt: string, days: number, now: number) {
  const start = Date.parse(startedAt), end = start + days * DAY;
  const left = end - now;
  return {
    start, end, left,
    fraction: Math.min(1, Math.max(0, (now - start) / (end - start))),
    warmup: now - start < HOUR,
    state: left <= 0 ? 'ended' : left <= 2 * HOUR ? 'hours' : left <= DAY ? 'today' : 'ok',
  } as const;
}
