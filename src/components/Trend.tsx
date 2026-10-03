import { Icon } from './Icon';
import type { IconName } from '../icons/defs';
import type { Level, Trend } from '../engine/trend';
import { shownLevel, useArrowChoice } from '../lib/arrowChoice';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { locale, t, tr } from '../i18n';

const ICON: Record<Level, IconName> = {
  [-3]: 'trend_falling_fast', [-2]: 'trend_falling_fast', [-1]: 'trend_falling', 0: 'trend_stable', 1: 'trend_rising', 2: 'trend_rising_fast', 3: 'trend_rising_fast',
};
export const LEVEL_WORDS: Record<Level, string> = tr({ // i18n-ok: values translated when read
  [-3]: 'ينزل بسرعة كبيرة', [-2]: 'ينزل بسرعة', [-1]: 'ينزل ببطء', 0: 'ثابت', 1: 'يصعد ببطء', 2: 'يصعد بسرعة', 3: 'يصعد بسرعة كبيرة', // i18n-ok
});
const ARROW: Record<Level, string> = { [-3]: '⇊', [-2]: '↓', [-1]: '↘', 0: '→', 1: '↗', 2: '↑', 3: '⇈' };
const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);

/** The arrow from whichever source is winning the accuracy comparison (Libre's until the app's is clearly better). */
export function TrendArrow({ trend, libre, size }: { trend: Trend | null; libre: number | null; size: number }) {
  const { source } = useArrowChoice();
  const { level } = shownLevel(trend, libre, source);
  return level === null ? null : <LevelArrow level={level} size={size} />;
}

export function LevelArrow({ level, size }: { level: Level; size: number }) {
  const icon = <Icon name={ICON[level]} size={size} />;
  return (
    <span role="img" aria-label={LEVEL_WORDS[level]} className="inline-flex items-center">
      {icon}{Math.abs(level) === 3 && <span style={{ marginInlineStart: -size * 0.45 }}>{icon}</span>}
    </span>
  );
}

/** "Falling slowly · −0.8 in 15 min · ≈ 5.6 at 1:15", and the other arrow when it says something else. */
/** `compact`: without the direction word and the other source's arrow (the Now card already says both). */
export function TrendLine({ trend, libre, unit, className, compact }: { trend: Trend | null; libre: number | null; unit: GlucoseUnit; className?: string; compact?: boolean }) {
  const { source } = useArrowChoice();
  const s = shownLevel(trend, libre, source);
  if (s.level === null) return null;
  const sign = trend && trend.change15 >= 0 ? '+' : '−';
  return (
    <p className={className}>
      {!compact && <span className="font-medium">{LEVEL_WORDS[s.level]}</span>}
      {trend && <>{compact ? '' : ' · '}<span className="num">{sign}{formatGlucose(Math.abs(trend.change15), unit)}</span> {t('خلال 15 د')}</>}
      {trend?.projected30 != null && <>{' · '}{t('≈ {v} عند {time}', { v: formatGlucose(trend.projected30, unit), time: clock(trend.at + 30 * 60000) })}</>}
      {!compact && s.other && <span className="text-slate-400">{' · '}{s.other.from === 'libre' ? t('Libre: {a}', { a: ARROW[s.other.level] }) : t('التطبيق: {a}', { a: ARROW[s.other.level] })}</span>}
    </p>
  );
}
