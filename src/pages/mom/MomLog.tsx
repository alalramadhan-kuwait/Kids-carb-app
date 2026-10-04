// Mom mode's log: the last two days, newest first — shots in pen colours, juice, food. A shot or juice opens its
// page (change or delete); food shows what she ate and its carbs.
import { useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { relDay } from '../../lib/constants';
import { fmt } from '../../lib/carbs';
import { t, tMaybe } from '../../i18n';
import { MomPage, PenBar, PEN_NAME, SITE_NAME, clock } from './MomUI';

type Row = { key: string; at: number; to: string | null; icon: React.ReactNode; label: React.ReactNode; sub: string };

export function MomLog() {
  const nav = useNavigate();
  const { events, history } = useData();
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 1);
  const rows: Row[] = [
    ...events.filter((e) => !e.deleted_at && Date.parse(e.occurred_at) >= from.getTime() && ((e.kind === 'insulin' && e.insulin_units) || e.kind === 'treatment')).map((e): Row => {
      const type = e.insulin_type === 'long' ? 'long' as const : 'rapid' as const;
      return e.kind === 'insulin'
        ? { key: e.id, at: Date.parse(e.occurred_at), to: `/mom/entry/${e.id}`, icon: <PenBar type={type} />, label: <>{t(PEN_NAME[type])} <b className="num">{fmt(e.insulin_units!)}</b> {t('وحدة')}</>, sub: e.injection_site ? t(SITE_NAME[e.injection_site]) : '' }
        : { key: e.id, at: Date.parse(e.occurred_at), to: `/mom/entry/${e.id}`, icon: '🧃', label: <bdi>{tMaybe(e.treatment ?? '')}</bdi>, sub: `${fmt(e.carbs_g ?? 0)} ${t('غرام')}` };
    }),
    ...history.filter((h) => Date.parse(h.eaten_at) >= from.getTime()).map((h): Row => ({ key: h.id, at: Date.parse(h.eaten_at), to: null, icon: '🍽️', label: <bdi>{tMaybe(h.name)}</bdi>, sub: `${fmt(h.total_carbs)} ${t('غرام')}` })),
  ].sort((a, b) => b.at - a.at);
  const days = [...new Set(rows.map((r) => new Date(r.at).toDateString()))];
  return (
    <MomPage title={t('السجل')} back={null} tabs>
      {!rows.length && <p className="text-center text-[18px] text-slate-500">{t('ما في شي بعد')}</p>}
      {days.map((d) => (
        <section key={d}>
          <h2 className="mb-1.5 text-[17px] font-bold text-slate-500">{relDay(new Date(d))}</h2>
          <ul className="divide-y divide-slate-100 rounded-3xl bg-white px-4">
            {rows.filter((r) => new Date(r.at).toDateString() === d).map((r) => (
              <li key={r.key}><button disabled={!r.to} onClick={() => r.to && nav(r.to)} className="flex min-h-[60px] w-full items-center gap-3 py-2 text-start">
                <span className="grid w-8 shrink-0 place-items-center text-2xl">{r.icon}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[18px]">{r.label}</span>{r.sub && <span className="text-[15px] text-slate-500">{r.sub}</span>}</span>
                <span className="text-[16px] text-slate-500">{clock(r.at)}{r.to ? ' ›' : ''}</span>
              </button></li>
            ))}
          </ul>
        </section>
      ))}
    </MomPage>
  );
}
