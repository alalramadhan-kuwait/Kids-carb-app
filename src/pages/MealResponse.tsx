import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { relDay } from '../lib/constants';
import { Badge, Card, cx, inputCls } from '../components/ui';
import { GRID, MIN_CLEAN, buildOccurrence, medianCurve, summary, windowSeries, type Occurrence } from '../engine/meals';
import { isEn, t } from '../i18n';

/** الوجبات: how glucose usually responds to one recipe — every time it was eaten, aligned at the first bite. */
export function MealResponse() {
  const { settings, history, events } = useData();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const recipeId = params.get('recipe');
  const unit = settings.glucose_unit;

  const recipes = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const h of history) if (h.kind === 'meal' && h.recipe_id) {
      const r = m.get(h.recipe_id) ?? { id: h.recipe_id, name: h.name, n: 0 }; r.n++; m.set(h.recipe_id, r);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [history]);
  const meals = useMemo(() => history.filter((h) => h.kind === 'meal' && h.recipe_id === recipeId).slice(0, 200), [history, recipeId]);
  const [occ, setOcc] = useState<Occurrence[] | null>(null);

  useEffect(() => {
    if (!recipeId || !meals.length) { setOcc(null); return; }
    setOcc(null);
    supabase.rpc('glucose_windows', { p_times: meals.map((m) => m.eaten_at), p_before: 60, p_after: 240 }).then(({ data }) => {
      const byT = new Map((data as { t0: string; o: number[]; v: number[] }[] ?? []).map((w) => [Date.parse(w.t0), w]));
      setOcc(meals.map((m) => { const t0 = Date.parse(m.eaten_at), w = byT.get(t0); return buildOccurrence(m, windowSeries(t0, (w?.o ?? []).map(Number), w?.v ?? []), history, events); }));
    });
  }, [recipeId, meals, history, events]);

  const pick = (id: string | null) => setParams(id ? { mode: 'meals', recipe: id } : { mode: 'meals' }, { replace: true });
  if (!recipeId) {
    const list = recipes.filter((r) => !q.trim() || r.name.includes(q.trim()));
    return (
      <div className="space-y-3 pb-4">
        <input className={inputCls} placeholder={t('ابحث عن وصفة')} value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length === 0 ? <Card><p className="text-sm text-slate-500">{t('لم تُسجَّل وجبات من الوصفات بعد. بعد تسجيل الوجبة نفسها 3 مرات تظهر استجابتها هنا.')}</p></Card> : (
          <Card className="!p-0 overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {list.map((r) => (
                <li key={r.id}><button onClick={() => pick(r.id)} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-start active:bg-slate-50">
                  <span className="flex-1 font-medium">{r.name}</span><span className="text-sm text-slate-500">{t('{n} مرة', { n: r.n })}</span><span className="text-slate-400">{isEn() ? '›' : '‹'}</span>
                </button></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  const clean = occ?.filter((o) => o.reasons.length === 0 && o.response.g0 !== null) ?? [];
  const sum = summary(clean);
  const g = (mg: number | null) => (mg === null ? '—' : formatGlucose(mg, unit));
  const name = meals[0]?.name ?? recipes.find((r) => r.id === recipeId)?.name ?? '';
  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center gap-2">
        <button aria-label={t('رجوع')} onClick={() => pick(null)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm">{isEn() ? '←' : '→'}</button>
        <div className="flex-1"><div className="font-bold">{name}</div><div className="text-sm text-slate-500">{t('أُكلت')} <span className="num">{meals.length}</span> {t('مرة · نظيفة')} <span className="num">{clean.length}</span></div></div>
      </div>
      <Card className="!px-2">
        <div className="mb-1 flex items-center justify-between px-2"><h2 className="font-bold">{t('من أول لقمة')}</h2><Badge>{t('من بياناتها')}</Badge></div>
        {!occ ? <p className="px-2 text-slate-500">…</p> : <ResponseChart occ={occ} unit={unit} range={effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl)} />}
        {occ && clean.length < MIN_CLEAN && <p className="mt-1 px-2 text-xs text-slate-500">{t('الوسيط يظهر بعد {n} وجبات نظيفة.', { n: MIN_CLEAN })}</p>}
      </Card>
      {clean.length >= MIN_CLEAN && (
        <Card className="grid grid-cols-3 gap-2 !py-3 text-center">
          <S label={t('الكارب')} value={sum.carbs !== null ? t('{v} غ', { v: fmt(sum.carbs) }) : '—'} />
          <S label={t('الإنسولين')} value={sum.insulin !== null ? t('{v} و', { v: fmt(sum.insulin) }) : '—'} />
          <S label={t('عند الأكل')} value={g(sum.g0)} />
          <S label={t('أعلى قراءة')} value={g(sum.peak)} />
          <S label={t('الارتفاع')} value={sum.rise !== null ? `+${formatGlucose(sum.rise, unit)}` : '—'} />
          <S label={t('الذروة بعد')} value={sum.ttp !== null ? t('{n} د', { n: Math.round(sum.ttp) }) : '—'} />
          <S label={t('بعد 3 ساعات')} value={g(sum.at180)} />
          <p className="col-span-3 text-[11px] text-slate-400">{t('الوسيط من {n} وجبات نظيفة', { n: clean.length })} · {unitLabel(unit)} · {t('ملاحظات تاريخية وليست توصية.')}</p>
        </Card>
      )}
      {occ && (
        <Card className="!p-0 overflow-hidden">
          <ul className="divide-y divide-slate-100 text-sm">
            {occ.map((o) => (
              <li key={o.meal.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-20 shrink-0 text-slate-500">{relDay(new Date(o.t0))}</span>
                <span className="num shrink-0">{t('{v} غ', { v: fmt(o.meal.total_carbs) })}</span>
                <span className="flex-1 text-slate-600">{o.response.rise !== null ? <>{t('ارتفاع')} <b className="num">+{formatGlucose(o.response.rise, unit)}</b></> : '—'}</span>
                {o.reasons.length ? <span className="text-xs text-slate-500">{o.reasons[0]}</span> : <span className="text-xs font-medium text-brand">{t('نظيفة')}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const S = ({ label, value }: { label: string; value: string }) => (
  <div><div className="num text-lg font-bold text-brand-num" dir="auto">{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>
);

function ResponseChart({ occ, unit, range }: { occ: Occurrence[]; unit: 'mmol' | 'mgdl'; range: { low: number | null; high: number | null; reference: boolean } }) {
  const W = 340, PL = 4, PR = 28, PT = 8, PH = 180, H = PT + PH + 22;
  const all = occ.flatMap((o) => o.curve.filter((v): v is number => v !== null));
  const top = all.some((v) => v > 280) ? 400 : 300, bottom = 40;
  const x = (k: number) => PL + (k / (GRID.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  const path = (c: (number | null)[]) => c.reduce((d, v, k) => (v === null ? d + ' ' : d + (d.endsWith(' ') || d === '' ? 'M' : 'L') + `${x(k).toFixed(1)},${y(v).toFixed(1)}`), '').replace(/ +/g, ' ');
  const clean = occ.filter((o) => o.reasons.length === 0);
  const mc = medianCurve(clean.map((o) => o.curve));
  const band = mc.map((m, k) => (m ? { k, ...m } : null)).filter(Boolean) as { k: number; p25: number; p50: number; p75: number }[];
  const ticks = unit === 'mmol' ? [4, 10, 16].map((m) => m * 18.016) : [70, 180, 300];
  const x0 = x(GRID.indexOf(0));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('استجابة السكر بعد الوجبة')} direction="ltr">
      <rect x={PL} y={PT} width={W - PL - PR} height={PH} rx="8" fill="rgb(var(--surface-2))" />
      {range.low !== null && range.high !== null && <rect x={PL} y={y(range.high)} width={W - PL - PR} height={y(range.low) - y(range.high)} fill="rgb(var(--st-in))" opacity={range.reference ? 0.08 : 0.13} />}
      {ticks.filter((v) => v < top).map((v) => <text key={v} x={W - 2} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{formatGlucose(v, unit).replace(/\.0$/, '')}</text>)}
      {[-60, 0, 60, 120, 180, 240].map((m) => <text key={m} x={x(GRID.indexOf(m))} y={H - 6} textAnchor={m === -60 ? 'start' : m === 240 ? 'end' : 'middle'} fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{m > 0 ? `+${m}` : m}</text>)}
      <line x1={x0} x2={x0} y1={PT} y2={PT + PH} stroke="rgb(var(--text-2))" strokeDasharray="3 3" />
      <text x={x0 + 3} y={PT + 12} fontSize="10" fill="rgb(var(--text-2))" fontFamily="Rubik, system-ui" direction={isEn() ? 'ltr' : 'rtl'} textAnchor={isEn() ? 'start' : 'end'}>{t('الأكل')}</text>
      {occ.map((o) => <path key={o.meal.id} d={path(o.curve)} fill="none" stroke={o.reasons.length ? 'rgb(var(--text-3))' : 'rgb(var(--primary))'} strokeOpacity={o.reasons.length ? 0.35 : 0.45} strokeWidth="1.3" strokeDasharray={o.reasons.length ? '3 3' : undefined} />)}
      {band.length > 1 && <path d={`M${band.map((b) => `${x(b.k)},${y(b.p75)}`).join('L')}L${[...band].reverse().map((b) => `${x(b.k)},${y(b.p25)}`).join('L')}Z`} fill="rgb(var(--primary))" opacity="0.25" />}
      {band.length > 1 && <path d={`M${band.map((b) => `${x(b.k)},${y(b.p50)}`).join('L')}`} fill="none" stroke="rgb(var(--primary-strong))" strokeWidth="2.6" strokeLinejoin="round" />}
    </svg>
  );
}
