import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { saveSettings } from '../lib/api';
import { backTo } from '../lib/nav';
import { deleteMeasurement, saveMeasurement, useGrowthNutrition, type GrowthNutrition, type MeasurementRow } from '../lib/growth';
import { RANGE, implausible, percentile, valueAtZ, type Indicator } from '../engine/growth';
import { ACTIVITIES, type Activity } from '../engine/energy';
import { NUTRIENTS, SHOWN_GROUPS, NUTRITION_RULES, UNIT, dataQuality, macroLevel, type Level, type Nutrient, type Period, type Ref, type State, type Targets } from '../engine/nutrition';
import { ACTIVITY, ACTIVITY_HINT, BALANCE_ISSUE, GROUP, GROWTH_REASON, NUTRIENT_NAME, SOURCE } from '../components/growthText';
import { Alert, Btn, Card, Field, NumInput, Page, Sheet, cx, inputCls, toast } from '../components/ui';
import { fmt } from '../lib/carbs';
import { isEn, locale, t, tr } from '../i18n';

const UNIT_AR: Record<string, string> = tr({ g: 'غ', mg: 'ملغ', 'µg': 'ميكروغرام', kcal: 'سعرة' } as Record<string, string>); // i18n-ok: values translated when read
const PERIOD = tr({ d3: '3 أيام', d7: '7 أيام', d30: '30 يومًا' }); // i18n-ok
const PERIOD_LONG = tr({ d3: 'آخر 3 أيام', d7: 'آخر 7 أيام', d30: 'آخر 30 يومًا' }); // i18n-ok
const IND = tr({ bmi: 'مؤشر الكتلة', hfa: 'الطول', wfa: 'الوزن' }); // i18n-ok
const LEVEL_WORD = tr({ ok: 'ضمن المدى', low: 'منخفض', slightly_low: 'أقل قليلًا', slightly_high: 'أعلى قليلًا', high: 'مرتفع', unknown: 'بيانات غير كافية' }); // i18n-ok
const STATE_WORD = tr({ adequate: 'كافٍ', low: 'قليل', high: 'مرتفع', within: 'ضمن الحد', below_ref: 'أقل من المرجع', above_ref: 'أعلى من المرجع', insufficient: 'بيانات غير كافية' }); // i18n-ok
const MARK: Record<Level, string> = { ok: '✓', low: '↓', slightly_low: '↓', slightly_high: '↑', high: '↑', unknown: '–' };
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const ord = (n: number) => (isEn() ? `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}` : String(n));
const levelTone = (l: Level | State) => (l === 'ok' || l === 'adequate' || l === 'within' ? 'text-ok' : l === 'unknown' || l === 'insufficient' ? 'text-slate-400' : 'text-near');
const Num = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr" className="tabular-nums">{children}</bdi>;

/**
 * النمو والتغذية, answer first: is energy within the estimated range, are carbs / protein / fat okay, is growth within
 * the expected range, is anything worth a look. References, methods and the rest are one tap deeper.
 */
export default function Growth() {
  const nav = useNavigate();
  const g = useGrowthNutrition();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<Partial<MeasurementRow> | null>(null);
  const [period, setPeriod] = useState<Exclude<Period, 'today'>>('d3');
  useEffect(() => { if (params.get('add')) { setEdit({}); setParams({}, { replace: true }); } }, [params, setParams]);

  return (
    <Page title={t('النمو والتغذية')} back={() => backTo(nav, '/')}>
      {!g.ready ? <p className="text-sm text-slate-500">{t('جارٍ التحميل…')}</p> : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm" role="tablist" aria-label={t('الفترة')}>
            {(['d3', 'd7', 'd30'] as const).map((p) => (
              <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cx('min-h-[40px] rounded-full', period === p ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{PERIOD[p]}</button>
            ))}
          </div>
          <Summary g={g} period={period} />
          <DailyAverage g={g} period={period} />
          <GrowthSection g={g} onAdd={() => setEdit({})} onEdit={(m) => setEdit(m)} />
          <MealPatterns g={g} period={period} />
          <HowTargets g={g} />
          <ProfileSection g={g} />
        </div>
      )}
      <MeasureSheet edit={edit} list={g.measurements} onClose={() => setEdit(null)} />
    </Page>
  );
}

/* --------------------------------------------------------------- summary */

