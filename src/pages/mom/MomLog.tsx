// Mom mode's log: newest first, today and yesterday, then a week more at each tap; one search box finds a food on any
// day. Every entry either parent logs is here (shots in pen colours, juice, food, finger pricks, carbs, notes,
// activity), with who logged it. A meal whose "how much did she eat?" is not answered yet says so. A shot, juice, prick
// or meal opens to change or delete it.
import { mealTitle } from '../../lib/unknownMeal';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { dayStartOf, dayTitle } from '../../engine/day';
import { matches, mealHay } from '../../lib/search';
import { fmt } from '../../lib/carbs';
import { formatGlucose } from '../../lib/glucose';
import { inputCls } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, MomPage, PenBar, PEN_NAME, SITE_NAME, clock } from './MomUI';

type Row = { key: string; at: number; to: string | null; icon: React.ReactNode; label: React.ReactNode; sub: string; who: string; hay: (string | null | undefined)[]; detail?: string; pending?: boolean };
const DAY = 86400000;

export function MomLog() {
  const nav = useNavigate();
  const { events, history, pendingMeals, settings, nameOf } = useData();
  const [days, setDays] = useState(2);
  // the search is kept in the address, so coming back from a meal (or its graph) shows the same results
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const setQ = (v: string) => setSp(v ? { q: v } : {}, { replace: true });
  const all: Row[] = useMemo(() => {
    const g = (n: number) => `${fmt(n)} ${t('غ كارب')}`;
    return [
      ...events.filter((e) => !e.deleted_at && ((e.kind === 'insulin' && e.insulin_units) || e.kind === 'treatment' || (e.kind === 'bg_check' && e.bg_mgdl) || e.kind === 'carbs' || e.kind === 'note' || e.kind === 'exercise')).map((e): Row => {
        const base = { key: e.id, at: Date.parse(e.occurred_at), who: e.source ? '' : nameOf(e.created_by) };
        const type = e.insulin_type === 'long' ? 'long' as const : 'rapid' as const;
        if (e.kind === 'bg_check') return { ...base, to: `/mom/entry/${e.id}`, icon: '🩸', label: <b className="num">{formatGlucose(e.bg_mgdl!, settings.glucose_unit)}</b>, sub: t('فحص بالإصبع'), hay: [] };
        if (e.kind === 'insulin') return { ...base, to: `/mom/entry/${e.id}`, icon: <PenBar type={type} />, label: <>{t(PEN_NAME[type])} <b className="num">{fmt(e.insulin_units!)}</b> {t('وحدة')}</>, sub: e.injection_site ? t(SITE_NAME[e.injection_site]) : '', hay: [PEN_NAME[type], t(PEN_NAME[type]), e.note] };
        if (e.kind === 'treatment') return { ...base, to: `/mom/entry/${e.id}`, icon: '🧃', label: <bdi>{tMaybe(e.treatment ?? '')}</bdi>, sub: g(e.carbs_g ?? 0), hay: [e.treatment, tMaybe(e.treatment ?? ''), e.note] };
        if (e.kind === 'carbs') return { ...base, to: null, icon: '🍚', label: t('كارب فقط'), sub: g(e.carbs_g ?? 0), hay: [e.note] };
        if (e.kind === 'exercise') return { ...base, to: null, icon: '🏃', label: t('رياضة {m} د', { m: e.activity_min ?? 0 }), sub: '', hay: [e.note] };
        return { ...base, to: null, icon: '📝', label: <bdi>{e.note}</bdi>, sub: '', hay: [e.note] };
      }),
      ...[...history, ...pendingMeals].map((h): Row => ({
        key: h.id, at: Date.parse(h.eaten_at), to: `/mom/meal-entry/${h.id}`, icon: '🍽️', label: <bdi>{mealTitle(h)}</bdi>,
        sub: h.intake === 'pending' ? `⏳ ${t('كم أكلت؟')}` : h.total_carbs === null ? `❓ ${t('الكارب غير معروف')}` : g(h.total_carbs), who: h.source ? '' : nameOf(h.created_by), pending: h.intake === 'pending',
        hay: mealHay(h, mealTitle(h), ...h.lines.map((l) => tMaybe(l.name))),
        detail: h.lines.length > 1 ? h.lines.map((l) => tMaybe(l.name)).join('، ') : undefined, // i18n-ok: list separator
      })),
    ].sort((a, b) => b.at - a.at);
  }, [events, history, pendingMeals, settings.glucose_unit, nameOf]);

  const from = new Date(); from.setHours(0, 0, 0, 0);
  const since = from.getTime() - (days - 1) * DAY;
  // search: every entry on any day, in either language and spelling (lib/search), newest first
  const s = q.trim();
  const rows = s ? all.filter((r) => r.hay.length > 0 && matches(r.hay, s)) : all.filter((r) => r.at >= since);
  const more = !s && all.some((r) => r.at < since);
  const dayList = [...new Set(rows.map((r) => dayStartOf(r.at)))];
  return (
    <MomPage title={t('السجل')} back={null} tabs>
      <input type="search" className={inputCls + ' !min-h-[52px] !text-[17px]'} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`🔍 ${t('دوّري أكلة…')}`} aria-label={t('دوّري أكلة…')} />
      {!rows.length && <p className="text-center text-[18px] text-slate-500">{s ? t('ما لقيت شي') : t('ما في شي بعد')}</p>}
      {s && rows.length > 0 && <p className="text-center text-[14px] text-slate-500">{t('{n} نتيجة', { n: rows.length })}</p>}
      {dayList.map((d) => (
        <section key={d}>
          <h2 className="mb-1.5 text-[17px] font-bold text-slate-500">{dayTitle(d)}</h2>
          <ul className="divide-y divide-slate-100 rounded-3xl bg-white px-4">
            {rows.filter((r) => dayStartOf(r.at) === d).map((r) => (
              <li key={r.key}><button disabled={!r.to} onClick={() => r.to && nav(r.to)} className="flex min-h-[64px] w-full items-center gap-3 py-2 text-start">
                <span className="grid w-8 shrink-0 place-items-center text-2xl">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[18px] leading-snug">{r.label}</span>
                  {s && r.detail && <span className="block truncate text-[14px] text-slate-500"><bdi>{r.detail}</bdi></span>}
                  <span className={r.pending ? 'text-[15px] font-bold text-near' : 'text-[15px] text-slate-500'}>{[r.sub, r.who].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-[16px] text-slate-500">{clock(r.at)}{r.to ? ' ›' : ''}</span>
              </button></li>
            ))}
          </ul>
        </section>
      ))}
      {more && <Big tone="soft" onClick={() => setDays(days + 7)}>{t('أيام أقدم')}</Big>}
    </MomPage>
  );
}
