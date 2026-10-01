import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callGlucose } from '../lib/api';
import { formatGlucose, glucoseAge, glucoseLevel, GLUCOSE_ERRORS, unitLabel, type GlucoseState, type Reading } from '../lib/glucose';
import { useData } from '../lib/data';
import { Card, cx } from './ui';
import { Icon, TREND_ICON, TREND_WORDS } from './Icon';

const TONE = { none: 'text-slate-800', in: 'text-ok', low: 'text-over', high: 'text-near' } as const;

function Spark({ readings, low, high }: { readings: Reading[]; low: number | null; high: number | null }) {
  if (readings.length < 2) return null;
  const W = 300, H = 70, t0 = new Date(readings[0].taken_at).getTime(), t1 = new Date(readings[readings.length - 1].taken_at).getTime();
  const vals = readings.map((r) => r.mg_dl).concat(low ? [low] : [], high ? [high] : []);
  const lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
  const x = (t: number) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const pts = readings.map((r) => `${x(new Date(r.taken_at).getTime()).toFixed(1)},${y(r.mg_dl).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-16 w-full" role="img" aria-label="آخر 3 ساعات">
      {low !== null && <line x1="0" x2={W} y1={y(low)} y2={y(low)} stroke="#c0392b" strokeDasharray="4 4" strokeWidth="1" opacity=".5" />}
      {high !== null && <line x1="0" x2={W} y1={y(high)} y2={y(high)} stroke="#b7791f" strokeDasharray="4 4" strokeWidth="1" opacity=".5" />}
      <polyline points={pts} fill="none" stroke="#2f6f8f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Live glucose, display only. Polls while the app is open; the server throttles how often Abbott is asked. */
export default function GlucoseCard() {
  const { settings } = useData();
  const [g, setG] = useState<GlucoseState | null>(null);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try { setG(await callGlucose({ action: 'read' })); setFailed(false); } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const age = window.setInterval(() => tick((n) => n + 1), 30_000); // keep "3 minutes ago" honest between polls
    const vis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(poll); window.clearInterval(age); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  if (!g && !failed) return null;
  if (g && !g.connected) {
    return <Link to="/cgm"><Card className="mb-4 flex items-center gap-3 !p-3"><span className="text-2xl">🩸</span><span className="flex-1 font-medium">اربط قراءات السكر الحية (LibreLinkUp)</span><span className="text-slate-300">‹</span></Card></Link>;
  }
  if (!g) return <Card className="mb-4"><p className="text-sm text-slate-500">تعذّر تحميل قراءة السكر. <button className="text-brand underline" onClick={load}>إعادة المحاولة</button></p></Card>;

  const unit = settings.glucose_unit;
  const latest = g.latest;
  const age = latest ? glucoseAge(latest.taken_at) : null;
  const level = latest ? glucoseLevel(latest.mg_dl, settings.glucose_low_mgdl, settings.glucose_high_mgdl) : 'none';
  const err = g.error ? GLUCOSE_ERRORS[g.error] ?? g.error : null;

  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">السكر الآن</div>
          {latest && age?.state !== 'stale' ? (
            <div className={cx('flex items-baseline gap-2', age?.state === 'old' ? 'opacity-60' : TONE[level])}>
              <span className="num text-5xl font-bold">{formatGlucose(latest.mg_dl, unit)}</span>
              {latest.trend && <span className="flex items-center gap-1 self-center"><Icon name={TREND_ICON[latest.trend]} size={30} label={TREND_WORDS[latest.trend]} /><span className="text-sm font-medium">{TREND_WORDS[latest.trend]}</span></span>}
              <span className="text-sm font-medium text-slate-500">{unitLabel(unit)}</span>
            </div>
          ) : (
            <div className="text-3xl font-bold text-slate-400">— <span className="text-base font-medium">لا قراءة حديثة</span></div>
          )}
        </div>
        {age && <div className={cx('text-sm', age.state === 'fresh' ? 'text-slate-500' : 'font-bold text-near')}>
          {age.minutes < 1 ? 'الآن' : age.minutes < 60 ? <>قبل <span className="num">{age.minutes}</span> د</> : <>قبل <span className="num">{Math.floor(age.minutes / 60)}</span> س</>}
        </div>}
      </div>
      {age?.state === 'stale' && latest && <p className="mt-1 text-sm text-near">آخر قراءة كانت <span className="num font-bold">{formatGlucose(latest.mg_dl, unit)}</span> قبل مدة. لا تعتمد عليها، تحقق من الجهاز.</p>}
      {age?.state === 'old' && <p className="mt-1 text-sm text-near">القراءة ليست حديثة.</p>}
      <Spark readings={g.readings} low={settings.glucose_low_mgdl} high={settings.glucose_high_mgdl} />
      {err && <p className="mt-2 text-sm text-over">{err}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">للعرض فقط وقد تتأخر عن الجهاز. القرارات والإنذارات من Libre أو Gluroo، وليس من هذا التطبيق.</p>
    </Card>
  );
}
