import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { saveSettings } from '../lib/api';
import { backTo } from '../lib/nav';
import { deleteMeasurement, saveMeasurement, useGrowthNutrition, type GrowthNutrition, type MeasurementRow } from '../lib/growth';
import { RANGE, bmiBand, heightBand, implausible, percentile, valueAtZ, type Indicator } from '../engine/growth';
import { ACTIVITIES, type Activity } from '../engine/energy';
import { NUTRIENTS, NUTRITION_RULES, SHOWN_GROUPS, UNIT, pctOfEnergy, type Nutrient, type Period, type Ref, type State, type Targets } from '../engine/nutrition';
import { ACTIVITY, ACTIVITY_HINT, BALANCE_ISSUE, BAND, ENERGY_CHIP, GROUP, GROWTH_REASON, NUTRIENT_NAME, SOURCE, STATE } from '../components/growthText';
import { Alert, Btn, Card, Field, NumInput, Page, Sheet, cx, inputCls, toast } from '../components/ui';
import { fmt } from '../lib/carbs';
import { isEn, locale, t, tr } from '../i18n';

const UNIT_AR: Record<string, string> = tr({ g: 'غ', mg: 'ملغ', 'µg': 'ميكروغرام', kcal: 'سعرة' } as Record<string, string>); // i18n-ok: values translated when read
const PERIOD = tr({ today: 'اليوم', d7: '7 أيام', d30: '30 يومًا' }); // i18n-ok
const IND = tr({ bmi: 'مؤشر الكتلة', hfa: 'الطول', wfa: 'الوزن' }); // i18n-ok
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const tone = (s: State | string) => (s === 'low' || s === 'high' || s === 'below' ? 'bg-near-soft text-near' : s === 'adequate' || s === 'within' ? 'bg-ok-soft text-ok' : 'bg-slate-100 text-slate-600');
const Num = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr" className="tabular-nums">{children}</bdi>;

/**
 * النمو والتغذية: is her growth on track (WHO 2007), is she eating enough (NASEM 2023 EER), is the pattern balanced
 * (ISPAD 2022, ADA 2026)? Measurement and pattern detection only: the care team and dietitian decide.
 */
