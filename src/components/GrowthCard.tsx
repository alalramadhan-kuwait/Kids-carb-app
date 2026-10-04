import { Link } from 'react-router-dom';
import { useGrowthNutrition, weighInDue } from '../lib/growth';
import { macroLevel, type Level } from '../engine/nutrition';
import type { GrowthReason } from '../engine/growth';
import { BALANCE_ISSUE, GROWTH_REASON_SHORT } from './growthText';
import { cx } from './ui';
import { isEn, t, tr } from '../i18n';

const SHORT = tr({ carbs: 'كارب', protein: 'بروتين', fat: 'دهون' }); // i18n-ok: values translated when read

type Tone = 'ok' | 'watch' | 'act' | 'none';
const TEXT: Record<Tone, string> = { ok: 'text-ok', watch: 'text-near', act: 'text-over', none: 'text-slate-500' };
const DOT: Record<Tone, string> = { ok: 'bg-ok-fill', watch: 'bg-near-fill', act: 'bg-over-fill', none: 'bg-slate-300' };
/** Red: a loss or a WHO thinness cut-off; amber: the rest (incl. a likely entry error). */
const RED: GrowthReason[] = ['bmi_thinness', 'weight_down', 'bmi_z_drop', 'height_z_drop'];
const MARK: Record<Level, string> = { ok: '✓', low: '↓', slightly_low: '↓', slightly_high: '↑', high: '↑', unknown: '–' };
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');

/**
 * On Now, in two seconds: is her growth okay, is she eating enough, is anything worth a look. Three lines over the
 * last 3 days, green / amber / red; the details are one tap away.
 */
export function GrowthCard() {
  const g = useGrowthNutrition();
  if (!g.ready) return null;
  const a = g.avg.d3, st = g.energy.d3, r = g.energyRef;

  // growth
  const gr = g.growth;
  const gTone: Tone = gr.state === 'no_data' ? 'none' : gr.reasons.length ? (gr.reasons.some((x) => RED.includes(x)) ? 'act' : 'watch') : 'ok';
  const gWord = gr.state === 'no_data' ? t('أضف الوزن والطول') : gr.reasons.length ? GROWTH_REASON_SHORT[gr.reasons[0]] : t('ضمن المسار');

  // energy: the verdict follows the estimated RANGE; how far from the estimate itself is shown as a number
  const kcal = a.totalKcal, diff = r && kcal !== null ? Math.round(((kcal - r.kcal) / r.kcal) * 100) : null;
  const eTone: Tone = st === 'within' ? 'ok' : st === 'above' ? 'watch' : st === 'below' ? (r && kcal !== null && kcal < r.low * 0.9 ? 'act' : 'watch') : 'none';
  const eWord = st === 'within' ? t('ضمن المدى') : st === 'above' ? t('فوق المدى') : st === 'below' ? t('أقل من المدى') : t('أيام غير كافية');

  // nutrition: carbs / protein / fat in a mark each; one balance issue if any; missing data only as a quiet note
  const macros = (['carbs', 'protein', 'fat'] as const).map((n) => ({ n, l: macroLevel(n, a, g.refs, g.coverageMin) }));
  const known = macros.filter((m) => m.l !== 'unknown');
  const issue = g.bal.d3.issues[0];
  const nTone: Tone = !known.length ? 'none' : issue || known.some((m) => m.l !== 'ok') ? 'watch' : 'ok';
  const missing = a.enough && Object.values(g.bal.d3.states).some((s) => s === 'insufficient');

  const due = g.measurements.length > 0 && weighInDue(g.measurements);
  return (
    <Link to="/growth" className="block rounded-2xl border border-slate-100 bg-white px-3 py-2.5 active:bg-slate-50">
      <span className="flex items-center justify-between text-sm">
        <span><b className="text-slate-700">{t('النمو والتغذية')}</b> <span className="text-xs text-slate-500">· {t('متوسط 3 أيام')}</span></span>
        <span className="flex items-center gap-2 text-xs text-slate-500">{due && t('موعد الوزن')}<span className="opacity-60">{isEn() ? '›' : '‹'}</span></span>
      </span>
      <span className="mt-1.5 block space-y-1 text-sm">
        <Row label={t('النمو')} tone={gTone}>{gTone === 'ok' ? '✓ ' : ''}{gWord}</Row>
        <Row label={t('الطاقة')} tone={eTone} sub={kcal !== null && a.enough ? <><bdi dir="ltr" className="tabular-nums">{n0(kcal)}</bdi> {t('سعرة/يوم')}{diff !== null && <> · <bdi dir="ltr" className="tabular-nums">{diff > 0 ? '+' : diff < 0 ? '−' : ''}{Math.abs(diff)}%</bdi> {t('عن التقدير')}</>}</> : null}>
          {eTone === 'ok' ? '✓ ' : ''}{eWord}
        </Row>
        <Row label={t('التغذية')} tone={nTone}>
          {known.length ? macros.map((m, i) => <span key={m.n}>{i > 0 && <span className="text-slate-300"> · </span>}<span className="font-normal text-slate-700">{SHORT[m.n]}</span> <b className={m.l === 'ok' ? 'text-ok' : m.l === 'unknown' ? 'text-slate-400' : 'text-near'}>{MARK[m.l]}</b></span>) : t('أيام غير كافية')}
        </Row>
      </span>
      {(issue || missing) && (
        <span className={cx('mt-1 block text-xs', issue ? 'text-near' : 'text-slate-500')}>
          {issue ? BALANCE_ISSUE[issue] : t('بعض بيانات المغذيات ناقصة')} {isEn() ? '›' : '‹'}
        </span>
      )}
    </Link>
  );
}

function Row({ label, tone, sub, children }: { label: string; tone: Tone; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={cx('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', DOT[tone])} aria-hidden />
      <span className="w-16 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0">
        <b className={cx('font-semibold', TEXT[tone])}>{children}</b>
        {sub && <span className="text-xs text-slate-500"> · {sub}</span>}
      </span>
    </span>
  );
}
