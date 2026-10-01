import type { EventRow } from './types';

type Describable = Pick<EventRow, 'kind' | 'insulin_units' | 'insulin_type' | 'carbs_g' | 'treatment' | 'note'>;

/** Arabic number agreement: 1 وحدة, 2 وحدتان, 3–10 وحدات, 11+ and fractions وحدة. */
export const unitsWord = (n: number) => (n === 2 ? 'وحدتان' : Number.isInteger(n) && n >= 3 && n <= 10 ? 'وحدات' : 'وحدة');

export const describeEvent = (e: Describable) => {
  if (e.kind === 'insulin') return `${e.insulin_units} ${unitsWord(e.insulin_units ?? 0)} · ${e.insulin_type === 'long' ? 'طويل المفعول' : 'سريع'}`;
  if (e.kind === 'carbs') return `${e.carbs_g}غ كارب`;
  if (e.kind === 'treatment') return `علاج انخفاض ${e.carbs_g}غ${e.treatment ? ` · ${e.treatment}` : ''}`;
  return e.note ?? '';
};