export default function Growth() {
  const nav = useNavigate();
  const g = useGrowthNutrition();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<Partial<MeasurementRow> | null>(null);
  const [period, setPeriod] = useState<Period>('d7');
  useEffect(() => { if (params.get('add')) { setEdit({}); setParams({}, { replace: true }); } }, [params, setParams]);

  const reasons = [...g.growth.reasons.map((r) => GROWTH_REASON[r]), ...(g.energy.d7 === 'below' ? [t('متوسط الطاقة في آخر 7 أيام أقل من المدى التقديري لاحتياجها.')] : []),
    ...g.bal.d7.issues.map((i) => t('{x} في آخر 7 أيام.', { x: BALANCE_ISSUE[i] }))];

  return (
    <Page title={t('النمو والتغذية')} back={() => backTo(nav, '/')}>
      {!g.ready ? <p className="text-sm text-slate-500">{t('جارٍ التحميل…')}</p> : (
        <div className="space-y-4">
          {reasons.length > 0 && (
            <Alert tone="near">
              <b className="block">{t('يستحق نظرة')}</b>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-1.5 text-xs">{t('ملاحظة للنقاش مع فريق السكري وأخصائية التغذية، وليست تشخيصًا.')}</p>
            </Alert>
          )}
          <GrowthSection g={g} onAdd={() => setEdit({})} onEdit={(m) => setEdit(m)} />
          <div>
            <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm" role="tablist" aria-label={t('الفترة')}>
              {(['today', 'd7', 'd30'] as Period[]).map((p) => (
                <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cx('min-h-[36px] rounded-full', period === p ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{PERIOD[p]}</button>
              ))}
            </div>
          </div>
          <EnergySection g={g} period={period} />
          <NutrientSection g={g} period={period} />
          <GroupSection g={g} period={period} />
          <CompositionSection g={g} />
          <ProfileSection g={g} />
          <Link to="/diet-sheet" className="flex min-h-[52px] items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 text-sm font-bold">
            {t('جدول أخصائية التغذية (PDF)')}<span className="opacity-60">{isEn() ? '›' : '‹'}</span>
          </Link>
          <Sources />
        </div>
      )}
      <MeasureSheet edit={edit} list={g.measurements} onClose={() => setEdit(null)} />
    </Page>
  );
}

/* ------------------------------------------------------------------ growth */

function GrowthSection({ g, onAdd, onEdit }: { g: GrowthNutrition; onAdd: () => void; onEdit: (m: MeasurementRow) => void }) {
  const [ind, setInd] = useState<Indicator>('bmi');
  const L = g.growth.latest, lastH = [...g.points].reverse().find((p) => p.height_cm !== null);
  const z = (v: number | null | undefined) => (v == null ? null : v);
  const zb = z([...g.points].reverse().find((p) => p.z.bmi != null)?.z.bmi), zh = z(lastH?.z.hfa), zw = z(L?.z.wfa);
  const row = (label: string, v: number | null, band?: string) => v === null ? null : (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span>{t('المئين')} <b><Num>{Math.round(percentile(v))}</Num></b> <bdi dir="ltr" className="text-xs text-slate-500">(z {v.toFixed(2)})</bdi>{band && <span className="text-xs text-slate-500"> · {band}</span>}</span>
    </div>
  );
  const ch = g.growth.change;
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">{t('النمو')}</h2>
        <span className="text-xs text-slate-500">{t('مرجع WHO 2007، بنات 5–19 سنة')}</span>
      </div>
      {!g.profile.birth && <Alert tone="info">{t('أضف تاريخ الميلاد في «الملف والأهداف» لحساب المئين.')}</Alert>}
      {L ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={t('الوزن')} value={L.weight_kg !== null ? `${fmt(L.weight_kg)} ${t('كغ')}` : '—'} />
            <Stat label={t('الطول')} value={lastH ? `${fmt(lastH.height_cm!)} ${t('سم')}` : '—'} />
            <Stat label={t('مؤشر الكتلة')} value={L.bmi !== null ? L.bmi.toFixed(1) : '—'} />
          </div>
          <p className="text-xs text-slate-500">{t('آخر قياس {d}', { d: day(L.on) })}{g.profile.age !== null && ` · ${t('العمر {a} سنة', { a: g.profile.age.toFixed(1) })}${g.profile.approx ? ` ${t('(تقريبي)')}` : ''}`}</p>
          <div className="space-y-1">
            {row(t('مؤشر الكتلة للعمر'), zb, zb !== null ? BAND[bmiBand(zb)] : undefined)}
            {row(t('الطول للعمر'), zh, zh !== null ? BAND[heightBand(zh)] : undefined)}
            {row(t('الوزن للعمر'), zw)}
          </div>
          {g.growth.state === 'baseline' && <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{t('بداية السجل: يُحكم على مسار النمو بعد قياسين بينهما 3 أشهر على الأقل. التغيرات القصيرة تُعرض فقط.')}</p>}
          <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-xs" role="tablist">
            {(['bmi', 'hfa', 'wfa'] as Indicator[]).map((k) => (
              <button key={k} role="tab" aria-selected={ind === k} onClick={() => setInd(k)} className={cx('min-h-[32px] rounded-full', ind === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{IND[k]}</button>
            ))}
          </div>
          <Chart g={g} ind={ind} />
          <div className="grid grid-cols-3 gap-1 text-center text-xs">
            {([['d7', t('7 أيام')], ['d30', t('30 يومًا')], ['d90', t('90 يومًا')]] as const).map(([k, l]) => (
              <span key={k} className="rounded-lg bg-slate-50 py-1"><span className="block text-[11px] text-slate-500">{l}</span><Num>{ch[k] === null ? '—' : `${ch[k]! > 0 ? '+' : ''}${fmt(ch[k]!)} ${t('كغ')}`}</Num></span>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{t('تغيّر الوزن للعرض فقط؛ الحكم على المسار الطويل.')}</p>
        </>
      ) : <p className="text-sm text-slate-500">{t('لا قياسات بعد.')}</p>}
      <Btn kind="primary" block onClick={onAdd}>{t('+ وزن / طول')}</Btn>
      {g.measurements.length > 0 && (
        <details>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-medium">{t('السجل ({n})', { n: g.measurements.length })}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
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

const Stat = ({ label, value }: { label: string; value: string }) => (
  <span className="rounded-xl bg-slate-50 py-2"><span className="block text-[11px] text-slate-500">{label}</span><b className="text-lg"><Num>{value}</Num></b></span>
);

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

/* ------------------------------------------------------------------ energy */

function EnergySection({ g, period }: { g: GrowthNutrition; period: Period }) {
  const { settings } = useData();
  const a = g.avg[period], r = g.energyRef, st = g.energy[period];
  const cov = a.energy.coverage;
  const setActivity = async (x: Activity) => { try { await saveSettings({ ...settings, activity_level: x }); } catch (e) { toast((e as Error).message); } };
  return (
    <Card className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">{t('الطاقة')}</h2>
        {period !== 'today' && <span className={cx('rounded-full px-2 py-0.5 text-xs', tone(st))}>{ENERGY_CHIP[st]}</span>}
      </div>
      <Row label={t('الاحتياج التقديري')} value={r ? <><Num>~{n0(r.kcal)}</Num> {t('سعرة/يوم')}</> : '—'} sub={r ? <>{t('المدى')} <Num>{n0(r.low)}–{n0(r.high)}</Num> · {SOURCE[r.source]}</> : t('يحتاج الوزن والطول وتاريخ الميلاد')} />
      <Row label={t('الطعام')} value={a.energy.est !== null ? <><Num>{cov < 1 ? '≈' : ''}{n0(a.energy.est)}</Num> {t('سعرة')}</> : '—'} sub={t('تغطية {p}%', { p: Math.round(cov * 100) })} />
      <Row label={t('علاج الانخفاض')} value={<><Num>+{n0(a.treatment.kcal)}</Num> {t('سعرة')}</>} sub={<><Num>+{fmt(Math.round(a.treatment.carbs))}</Num> {t('غ كارب')}</>} />
      <Row strong label={t('المجموع')} value={a.totalKcal !== null ? <><Num>{n0(a.totalKcal)}</Num> {t('سعرة')}</> : '—'} />
      <p className="text-xs text-slate-500">
        {period === 'today' ? t('اليوم حتى الآن.') : t('متوسط {n} يوم مكتمل (3 وجبات أو أكثر).', { n: a.days })}{' '}
        {t('الاحتياج تقدير مرجعي من معادلات NASEM 2023 بعمرها وطولها ووزنها ونشاطها، وليس هدفًا ولا حدًا. تجاوزه قليلًا ليس مشكلة؛ النمو هو الحكم.')}
      </p>
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
    </Card>
  );
}
const Row = ({ label, value, sub, strong }: { label: string; value: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) => (
  <div className={cx('flex items-baseline justify-between gap-3 text-sm', strong && 'border-t border-slate-100 pt-2 font-bold')}>
    <span className="text-slate-600">{label}</span>
    <span className="text-end">{value}{sub && <span className="block text-[11px] font-normal text-slate-500">{sub}</span>}</span>
  </div>
);

/* --------------------------------------------------------------- nutrients */

function refText(n: Nutrient, r: Ref | undefined) {
  if (!r) return t('لا مرجع');
  const u = UNIT_AR[UNIT[n]];
  const v = r.kind === 'min' ? t('المرجع ≥ {v} {u}', { v: UNIT[n] === 'mg' ? n0(r.value) : fmt(r.value), u }) : r.kind === 'max' ? t('الحد ≤ {v} {u}', { v: n0(r.value), u })
    : r.kind === 'pct_range' ? t('{lo}–{hi}% من الطاقة', { lo: r.value, hi: r.high }) : t('أقل من {v}% من الطاقة', { v: r.value });
  return `${v} · ${SOURCE[r.source]}`;
}
function NutrientSection({ g, period }: { g: GrowthNutrition; period: Period }) {
  const a = g.avg[period], b = g.bal[period];
  const foodKcal = a.energy.est;
  return (
    <Card className="space-y-2">
      <h2 className="font-bold">{t('التغذية')}</h2>
      <p className="text-xs text-slate-500">{t('من الأكل فقط (بدون علاج الانخفاض). الناقص في الملصق لا يُحسب صفرًا: «بيانات غير كافية» إذا قلّت التغطية عن {p}%.', { p: Math.round(g.coverageMin * 100) })}</p>
      <ul className="divide-y divide-slate-100">
        {NUTRIENTS.map((n) => {
          const tot = a.nutrients[n], st = b.states[n] ?? 'insufficient', pct = pctOfEnergy(n, tot, foodKcal);
          const known = tot.known > 0;
          const val = tot.est !== null && tot.coverage >= g.coverageMin ? `${tot.coverage < 1 ? '≈' : ''}${UNIT[n] === 'mg' ? n0(tot.est) : fmt(Math.round(tot.est * 10) / 10)}` : known ? `≥${UNIT[n] === 'mg' ? n0(tot.known) : fmt(Math.round(tot.known * 10) / 10)}` : '—';
          return (
            <li key={n} className="py-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{NUTRIENT_NAME[n]}</span>
                <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs', period === 'today' ? 'bg-slate-100 text-slate-600' : tone(st))}>{period === 'today' && st !== 'insufficient' ? t('حتى الآن') : STATE[st]}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-xs text-slate-500">
                <span><Num>{val}</Num>{val !== '—' && <> {UNIT_AR[UNIT[n]]}</>}{pct !== null && tot.coverage >= g.coverageMin && <> · <Num>{Math.round(pct)}%</Num> {t('من الطاقة')}</>} · {t('تغطية {p}%', { p: Math.round(tot.coverage * 100) })}</span>
                <span className="text-end">{refText(n, g.refs[n])}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-slate-500">{t('نسب الكارب والدهون والبروتين للسياق فقط: ISPAD 2022 تقول إن النسبة المثلى تُحدَّد لكل طفل. لا يُنصح بتقليل الكارب لتحسين منحنى السكر.')}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ groups */

function GroupSection({ g, period }: { g: GrowthNutrition; period: Period }) {
  const a = g.avg[period];
  const enough = a.groupCoverage >= g.coverageMin && a.days > 0;
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">{t('مجموعات الطعام')}</h2>
        <span className="text-xs text-slate-500">{t('أيام فيها المجموعة')} · {t('تغطية {p}%', { p: Math.round(a.groupCoverage * 100) })}</span>
      </div>
      {!enough ? <p className="text-sm text-slate-500">{t('بيانات غير كافية: وجبات كثيرة بلا مكوّنات معروفة (مثل المستورد من Gluroo).')}</p> : (
        <>
          <ul className="space-y-1.5 text-sm">
            {SHOWN_GROUPS.map((k) => {
              const d = a.groupDays[k] ?? 0, few = (k === 'vegetables' || k === 'fruit') && d < a.days * NUTRITION_RULES.fewDaysShare;
              return (
                <li key={k} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 text-slate-600">{GROUP[k]}</span>
                  <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100" dir="ltr"><i className={few ? 'bg-near-fill' : 'bg-ok-fill'} style={{ width: `${(d / Math.max(1, a.days)) * 100}%` }} /></span>
                  <span className="w-10 shrink-0 text-end text-xs"><Num>{d}/{a.days}</Num></span>
                </li>
              );
            })}
          </ul>
          {a.extrasCarbShare !== null && <p className="text-xs text-slate-600">{t('من الكارب من حلويات ومشروبات محلاة ومصنّعة: {p}%', { p: Math.round(a.extrasCarbShare * 100) })}</p>}
        </>
      )}
      <p className="text-[11px] text-slate-500">{t('حسب ADA 2026 (14.2): خضار غير نشوية، فواكه كاملة، بقوليات، حبوب كاملة، مكسرات، ألبان؛ وأقل من المشروبات المحلاة والحلويات والمصنّع.')}</p>
    </Card>
  );
}

function CompositionSection({ g }: { g: GrowthNutrition }) {
  const f = g.fatty;
  if (!f.meals) return null;
  return (
    <Card className="space-y-1.5">
      <h2 className="font-bold">{t('تركيبة الوجبات')}</h2>
      <p className="text-sm">{t('وجبات عالية الدهون أو البروتين في آخر 7 أيام: {n} من {m}', { n: f.fatty, m: f.meals })}{f.unknown > 0 && <span className="text-xs text-slate-500"> · {t('{n} بلا بيانات دهون', { n: f.unknown })}</span>}</p>
      <p className="text-xs text-slate-500">{t('هذه الوجبات قد ترفع السكر متأخرًا (ADA 2026، 14.4). أي تعديل في الإنسولين يقرره فريق السكري.')}</p>
      <Link to="/analysis?mode=meals" className="inline-flex min-h-[40px] items-center text-sm font-bold text-brand">{t('استجابة السكر للوجبات')} {isEn() ? '›' : '‹'}</Link>
    </Card>
  );
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
    <details className="rounded-2xl border border-slate-100 bg-white px-4 text-xs text-slate-600">
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
