import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { gmi } from '../lib/now';
import { Badge, Card, Chip, cx } from '../components/ui';
import { MIN_DAYS, daysFor, solidRuns, type Bin, type DayFilter } from '../engine/profile';
import { dayStartOf, dayTitle } from '../engine/day';
import { Link, useNavigate } from 'react-router-dom';
import { fetchSeries } from '../engine/useSeries';
import { DISMISS_MS, findPatterns, visible, type PatternCard } from '../engine/patterns';
import { isEn, t } from '../i18n';

const PERIODS = [7, 14, 30, 90];
// labels stay Arabic here and are shown with t()
const WEEK = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']; // i18n-ok
const FILTERS: [DayFilter, string][] = [['all', 'كل الأيام'], ['school', 'أيام المدرسة'], ['weekend', 'العطلة'], ['custom', 'أيام محددة']]; // i18n-ok

/** الأنماط: her typical day — median and 25–75 / 10–90 % bands over a 24-hour clock (AGP at 14+ days). */
export function Patterns() {
  const { settings } = useData();
  const unit = settings.glucose_unit;
  const [days, setDays] = useState(14);
  const [filter, setFilter] = useState<DayFilter>('all');
  const [custom, setCustom] = useState<number[]>([]);
  const [bins, setBins] = useState<Bin[] | null>(null);
  const [stats, setStats] = useState<GlucoseStats | null>(null);
  const [err, setErr] = useState('');
  const dows = daysFor(filter, settings.school_days, custom);

  useEffect(() => {
    const to = new Date(dayStartOf(Date.now()) + 86400000), from = new Date(to.getTime() - days * 86400000);
    setBins(null); setErr('');
    supabase.rpc('glucose_profile', { p_from: from.toISOString(), p_to: to.toISOString(), p_dows: dows, p_bin_min: 15 })
      .then(({ data, error }) => (error ? setErr(error.message) : setBins((data as Bin[]).map((b) => ({ ...b, p10: +b.p10, p25: +b.p25, p50: +b.p50, p75: +b.p75, p90: +b.p90 })))));
    glucoseStats(from, new Date(Math.min(to.getTime(), Date.now())), settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setStats).catch(() => setStats(null));
  }, [days, JSON.stringify(dows), settings.glucose_low_mgdl, settings.glucose_high_mgdl]);

  const enoughBins = bins?.filter((b) => b.days >= MIN_DAYS).length ?? 0;
  const cv = stats?.mean && stats.sd !== null ? (stats.sd / stats.mean) * 100 : null;

  return (
    <div className="space-y-3 pb-4">
      <PatternCards />
      <div className="flex gap-1.5" dir="ltr">
        {PERIODS.map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{t('{n} يوم', { n: d })}</Chip>)}
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
        {FILTERS.map(([f, l]) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{t(l)}</Chip>)}
      </div>
      {filter === 'custom' && (
        <div className="flex flex-wrap gap-1.5">
          {WEEK.map((w, d) => <Chip key={d} active={custom.includes(d)} onClick={() => setCustom(custom.includes(d) ? custom.filter((x) => x !== d) : [...custom, d])}>{t(w)}</Chip>)}
        </div>
      )}

      <Card className="!px-2">
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="font-bold">{days >= 14 ? t('ملف السكر اليومي (AGP)') : t('يومها المعتاد')}</h2>
          <Badge>{t('منشور')}</Badge>
        </div>
        {err ? <p className="px-2 text-sm font-medium text-brand">{err}</p> : !bins ? <p className="px-2 text-slate-500">…</p> : bins.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">{t('لا توجد قراءات في هذه الفترة.')}</p>
        ) : <ProfileChart bins={bins} unit={unit} range={effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl)} />}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><i className="h-0.5 w-4 rounded bg-brand" /> {t('الوسيط')}</span>
          <span className="inline-flex items-center gap-1"><i className="h-3 w-4 rounded-sm bg-brand-light/40" /> 25–75%</span>
          <span className="inline-flex items-center gap-1"><i className="h-3 w-4 rounded-sm bg-brand-light/15" /> 10–90%</span>
          <span className="inline-flex items-center gap-1"><i className="h-0 w-4 border-t-2 border-dashed border-slate-300" /> {t('أقل من {n} أيام', { n: MIN_DAYS })}</span>
        </div>
        {bins && bins.length > 0 && enoughBins < 48 && <p className="mt-2 px-2 text-xs text-slate-500">{t('البيانات قليلة بعد: النمط يصير أوضح مع المزيد من الأيام.')}</p>}
      </Card>

      {stats && stats.n > 0 && (
        <Card className="grid grid-cols-3 gap-2 !py-3 text-center">
          <Stat label={t('ضمن النطاق')} value={`${Math.round(stats.pct_in)}%`} tone="text-ok" />
          <Stat label={t('التذبذب CV')} value={cv !== null ? `${cv.toFixed(0)}%` : '—'} />
          <Stat label="GMI" value={days >= 14 && stats.coverage >= 70 && stats.mean !== null ? `${gmi(stats.mean).toFixed(1)}%` : '—'} />
          <Stat label={t('المتوسط')} value={stats.mean !== null ? formatGlucose(stats.mean, unit) : '—'} />
          <Stat label={t('التغطية')} value={`${Math.round(stats.coverage)}%`} />
          <Stat label={t('منخفض')} value={`${Math.round(stats.pct_vlow + stats.pct_low)}%`} tone="text-over" />
          <p className="col-span-3 text-[11px] text-slate-400">{t('الأرقام للفترة كاملة')}{filter !== 'all' ? ' ' + t('(كل الأيام)') : ''}. {t('GMI يحتاج 14 يومًا و70% بيانات، وهو تقدير وليس HbA1c.')}</p>
        </Card>
      )}

      {/* deeper analyses, one level down */}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {([['meals', 'استجابة الوجبات', 'كيف يتغيّر السكر بعد كل وصفة'], ['compare', 'مقارنة فترتين', 'أسبوع بأسبوع، المدرسة والعطلة']] as const).map(([m, l, h]) => ( // i18n-ok
          <li key={m}><Link to={`/analysis?mode=${m}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2 active:bg-slate-50">
            <span className="min-w-0 flex-1"><span className="block font-bold">{t(l)}</span><span className="block truncate text-xs text-slate-500">{t(h)}</span></span>
            <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
          </Link></li>
        ))}
      </ul>
    </div>
  );
}

/** Observed pattern cards (GLUCOSE_PLAN 5.7, A8): the rule, n, the days behind it; dismissable for a week. Never advice. */
function PatternCards() {
  const { settings, history } = useData();
  const nav = useNavigate();
  const unit = settings.glucose_unit;
  const [cards, setCards] = useState<PatternCard[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('dismissed_patterns') ?? '{}'); } catch { return {}; } });
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  useEffect(() => {
    const now = Date.now();
    fetchSeries(now - 31 * 86400000, now + 60000)
      .then((series) => setCards(findPatterns({ series, history, now, low: rng.low!, high: rng.high!, reference: rng.reference })))
      .catch(() => setCards([]));
  }, [history, rng.low, rng.high, rng.reference]);
  const dismiss = (id: string) => {
    const next = { ...dismissed, [id]: Date.now() + DISMISS_MS };
    setDismissed(next); try { localStorage.setItem('dismissed_patterns', JSON.stringify(next)); } catch { /* private mode */ }
  };
  const shown = cards ? visible(cards, dismissed, Date.now()) : [];
  if (!shown.length) return null;
  const fill = (c: PatternCard) => c.facts.text.replace(/\{(\d)\}/g, (_, k) => `${formatGlucose(c.facts.mg![+k], unit)} ${unitLabel(unit)}`);
  return (
    <section className="space-y-2" aria-label={t('ملاحظات من بياناتها')}>
      <h2 className="px-1 font-bold">{t('ملاحظات من بياناتها')}</h2>
      {shown.map((c) => (
        <Card key={c.id} className="space-y-2 !py-3">
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-bold">{c.title}</h3>
            <Badge>{c.kind === 'overnight_drift' ? t('{a} من {b} ليالٍ', { a: c.days.length, b: c.n }) : `n = ${c.n}`}</Badge>
          </div>
          <p className="text-sm text-slate-600">{fill(c)}</p>
          {open === c.id && <p className="text-xs text-slate-500">{c.rule}</p>}
          <div className="flex flex-wrap gap-1.5">
            {c.days.slice(0, 6).map((d) => (
              <button key={d} onClick={() => nav(`/analysis?mode=day&day=${d}`)} className="min-h-[36px] rounded-full bg-slate-50 px-3 text-xs font-bold text-brand">{dayTitle(d).split(' ').slice(-2).join(' ')}</button>
            ))}
          </div>
          <div className="flex gap-4 text-xs font-bold text-slate-500">
            <button className="min-h-[36px]" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? t('إخفاء القاعدة') : t('كيف عرفنا؟')}</button>
            <button className="min-h-[36px]" onClick={() => dismiss(c.id)}>{t('إخفاء أسبوعًا')}</button>
          </div>
        </Card>
      ))}
      <p className="px-1 text-[11px] text-slate-400">{t('ملاحظات وصفية من القراءات، ليست نصيحة علاجية. ناقشوها مع الفريق الطبي.')}</p>
    </section>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div><div className={cx('num text-lg font-bold', tone ?? 'text-brand-num')}>{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>
);

export function ProfileChart({ bins, unit, range }: { bins: Bin[]; unit: 'mmol' | 'mgdl'; range: { low: number | null; high: number | null; reference: boolean } }) {
  const W = 340, PL = 4, PR = 28, PT = 8, PH = 190, H = PT + PH + 22;
  const top = Math.max(...bins.map((b) => b.p90)) > 280 ? 400 : 300, bottom = 40;
  const x = (bin: number) => PL + ((bin + 0.5) / 96) * (W - PL - PR);
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  const runs = useMemo(() => solidRuns(bins), [bins]);
  const area = (r: Bin[], lo: keyof Bin, hi: keyof Bin) =>
    `M${r.map((b) => `${x(b.bin).toFixed(1)},${y(b[hi] as number).toFixed(1)}`).join('L')}L${[...r].reverse().map((b) => `${x(b.bin).toFixed(1)},${y(b[lo] as number).toFixed(1)}`).join('L')}Z`;
  const line = (r: Bin[]) => `M${r.map((b) => `${x(b.bin).toFixed(1)},${y(b.p50).toFixed(1)}`).join('L')}`;
  const thin = bins.filter((b) => b.days < MIN_DAYS);
  const ticks = unit === 'mmol' ? [4, 10, 16].map((m) => m * 18.016) : [70, 180, 300];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('ملف السكر على مدار 24 ساعة')} direction="ltr">
      <rect x={PL} y={PT} width={W - PL - PR} height={PH} rx="8" fill="rgb(var(--surface-2))" />
      {range.low !== null && range.high !== null && (
        <rect x={PL} y={y(range.high)} width={W - PL - PR} height={y(range.low) - y(range.high)} fill="rgb(var(--st-in))" opacity={range.reference ? 0.08 : 0.13} />
      )}
      {ticks.filter((v) => v < top).map((v) => (
        <text key={v} x={W - 2} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{formatGlucose(v, unit).replace(/\.0$/, '')}</text>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <text key={h} x={PL + (h / 24) * (W - PL - PR)} y={H - 6} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{String(h).padStart(2, '0')}</text>
      ))}
      {runs.map((r, i) => <path key={'o' + i} d={area(r, 'p10', 'p90')} fill="rgb(var(--primary))" opacity="0.15" />)}
      {runs.map((r, i) => <path key={'i' + i} d={area(r, 'p25', 'p75')} fill="rgb(var(--primary))" opacity="0.32" />)}
      {thin.map((b) => <line key={b.bin} x1={x(b.bin) - 1.5} x2={x(b.bin) + 1.5} y1={y(b.p50)} y2={y(b.p50)} stroke="rgb(var(--text-3))" strokeWidth="2" strokeDasharray="2 2" />)}
      {runs.map((r, i) => r.length > 1
        ? <path key={'m' + i} d={line(r)} fill="none" stroke="rgb(var(--primary-strong))" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        : <circle key={'m' + i} cx={x(r[0].bin)} cy={y(r[0].p50)} r="2" fill="rgb(var(--primary-strong))" />)}
      <text x={PL + 4} y={PT + 12} fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui" direction={isEn() ? 'ltr' : 'rtl'} textAnchor={isEn() ? 'start' : 'end'}>{unitLabel(unit)}</text>
    </svg>
  );
}
