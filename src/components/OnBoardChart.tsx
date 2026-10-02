import { useState } from 'react';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { cx } from './ui';
import { isEn, t } from '../i18n';

/**
 * The glucose now, what the carbs still absorbing add, what the rapid insulin still working takes away, and
 * where that leaves it (a waterfall). The parents' range is shaded behind. Every bar carries its own label and
 * signed value, so colour is never the only cue. Tap a bar for its numbers.
 */
export function OnBoardChart({ now, up, down, est, low, high, unit, estBy }: {
  now: number; up: number; down: number; est: number; low: number; high: number; unit: GlucoseUnit; estBy: string;
}) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 320, H = 190, top = 26, base = 150, padX = 8;
  const max = Math.max(now, now + up, est, high, 180) * 1.12;
  const y = (mg: number) => base - (Math.max(0, Math.min(mg, max)) / max) * (base - top);
  const g = (mg: number) => formatGlucose(mg, unit);
  const signed = (mg: number) => (mg >= 0 ? '+' : '−') + g(Math.abs(mg));
  const afterUp = now + up;
  const estTone = est < low ? 'over' : est > high ? 'near' : 'ok';
  type Bar = { key: string; label: string; sub?: string; from: number; to: number; text: string; cls: string; textCls: string; note: string };
  let bars: Bar[] = [
    { key: 'now', label: t('الآن'), from: 0, to: now, text: g(now), cls: 'fill-brand-light', textCls: 'fill-slate-900', note: t('السكر الآن {v}', { v: g(now) }) },
    { key: 'up', label: t('الكارب'), from: now, to: afterUp, text: signed(up), cls: 'fill-kcarb', textCls: 'fill-kcarb', note: t('الكارب الذي ما زال يُمتص يرفعه {v}', { v: signed(up) }) },
    { key: 'down', label: t('الإنسولين'), from: afterUp, to: est, text: signed(-down), cls: 'fill-kins', textCls: 'fill-kins', note: t('الإنسولين الذي ما زال يعمل ينزله {v}', { v: signed(-down) }) },
    { key: 'est', label: t('بعدها'), sub: estBy, from: 0, to: est, text: '≈' + g(est), cls: estTone === 'ok' ? 'fill-ok-fill' : estTone === 'over' ? 'fill-over-fill' : 'fill-near-fill', textCls: 'fill-slate-900', note: t('تقدير تقريبي بعد انتهائها {v}', { v: g(est) }) },
  ];
  if (!isEn()) bars = [...bars].reverse(); // read right to left in Arabic
  const col = (W - padX * 2) / bars.length, bw = 40;
  const cx0 = (i: number) => padX + col * i + col / 2;
  const tops = bars.map((b) => Math.max(b.from, b.to));

  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={bars.map((b) => b.note).join('. ')}>
        {/* the parents' range */}
        <rect x={0} y={y(high)} width={W} height={y(low) - y(high)} className="fill-ok-soft" />
        <line x1={0} x2={W} y1={y(low)} y2={y(low)} className="stroke-ok-fill" strokeWidth={1} strokeDasharray="3 3" />
        <line x1={0} x2={W} y1={y(high)} y2={y(high)} className="stroke-ok-fill" strokeWidth={1} strokeDasharray="3 3" />
        <line x1={0} x2={W} y1={base} y2={base} className="stroke-slate-200" strokeWidth={1} />
        {/* connectors between the steps */}
        {bars.slice(0, -1).map((b, i) => {
          const level = isEn() ? b.to : bars[i + 1].to; // the end of a step is where the next one starts
          return <line key={'c' + i} x1={cx0(i) + bw / 2} x2={cx0(i + 1) - bw / 2} y1={y(level)} y2={y(level)} className="stroke-slate-300" strokeWidth={1} strokeDasharray="2 2" />;
        })}
        {bars.map((b, i) => {
          const y1 = y(Math.max(b.from, b.to)), y2 = y(Math.min(b.from, b.to));
          const h = Math.max(3, y2 - y1);
          return (
            <g key={b.key} onClick={() => setPick(pick === i ? null : i)} className="cursor-pointer">
              <rect x={cx0(i) - col / 2} y={top - 20} width={col} height={H - top + 20} fill="transparent" />
              <rect x={cx0(i) - bw / 2} y={y1} width={bw} height={h} rx={4} className={cx(b.cls, pick !== null && pick !== i && 'opacity-40')} />
              <text x={cx0(i)} y={y(tops[i]) - 6} textAnchor="middle" className={cx('num text-[13px] font-bold', b.textCls)} direction="ltr">{b.text}</text>
              <text x={cx0(i)} y={base + 16} textAnchor="middle" className="fill-slate-600 text-[11px] font-medium">{b.label}</text>
              {b.sub && <text x={cx0(i)} y={base + 30} textAnchor="middle" className="fill-slate-500 text-[10px]">{b.sub}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="min-h-[1.25rem] text-center text-xs text-slate-600">{pick !== null ? bars[pick].note : t('المنطقة الخضراء: النطاق · اضغطوا عمودًا للتفاصيل')}</figcaption>
    </figure>
  );
}
