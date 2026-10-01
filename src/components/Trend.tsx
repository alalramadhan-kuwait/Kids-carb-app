import { Icon } from './Icon';
import type { IconName } from '../icons/defs';
import { levelFromLibre, type Level, type Trend } from '../engine/trend';
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

/** The arrow: ours when there is enough data, else Abbott's. Very fast change shows two arrows. */
export function TrendArrow({ trend, libre, size }: { trend: Trend | null; libre: number | null; size: number }) {
  const level = trend?.level ?? levelFromLibre(libre);
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

/** "Rising slowly · +0.4 in 15 min · ≈ 7.2 at 1:15", and Abbott's arrow when it says something else. */
export function TrendLine({ trend, libre, unit, className }: { trend: Trend | null; libre: number | null; unit: GlucoseUnit; className?: string }) {
  if (!trend) return null;
  const sign = trend.change15 >= 0 ? '+' : '−';
  const lib = levelFromLibre(libre);
  const differs = lib !== null && Math.max(-2, Math.min(2, trend.level)) !== lib;
  return (
    <p className={className}>
      <span className="font-medium">{LEVEL_WORDS[trend.level]}</span>
      {' · '}<span className="num">{sign}{formatGlucose(Math.abs(trend.change15), unit)}</span> {t('خلال 15 د')}
      {trend.projected30 !== null && <>{' · '}{t('≈ {v} عند {time}', { v: formatGlucose(trend.projected30, unit), time: clock(trend.at + 30 * 60000) })}</>}
      {differs && <span className="text-slate-400">{' · '}{t('Libre: {a}', { a: ARROW[lib!] })}</span>}
    </p>
  );
}
