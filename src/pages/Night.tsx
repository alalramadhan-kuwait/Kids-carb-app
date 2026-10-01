import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { useAlerts } from '../hooks/useAlerts';
import { effectiveRange, formatGlucose, glucoseAge, glucoseStatus, unitLabel } from '../lib/glucose';
import { sinceText, statusSentence } from '../lib/now';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { AlertStrip } from '../components/AlertStrip';
import { cx } from '../components/ui';
import { t } from '../i18n';
import { trendFrom, libreOf } from '../engine/trend';
import { TrendArrow, TrendLine } from '../components/Trend';
import { arrowSource, shownLevel } from '../lib/arrowChoice';

/** Night view: readable at arm's length (96 px), dark, nothing else. Tap anywhere outside an alert to leave. */
export default function Night() {
  const nav = useNavigate();
  const { settings } = useData();
  const { g } = useGlucose();
  const alerts = useAlerts();
  const [, tick] = useState(0);
  useEffect(() => {
    const root = document.documentElement, prev = root.dataset.theme;
    root.dataset.theme = 'night';
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as any).wakeLock?.request('screen').then((l: any) => { lock = l; }).catch(() => {}); // keep the screen on where allowed
    const t = setInterval(() => tick((n) => n + 1), 20000);
    return () => { if (prev) root.dataset.theme = prev; else delete root.dataset.theme; lock?.release(); clearInterval(t); };
  }, []);
  const unit = settings.glucose_unit;
  const latest = g?.latest ?? null;
  const age = latest ? glucoseAge(latest.taken_at) : null;
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const status = latest ? glucoseStatus(latest.mg_dl, rng.low, rng.high) : null;
  const trend = g ? trendFrom(g.readings, Date.now()) : null;
  const sentence = statusSentence({ hasReading: !!latest, age: age?.state ?? null, status, trend: (() => { const l = shownLevel(trend, latest?.trend ?? null, arrowSource()).level; return l === null ? null : libreOf(l); })() });
  const tone = status === 'low' || status === 'urgent_low' ? 'text-over' : status === 'high' || status === 'very_high' ? 'text-near' : 'text-brand-num';
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-[rgb(var(--bg))] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]" onClick={() => nav(-1)}>
      <div onClick={(e) => e.stopPropagation()}><AlertStrip alerts={alerts.open} onChange={alerts.reload} /></div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="text-xl font-bold text-slate-600">{g ? sentence.text : '…'}</div>
        {latest && age?.state !== 'stale' ? (
          <div className={cx('flex items-center gap-3', age?.state === 'old' && 'opacity-50')}>
            <span className={cx('num text-[96px] font-bold leading-none', tone)}>{formatGlucose(latest.mg_dl, unit)}</span>
            <span className={tone}><TrendArrow trend={trend} libre={latest.trend} size={56} /></span>
          </div>
        ) : <div className="text-2xl font-bold text-near">{t('لا توجد قراءة حديثة')}</div>}
        <div className="text-lg text-slate-500">{unitLabel(unit)}{latest ? ` · ${sinceText(latest.taken_at)}` : ''}</div>
        {latest && age?.state === 'fresh' && <TrendLine trend={trend} libre={latest.trend} unit={unit} className="text-lg text-slate-500" />}
      </div>
      <p className="text-center text-sm text-slate-500">{t('اضغط للخروج')}</p>
    </div>
  );
}
