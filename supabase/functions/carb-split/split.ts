// The later part of a split meal dose: which ones are due now, and the push that says so. Pure, so the app's tests
// run it. Units and time are the parent's own choice (stored with the meal); the app never suggests either.

export interface SplitRow { id: string; status: string; name: string; slot: string; split_units: number | null; split_at: string | null; split_done_at: string | null; notified: Record<string, string> | null }
const MIN = 60000;
/** A reminder more than this late is not sent: the moment has passed (the card on the home screen still shows it). */
export const LATE_MIN = 30;

/** Due once per time chosen (moving the time reminds again); never after it is recorded or dismissed. */
export function splitsDue(rows: SplitRow[], now: number): SplitRow[] {
  return rows.filter((p) => {
    if (!p.split_at || !p.split_units || p.split_done_at || (p.status !== 'dosed' && p.status !== 'eaten')) return false;
    const at = Date.parse(p.split_at);
    return now >= at && now - at <= LATE_MIN * MIN && (p.notified ?? {}).split !== new Date(at).toISOString();
  });
}

const SLOT_AR: Record<string, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', snack: 'السناك' };
const SLOT_EN: Record<string, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack' };
export function splitMessage(p: SplitRow, lang: 'ar' | 'en') {
  const u = Number(p.split_units);
  return lang === 'en'
    ? { title: `💉 Second part of the ${SLOT_EN[p.slot] ?? 'meal'} dose: ${u} U`, body: `${p.name} · the time you chose · record it after giving it` }
    : { title: `💉 الجزء الثاني من إبرة ${SLOT_AR[p.slot] ?? 'الوجبة'}: ${u} وحدة`, body: `${p.name} · الوقت اللي اخترتوه · سجّلوها بعد ما تعطونها` };
}
