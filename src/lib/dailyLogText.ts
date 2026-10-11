// How a Daily Log record reads, in plain English: shared by the screen and the PDF so they say the same thing.
import { fmt1 } from '../engine/report/agpReport';
import { DAY, KW, MIN } from '../engine/report/cgm';
import type { LogEntry } from '../engine/report/dailyLog';

export type Tone = 'food' | 'treat' | 'rapid' | 'long' | 'finger' | 'low' | 'sensor';
export const TONE: Record<Tone, string> = { food: '#c26a12', treat: '#c0392b', rapid: '#1f6fa8', long: '#6b4fa0', finger: '#15212b', low: '#e04848', sensor: '#5a6976' };

/** "7:05 am", Kuwait time. */
export const kwClock = (t: number) => { const m = Math.floor((((t + KW) % DAY) + DAY) % DAY / MIN), h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const grams = (g: number) => { const r = Math.round(g * 10) / 10; return `${Number.isInteger(r) ? r : r.toFixed(1)} g`; };
const PURPOSE: Record<string, string> = { meal: 'for food', correction: 'correction', both: 'food and correction' };
const SLOT: Record<string, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack' };

export function entryText(e: LogEntry): { what: string; amount: string; detail: string | null; tone: Tone } {
  switch (e.kind) {
    case 'meal': return { what: `Meal${e.slot && SLOT[e.slot] ? ` · ${SLOT[e.slot]}` : ''}`, amount: e.carbs === null ? 'carbs not known' : `${grams(e.carbs)} carbs`, detail: e.name, tone: 'food' };
    case 'treatment': return { what: 'Low treatment', amount: e.carbs === null ? 'amount not recorded' : `${grams(e.carbs)} carbs`, detail: e.name, tone: 'treat' };
    case 'insulin': return { what: e.type === 'long' ? 'Long-acting insulin given' : 'Rapid insulin given', amount: `${e.units} U`, detail: e.purpose ? PURPOSE[e.purpose] ?? null : null, tone: e.type === 'long' ? 'long' : 'rapid' };
    case 'finger': return { what: 'Finger-prick', amount: `${fmt1(e.mmol)} mmol/L`, detail: 'kept out of the sensor numbers', tone: 'finger' };
    case 'low': return { what: e.veryLow ? 'Low event, below 3.0' : 'Low event, below 3.9', amount: `${e.minutes} min · lowest ${fmt1(e.lowest)}`, detail: `until ${kwClock(e.end)}${e.ongoing ? ', still low at the end of the data' : ''}`, tone: 'low' };
    case 'sensor': return { what: 'New sensor started', amount: '', detail: e.sn ? `serial ${e.sn}` : null, tone: 'sensor' };
  }
}

/** True when the PDF's built-in font can print it (Latin letters); Arabic names are shown in the app only. */
export const printable = (s: string | null): s is string => !!s && /^[\x20-\x7E -ɏ‐-‧]+$/.test(s);