function Summary({ g, period }: { g: GrowthNutrition; period: 'd3' | 'd7' | 'd30' }) {
  const a = g.avg[period], st = g.energy[period], r = g.energyRef, b = g.bal[period];
  const overall = st === 'within' ? t('ضمن المدى ✓') : st === 'below' ? t('أقل من المدى') : st === 'above' ? t('أعلى من المدى') : t('بيانات غير كافية بعد');
  const macros = (['carbs', 'protein', 'fat'] as const).map((n) => ({ n, l: macroLevel(n, a, g.refs, g.coverageMin) }));
  const attention = [...g.growth.reasons.map((x) => GROWTH_REASON[x]), ...b.issues.map((i) => BALANCE_ISSUE[i])];
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">{t('التغذية')} <span className="font-normal text-slate-500">· {PERIOD_LONG[period]}</span></h2>
        {a.enough && <span className="text-xs text-slate-500">{t('جودة البيانات')} <Num>{Math.round(dataQuality(a) * 100)}%</Num></span>}
      </div>
      <p className={cx('text-lg font-bold', st === 'within' ? 'text-ok' : st === 'below' ? 'text-near' : 'text-slate-700')}>{overall}</p>
      {a.enough && a.totalKcal !== null ? (
        <>
          <p><b className="text-3xl"><Num>{n0(a.totalKcal)}</Num></b> <span className="text-slate-600">{t('سعرة/يوم')}</span></p>
          {r && <RangeBar value={a.totalKcal} lo={r.low} hi={r.high} />}
          {a.treatment.kcal >= 1 && <p className="text-xs text-slate-500">{t('منها علاج الانخفاض +{k} سعرة', { k: n0(a.treatment.kcal) })}</p>}
        </>
      ) : <p className="text-sm text-slate-500">{t('سجّلوا وجبات يومين كاملين على الأقل.')}</p>}
      <div className="flex gap-4 text-sm">
        {macros.map(({ n, l }) => <span key={n} className="font-medium">{NUTRIENT_NAME[n]} <b className={levelTone(l)}>{MARK[l]}</b></span>)}
      </div>
      {attention.length > 0 && (
        <ul className="space-y-0.5 rounded-xl bg-near-soft px-3 py-2 text-sm text-near">{attention.map((x) => <li key={x}>• {x}</li>)}</ul>
      )}
    </Card>
  );
}

