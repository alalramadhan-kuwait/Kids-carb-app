// Shared activity pushes, pure so the app's tests can run them: what one parent logged, told to the other parent.
// Only manual entries that show on her graph; never CGM readings. Each person switches kinds off for themselves.
export type Lang = 'ar' | 'en';
const LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069); // keeps numbers together inside Arabic text
const num = (mg: number, unit: 'mgdl' | 'mmol') => (unit === 'mmol' ? (Math.round((mg / 18.016) * 10) / 10).toFixed(1) : String(Math.round(mg)));
const join = (...lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join('\n');

export type ActivityKind = 'meal' | 'rapid' | 'long' | 'treatment' | 'finger';
export interface ActivityRow { kind: ActivityKind; by_user: string; occurred_at: string; carbs: number | null; units: number | null; mgdl: number | null; name: string | null }
export interface ActivityMember { user_id: string; display_name: string | null; activity_push?: Partial<Record<ActivityKind, boolean>> | null }

/** Everyone but the person who logged it, minus those who switched this kind off. */
export function activityRecipients(members: ActivityMember[], by: string, kind: ActivityKind): string[] {
  return members.filter((m) => m.user_id !== by && m.activity_push?.[kind] !== false).map((m) => m.user_id);
}

const kw12 = (ms: number, en: boolean) => {
  const k = new Date(ms + 3 * 3600000), h = k.getUTCHours();
  return `${LRI}${h % 12 || 12}:${String(k.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? (en ? 'AM' : 'ص') : (en ? 'PM' : 'م')}${PDI}`;
};
const ACT_ICON: Record<ActivityKind, string> = { meal: '🍽️', rapid: '💉', long: '💉', treatment: '🧃', finger: '🩸' };

/** "Rawan added NovoRapid 4 U" / "8:05 PM". Facts only, like every other push. A meal with no carbs (null) was eaten out
 *  with its carbs not known: it says so, never "0 g". */
export function activityMessage(a: ActivityRow, who: string | null, lang: Lang = 'ar', unit: 'mgdl' | 'mmol' = 'mmol') {
  const en = lang === 'en', n = (v: number | null) => `${LRI}${Math.round((v ?? 0) * 10) / 10}${PDI}`;
  const g = a.mgdl != null ? `${LRI}${num(a.mgdl, unit)} ${unit === 'mmol' ? 'mmol/L' : 'mg/dL'}${PDI}` : '';
  const what = en
    ? { meal: a.carbs === null ? 'meal · carbs unknown' : `meal · ${n(a.carbs)} g carbs`, rapid: `NovoRapid ${n(a.units)} U`, long: `Tresiba ${n(a.units)} U`, treatment: `low treatment · ${n(a.carbs)} g carbs`, finger: `finger-prick ${g}` }[a.kind]
    : { meal: a.carbs === null ? 'وجبة · الكارب غير معروف' : `وجبة · ${n(a.carbs)} غ كارب`, rapid: `نوفورابيد ${n(a.units)} وحدة`, long: `تريسيبا ${n(a.units)} وحدة`, treatment: `علاج انخفاض · ${n(a.carbs)} غ كارب`, finger: `قياس وخز ${g}` }[a.kind];
  const pen = a.kind === 'rapid' || a.kind === 'long';
  const title = en
    ? (who ? `${who} added ${pen ? '' : 'a '}${what}` : ((h: string, ...r: string[]) => [`${h[0].toUpperCase()}${h.slice(1)} added`, ...r].join(' · '))(...(what.split(' · ') as [string])))
    : (who ? `${what} · من ${who}` : `أُضيف: ${what}`);
  const at = kw12(Date.parse(a.occurred_at), en);
  const showName = a.name && (a.kind === 'meal' || a.kind === 'treatment');
  return { title: `${ACT_ICON[a.kind]} ${title}`, body: join(showName ? a.name : null, en ? `At ${at}` : `الساعة ${at}`) };
}
