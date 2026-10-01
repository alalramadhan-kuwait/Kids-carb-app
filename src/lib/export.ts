// CSV export of readings and everything logged, for the clinic or a spreadsheet. Kuwait local time, both units.
import type { EventRow, HistoryEntry } from './types';
import { t, tr } from '../i18n';

const KW = 3 * 3600000;
const local = (t: number) => new Date(t + KW).toISOString().slice(0, 16).replace('T', ' ');
const cell = (x: unknown) => { const s = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const KIND: Record<string, string> = tr({ insulin: 'إنسولين', carbs: 'كارب', treatment: 'علاج انخفاض', note: 'ملاحظة', exercise: 'رياضة', sleep: 'نوم' }); // i18n-ok

export function buildCsv(
  readings: { t: number; v: number }[], events: EventRow[], history: HistoryEntry[], nameOf: (id: string) => string,
): string {
  type Row = [number, string, number | null, number | string | null, unknown, unknown, unknown, unknown, unknown];
  const rows: Row[] = [];
  for (const r of readings) rows.push([r.t, t('قراءة'), r.v, (Math.round((r.v / 18.016) * 10) / 10).toFixed(1), null, null, null, null, null]);
  for (const h of history) rows.push([Date.parse(h.eaten_at), h.kind === 'snack' ? t('سناك') : t('وجبة'), null, null, h.total_carbs, null, null, h.name, (h as any).created_by ? nameOf((h as any).created_by) : null]);
  for (const e of events) {
    if (e.deleted_at) continue;
    rows.push([Date.parse(e.occurred_at), KIND[e.kind] ?? e.kind, null, null, e.carbs_g, e.insulin_units,
      e.insulin_type === 'long' ? t('طويل') : e.insulin_type === 'rapid' ? t('سريع') : null,
      [e.kind === 'exercise' ? t('{m} د', { m: e.activity_min }) : null, e.kind === 'sleep' && e.ends_at ? t('حتى {t}', { t: local(Date.parse(e.ends_at)) }) : null, e.treatment, e.note].filter(Boolean).join(' · ') || null,
      nameOf(e.created_by)]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const head = [t('الوقت (الكويت)'), t('النوع'), t('السكر mg/dL'), t('السكر mmol/L'), t('الكارب غ'), t('الإنسولين وحدة'), t('نوع الإنسولين'), t('ملاحظة'), t('سجّلها')];
  return '﻿' + [head, ...rows.map(([t, ...rest]) => [local(t), ...rest])].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