/** Where intake sits against the estimated range: the band is the range, the dot is her average. */
function RangeBar({ value, lo, hi }: { value: number; lo: number; hi: number }) {
  const span = hi - lo, min = lo - span * 0.6, max = hi + span * 0.6;
  const x = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100}%`;
  const inside = value >= lo && value <= hi;
  return (
    <div dir="ltr" aria-label={t('{v} سعرة، المدى التقديري {lo}–{hi}', { v: n0(value), lo: n0(lo), hi: n0(hi) })} role="img">
      <div className="relative h-3 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 rounded-full bg-ok-soft ring-1 ring-ok-fill" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
        <span className={cx('absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow', inside ? 'bg-ok-fill' : 'bg-near-fill')} style={{ left: x(value) }} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-slate-500 tabular-nums">
        <span className="absolute -translate-x-1/2" style={{ left: x(lo) }}>{n0(lo)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: x(hi) }}>{n0(hi)}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- daily average */

function DailyAverage({ g, period }: { g: GrowthNutrition; period: 'd3' | 'd7' | 'd30' }) {
  const a = g.avg[period], b = g.bal[period];
  const amount = (n: Nutrient) => { const v = a.nutrients[n].est; return v === null ? { v: '—', u: '' } : { v: UNIT[n] === 'mg' ? n0(v) : String(Math.round(v)), u: UNIT_AR[UNIT[n]] }; };
  const others = NUTRIENTS.filter((n) => n !== 'carbs' && n !== 'protein' && n !== 'fat');
  const shown = others.filter((n) => b.states[n] && b.states[n] !== 'insufficient');
  const hidden = others.filter((n) => !shown.includes(n));
  if (!a.enough) return null;
  return (
    <Card className="space-y-1">
      <h2 className="mb-1 font-bold">{t('المتوسط اليومي')}</h2>
      {(['carbs', 'protein', 'fat'] as const).map((n) => {
        const l = macroLevel(n, a, g.refs, g.coverageMin);
        const word = n === 'protein' && l === 'ok' ? t('كافٍ') : LEVEL_WORD[l];
        return <Line key={n} name={NUTRIENT_NAME[n]} amount={amount(n)} mark={MARK[l]} word={word} tone={levelTone(l)} />;
      })}
      {shown.map((n) => { const s = b.states[n]!; return <Line key={n} name={NUTRIENT_NAME[n]} amount={amount(n)} mark={s === 'adequate' || s === 'within' ? '✓' : s === 'low' ? '↓' : '↑'} word={STATE_WORD[s]} tone={levelTone(s)} />; })}
      {hidden.length > 0 && (
        <details className="pt-1">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm text-slate-600">{t('مغذيات أخرى: بيانات الملصقات غير كافية')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
          <ul className="space-y-1 pb-1 text-xs text-slate-500">
            {hidden.map((n) => <li key={n} className="flex justify-between gap-2"><span>{NUTRIENT_NAME[n]}</span><span>{t('تغطية {p}%', { p: Math.round(a.nutrients[n].coverage * 100) })}</span></li>)}
          </ul>
          <p className="pb-2 text-[11px] text-slate-500">{t('تتحسن عند إضافة هذه القيم لملصقات المنتجات الأكثر أكلًا.')}</p>
        </details>
      )}
    </Card>
  );
}
const Line = ({ name, amount, mark, word, tone }: { name: string; amount: { v: string; u: string }; mark: string; word: string; tone: string }) => (
  <div className="flex min-h-[36px] items-center justify-between gap-2 text-sm">
    <span><span className="font-medium">{name}</span> <span className="text-slate-500"><Num>{amount.v}</Num> {amount.u}</span></span>
    <span className={cx('shrink-0 font-medium', tone)}>{mark} {word}</span>
  </div>
);

/* ------------------------------------------------------------------ growth */

function GrowthSection({ g, onAdd, onEdit }: { g: GrowthNutrition; onAdd: () => void; onEdit: (m: MeasurementRow) => void }) {
  const [ind, setInd] = useState<Indicator>('bmi');
  const L = g.growth.latest, lastH = [...g.points].reverse().find((p) => p.height_cm !== null);
  const zb = [...g.points].reverse().find((p) => p.z.bmi != null)?.z.bmi ?? null, zh = lastH?.z.hfa ?? null, zw = L?.z.wfa ?? null;
  const ok = g.growth.reasons.length === 0;
  const pct = (z: number | null) => (z === null ? null : t('المئين {p}', { p: ord(Math.round(percentile(z))) }));
  const ch = g.growth.change;
  return (
    <Card className="space-y-2.5">
      {L ? (
        <>
          <p className={cx('font-bold', ok ? 'text-ok' : 'text-near')}>{ok ? t('النمو: ضمن المتوقع ✓') : t('النمو: يستحق نظرة')}</p>
          <div className="space-y-1 text-sm">
            {L.weight_kg !== null && <Meas name={t('الوزن')} v={`${fmt(L.weight_kg)} ${t('كغ')}`} p={pct(zw)} />}
            {lastH && <Meas name={t('الطول')} v={`${fmt(lastH.height_cm!)} ${t('سم')}`} p={pct(zh)} />}
            {L.bmi !== null && <Meas name={t('مؤشر الكتلة')} v={L.bmi.toFixed(1)} p={pct(zb)} />}
          </div>
          <p className="text-xs text-slate-500">{t('آخر قياس {d}', { d: day(L.on) })}{g.growth.state === 'baseline' ? ` · ${t('المسار بعد قياس ثانٍ بعد 3 أشهر')}` : ''}</p>
          <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-xs" role="tablist">
            {(['bmi', 'hfa', 'wfa'] as Indicator[]).map((k) => (
              <button key={k} role="tab" aria-selected={ind === k} onClick={() => setInd(k)} className={cx('min-h-[32px] rounded-full', ind === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{IND[k]}</button>
            ))}
          </div>
          <Chart g={g} ind={ind} />
        </>
      ) : <p className="text-sm text-slate-500">{t('لا قياسات بعد.')}</p>}
      {!g.profile.birth && <Alert tone="info">{t('أضف تاريخ الميلاد في «الملف والأهداف» لحساب المئين.')}</Alert>}
      <Btn kind="primary" block onClick={onAdd}>{t('+ وزن / طول')}</Btn>
      {g.measurements.length > 0 && (
        <details>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-medium">{t('السجل والتغيّر')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
          <div className="grid grid-cols-3 gap-1 text-center text-xs">
            {([['d7', t('7 أيام')], ['d30', t('30 يومًا')], ['d90', t('90 يومًا')]] as const).map(([k, l]) => (
              <span key={k} className="rounded-lg bg-slate-50 py-1"><span className="block text-[11px] text-slate-500">{l}</span><Num>{ch[k] === null ? '—' : `${ch[k]! > 0 ? '+' : ''}${fmt(ch[k]!)} kg`}</Num></span>
            ))}
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {[...g.measurements].reverse().map((m) => (
              <li key={m.id}><button className="flex min-h-[44px] w-full items-center justify-between gap-2 text-start" onClick={() => onEdit(m)}>
                <span>{day(m.measured_on)}{m.place === 'clinic' ? ` · ${t('العيادة')}` : ''}</span>
                <Num>{[m.weight_kg !== null ? `${fmt(m.weight_kg)} kg` : null, m.height_cm !== null ? `${fmt(m.height_cm)} cm` : null].filter(Boolean).join(' · ')}</Num>
              </button></li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
const Meas = ({ name, v, p }: { name: string; v: string; p: string | null }) => (
  <div className="flex items-baseline justify-between gap-2"><span><span className="text-slate-600">{name}</span> <b><Num>{v}</Num></b></span>{p && <span className="text-slate-600">{p}</span>}</div>
);

/* ------------------------------------------------------------ one tap deeper */

function MealPatterns({ g, period }: { g: GrowthNutrition; period: 'd3' | 'd7' | 'd30' }) {
  const a = g.avg[period], f = g.fatty;
  const enough = a.groupCoverage >= g.coverageMin && a.days > 0;
  return (
    <details className="rounded-2xl border border-slate-100 bg-white px-4">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between font-bold">{t('أنماط الوجبات')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
      <div className="space-y-2 pb-4 text-sm">
        <h3 className="text-xs font-bold text-slate-500">{t('مجموعات الطعام · {p}', { p: PERIOD_LONG[period] })}</h3>
        {!enough ? <p className="text-slate-500">{t('بيانات غير كافية')}</p> : SHOWN_GROUPS.map((k) => {
          const d = a.groupDays[k] ?? 0, few = (k === 'vegetables' || k === 'fruit') && d < a.days * NUTRITION_RULES.fewDaysShare;
          return <div key={k} className="flex justify-between"><span className="text-slate-600">{GROUP[k]}</span><span className={few ? 'text-near' : ''}><Num>{d}/{a.days}</Num> {t('أيام')}</span></div>;
        })}
        {enough && a.extrasCarbShare !== null && <p className="text-xs text-slate-500">{t('من الكارب من حلويات ومشروبات محلاة ومصنّعة: {p}%', { p: Math.round(a.extrasCarbShare * 100) })}</p>}
        {f.meals > 0 && <>
          <h3 className="pt-2 text-xs font-bold text-slate-500">{t('وجبات عالية الدهون أو البروتين · آخر 7 أيام')}</h3>
          <p>{t('{n} من {m} وجبة', { n: f.fatty, m: f.meals })}</p>
          <p className="text-xs text-slate-500">{t('قد ترفع السكر متأخرًا. تعديل الإنسولين يقرره فريق السكري.')}</p>
          <Link to="/analysis?mode=meals" className="inline-flex min-h-[40px] items-center font-bold text-brand">{t('استجابة السكر للوجبات')} {isEn() ? '›' : '‹'}</Link>
        </>}
      </div>
    </details>
  );
}

function HowTargets({ g }: { g: GrowthNutrition }) {
  const { settings } = useData();
  const setActivity = async (x: Activity) => { try { await saveSettings({ ...settings, activity_level: x }); } catch (e) { toast((e as Error).message); } };
  const r = g.energyRef;
  return (
    <details className="rounded-2xl border border-slate-100 bg-white px-4">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between font-bold">{t('كيف تُحسب الأهداف')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
      <div className="space-y-3 pb-4 text-sm">
        {r && <p>{t('الطاقة: ~{k} سعرة/يوم، المدى {lo}–{hi}', { k: n0(r.kcal), lo: n0(r.low), hi: n0(r.high) })} · {SOURCE[r.source]}</p>}
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">{t('النشاط')}{g.profile.activityAssumed && <span className="text-slate-400"> · {t('افتراضي، اختر الأقرب')}</span>}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {ACTIVITIES.map((x) => (
              <button key={x} onClick={() => setActivity(x)} className={cx('min-h-[44px] rounded-xl px-2 py-1 text-start text-xs', g.profile.activity === x && !g.profile.activityAssumed ? 'bg-brand-soft text-brand' : g.profile.activity === x ? 'bg-slate-100 font-medium' : 'border border-slate-100')}>
                <b className="block">{ACTIVITY[x]}{g.eer && <span className="font-normal text-slate-500"> · <Num>{n0(g.eer.byActivity[x])}</Num></span>}</b>{ACTIVITY_HINT[x]}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-1 text-xs text-slate-600">
          {NUTRIENTS.map((n) => <li key={n} className="flex justify-between gap-2"><span>{NUTRIENT_NAME[n]}</span><span className="text-end">{refText(n, g.refs[n])}</span></li>)}
        </ul>
        <p className="text-xs text-slate-500">{t('تقديرات مرجعية وليست حدودًا. البيانات الناقصة لا تُحسب صفرًا، وعلاج الانخفاض لا يدخل في التوازن.')}</p>
        <Sources />
      </div>
    </details>
  );
}

/** Her points on WHO's 3rd, 15th, 50th, 85th and 97th centile curves (girls). */
const CENTILES: [number, string][] = [[-1.881, '3'], [-1.036, '15'], [0, '50'], [1.036, '85'], [1.881, '97']];
function Chart({ g, ind }: { g: GrowthNutrition; ind: Indicator }) {
  const pts = g.points.map((p) => ({ x: p.months, y: ind === 'bmi' ? p.bmi : ind === 'hfa' ? p.height_cm : p.weight_kg })).filter((p) => p.y !== null) as { x: number; y: number }[];
  const [lo, hi] = RANGE[ind];
  if (!pts.length || !g.profile.birth) return null;
  const x0 = Math.max(lo, Math.floor(Math.min(...pts.map((p) => p.x)) - 6)), x1 = Math.min(hi, Math.max(x0 + 24, Math.ceil(Math.max(...pts.map((p) => p.x)) + 12)));
  if (pts.every((p) => p.x < lo || p.x > hi)) return <p className="text-xs text-slate-500">{t('خارج عمر هذا المرجع.')}</p>;
  const curves = CENTILES.map(([z, label]) => ({ label, d: Array.from({ length: 25 }, (_, k) => x0 + ((x1 - x0) * k) / 24).map((m) => [m, valueAtZ(ind, m, z)!] as [number, number]) }));
  const ys = [...curves.flatMap((c) => c.d.map((d) => d[1])), ...pts.map((p) => p.y)];
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 320, H = 170, P = { l: 30, r: 24, t: 8, b: 18 };
  const sx = (m: number) => P.l + ((m - x0) / (x1 - x0)) * (W - P.l - P.r), sy = (v: number) => H - P.b - ((v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const years = [] as number[]; for (let y = Math.ceil(x0 / 12); y * 12 <= x1; y++) years.push(y);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ direction: 'ltr' }} role="img" aria-label={t('منحنى {x} مع خطوط المئين', { x: IND[ind] })}>
      {years.map((y) => <g key={y}><line x1={sx(y * 12)} x2={sx(y * 12)} y1={P.t} y2={H - P.b} className="stroke-slate-100" /><text x={sx(y * 12)} y={H - 4} textAnchor="middle" className="fill-slate-400 text-[9px]">{y}</text></g>)}
      {curves.map((c) => <g key={c.label}>
        <polyline fill="none" points={c.d.map(([m, v]) => `${sx(m)},${sy(v)}`).join(' ')} className={c.label === '50' ? 'stroke-slate-400' : 'stroke-slate-200'} strokeWidth={c.label === '50' ? 1.5 : 1} />
        <text x={W - P.r + 3} y={sy(c.d[c.d.length - 1][1]) + 3} className="fill-slate-400 text-[8px]">{c.label}</text>
      </g>)}
      {[y0, (y0 + y1) / 2, y1].map((v) => <text key={v} x={P.l - 4} y={sy(v) + 3} textAnchor="end" className="fill-slate-400 text-[8px]">{v.toFixed(ind === 'bmi' ? 1 : 0)}</text>)}
      <polyline fill="none" points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} className="stroke-brand" strokeWidth={1.5} />
      {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3.5} className="fill-brand" />)}
    </svg>
  );
}

function refText(n: Nutrient, r: Ref | undefined) {
  if (!r) return t('لا مرجع');
  const u = UNIT_AR[UNIT[n]];
  const v = r.kind === 'min' ? t('المرجع ≥ {v} {u}', { v: UNIT[n] === 'mg' ? n0(r.value) : fmt(r.value), u }) : r.kind === 'max' ? t('الحد ≤ {v} {u}', { v: n0(r.value), u })
    : r.kind === 'pct_range' ? t('{lo}–{hi}% من الطاقة', { lo: r.value, hi: r.high }) : t('أقل من {v}% من الطاقة', { v: r.value });
  return `${v} · ${SOURCE[r.source]}`;
}

/* ----------------------------------------------------------- profile/targets */

const TARGET_KEYS: { k: Nutrient; kind: 'min' | 'max' }[] = [{ k: 'protein', kind: 'min' }, { k: 'fiber', kind: 'min' }, { k: 'calcium', kind: 'min' }, { k: 'iron', kind: 'min' }, { k: 'vit_d', kind: 'min' }, { k: 'potassium', kind: 'min' }, { k: 'sodium', kind: 'max' }];
function ProfileSection({ g }: { g: GrowthNutrition }) {
  const { settings } = useData();
  const [birth, setBirth] = useState(g.profile.birth ?? '');
  const [approx, setApprox] = useState(g.profile.approx);
  const [tg, setTg] = useState<Targets>(g.targets);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await saveSettings({ ...settings, child_birth_date: birth || null, child_birth_approx: approx, child_sex: settings.child_sex ?? 'female', nutrition_targets: tg }); toast(t('تم الحفظ ✓')); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const ref = (k: Nutrient) => tg.refs?.[k]?.value ?? null;
  const setRef = (k: Nutrient, kind: 'min' | 'max', v: number | null) => setTg((x) => { const refs = { ...(x.refs ?? {}) }; if (v === null) delete refs[k]; else refs[k] = { kind, value: v }; return { ...x, refs }; });
  return (
    <details className="rounded-2xl border border-slate-100 bg-white px-4">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between font-bold">{t('الملف والأهداف')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
      <div className="space-y-3 pb-4">
        <Field label={t('تاريخ الميلاد')} hint={t('العمر بالأشهر يغيّر المئين؛ التاريخ الدقيق أفضل.')}>
          <input type="date" className={inputCls} dir="ltr" value={birth} max={today()} onChange={(e) => setBirth(e.target.value)} />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={approx} onChange={(e) => setApprox(e.target.checked)} />{t('التاريخ تقريبي')}</label>
        <h3 className="pt-1 text-sm font-bold">{t('أهداف أخصائية التغذية')}</h3>
        <p className="text-xs text-slate-500">{t('اتركه فارغًا لاستخدام المرجع العام. أي رقم هنا يحل محله ويظهر «أخصائية التغذية» كمصدر.')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('الطاقة (سعرة/يوم)')}><NumInput value={tg.energy_kcal ?? null} onChange={(v) => setTg((x) => ({ ...x, energy_kcal: v }))} /></Field>
          {TARGET_KEYS.map(({ k, kind }) => (
            <Field key={k} label={`${NUTRIENT_NAME[k]} (${kind === 'min' ? '≥' : '≤'} ${UNIT_AR[UNIT[k]]})`}><NumInput value={ref(k)} onChange={(v) => setRef(k, kind, v)} /></Field>
          ))}
          <Field label={t('حد التغطية (%)')} hint={t('قاعدة في التطبيق، ليست معيارًا طبيًا')}><NumInput value={tg.coverage_min != null ? Math.round(tg.coverage_min * 100) : null} onChange={(v) => setTg((x) => ({ ...x, coverage_min: v === null ? null : Math.min(100, Math.max(50, v)) / 100 }))} /></Field>
        </div>
        <Btn kind="primary" block disabled={busy} onClick={save}>{t('حفظ')}</Btn>
      </div>
    </details>
  );
}

function Sources() {
  return (
    <details className="text-xs text-slate-600">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between text-sm font-bold">{t('المصادر وطريقة الحساب')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
      <ul className="list-disc space-y-1 pb-4 ps-5" dir="ltr">
        <li>Growth: WHO Growth Reference 2007 (5–19 y), girls' LMS tables; WHO z-score method incl. restricted tails beyond ±3 SD. de Onis et al., Bull WHO 2007;85:660–7.</li>
        <li>Energy: NASEM 2023, Dietary Reference Intakes for Energy, Table 5-5 (girls 3–18 y) + growth 15 kcal/d (4–8 y); range ± 221 kcal/d (published SE).</li>
        <li>T1D nutrition: ISPAD 2022 Nutritional management (Annan et al., Pediatr Diabetes 2022;23(8):1297–1321), Box 1 macronutrient guide, Box 3 fibre.</li>
        <li>ADA Standards of Care in Diabetes—2026, Section 14 (Diabetes Care 2026;49 Suppl 1:S297–S320), recs 14.2, 14.4, 14.5.</li>
        <li>Micronutrients: IOM 2001 (iron), IOM 2005 (protein 0.95 g/kg), IOM 2011 (calcium, vitamin D), NASEM 2019 (sodium CDRR, potassium AI), DGA 2020–2025 (added sugars).</li>
        <li>App rules (configurable, not clinical standards): coverage ≥ 80 %; a day counts with ≥ 3 entries; trajectory after ≥ 90 days; 0.67 z drop; weight −3 % over ≥ 60 days.</li>
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------- measurement */

function MeasureSheet({ edit, list, onClose }: { edit: Partial<MeasurementRow> | null; list: MeasurementRow[]; onClose: () => void }) {
  const [m, setM] = useState<Partial<MeasurementRow>>({});
  const [warned, setWarned] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (edit) { setM({ measured_on: today(), place: 'home', ...edit }); setWarned(false); } }, [edit]);
  const prev = useMemo(() => [...list].filter((x) => x.id !== m.id && x.measured_on <= (m.measured_on ?? today())).pop() ?? null, [list, m.id, m.measured_on]);
  const odd = prev && m.measured_on ? implausible({ on: prev.measured_on, weight_kg: prev.weight_kg, height_cm: prev.height_cm }, { on: m.measured_on, weight_kg: m.weight_kg ?? null, height_cm: m.height_cm ?? null }) : [];
  const save = async () => {
    if (!m.measured_on || (m.weight_kg == null && m.height_cm == null)) return toast(t('اكتب الوزن أو الطول'));
    if (odd.length && !warned) { setWarned(true); return; }
    setBusy(true);
    try { await saveMeasurement({ id: m.id, measured_on: m.measured_on, weight_kg: m.weight_kg ?? null, height_cm: m.height_cm ?? null, place: m.place ?? null, note: m.note ?? null }); toast(t('تم الحفظ ✓')); onClose(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const del = async () => { if (!m.id) return; setBusy(true); try { await deleteMeasurement(m.id); toast(t('تم الحذف')); onClose(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  return (
    <Sheet open={!!edit} onClose={onClose} title={m.id ? t('تعديل القياس') : t('قياس جديد')}>
      <div className="space-y-3">
        <Field label={t('التاريخ')}><input type="date" className={inputCls} dir="ltr" max={today()} value={m.measured_on ?? ''} onChange={(e) => setM({ ...m, measured_on: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('الوزن (كغ)')}><NumInput value={m.weight_kg ?? null} onChange={(v) => setM({ ...m, weight_kg: v })} /></Field>
          <Field label={t('الطول (سم)')}><NumInput value={m.height_cm ?? null} onChange={(v) => setM({ ...m, height_cm: v })} /></Field>
        </div>
        <p className="text-xs text-slate-500">{t('يكفي أحدهما: الوزن في البيت، والطول في العيادة.')}</p>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm">
          {(['home', 'clinic'] as const).map((p) => <button key={p} onClick={() => setM({ ...m, place: p })} className={cx('min-h-[40px] rounded-full', m.place === p ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{p === 'home' ? t('البيت') : t('العيادة')}</button>)}
        </div>
        <Field label={t('ملاحظة')}><input className={inputCls} value={m.note ?? ''} onChange={(e) => setM({ ...m, note: e.target.value })} /></Field>
        {warned && odd.length > 0 && <Alert tone="near">{t('تغيّر كبير عن القياس السابق ({d}). هل الرقم صحيح؟ اضغط حفظ مرة أخرى للتأكيد.', { d: day(prev!.measured_on) })}</Alert>}
        <Btn kind="primary" block disabled={busy} onClick={save}>{t('حفظ')}</Btn>
        {m.id && <Btn block disabled={busy} onClick={del}>{t('حذف القياس')}</Btn>}
      </div>
    </Sheet>
  );
}
