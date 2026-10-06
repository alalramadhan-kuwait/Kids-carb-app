import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatGlucose, glucoseAge, glucoseStatus, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { sinceText } from '../lib/now';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { Card, cx } from '../components/ui';
import { locale, t, tMaybe } from '../i18n';
import { LangSwitch } from '../components/LangSwitch';
import { BigGraph } from './mom/MomHome';

interface View {
  error?: string; scope: 'school' | 'viewer'; label: string; expires_at: string; child: string; unit: GlucoseUnit;
  low: number; high: number; alarm_high?: number | null; reference: boolean; readings: { t: string; v: number; trend: number | null }[];
  care_plan: { hypo: string | null; hyper: string | null; contacts: string | null } | null;
}

/** What a share-link holder sees, without signing in: the reading, its age, and (school) the care plan. Read only. */
export default function Shared({ token }: { token: string }) {
  const [v, setV] = useState<View | null>(null);
  const load = () => supabase.rpc('share_view', { p_token: token }).then(({ data, error }) => setV(error ? ({ error: 'invalid' } as View) : (data as View)));
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [token]);
  if (!v) return <main className="grid min-h-screen place-items-center text-slate-500">…</main>;
  if (v.error) return <main className="grid min-h-screen place-items-center p-6 text-center"><Card><p className="font-bold">{t('الرابط غير صالح أو انتهى')}</p><p className="mt-1 text-sm text-slate-500">{t('اطلب رابطًا جديدًا من الأهل.')}</p></Card></main>;
  const last = v.readings[v.readings.length - 1];
  const age = last ? glucoseAge(last.t) : null;
  const status = last ? glucoseStatus(last.v, v.low, v.high) : null;
  const tone = status === 'low' || status === 'urgent_low' ? 'text-over' : status === 'high' || status === 'very_high' ? 'text-near' : 'text-brand-num';
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 pb-10 pt-[max(16px,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3"><h1 className="flex-1 text-2xl font-bold">{tMaybe(v.child)}</h1><LangSwitch className="w-48" /></div>
      <Card className="text-center">
        {last && age?.state !== 'stale' ? (
          <div className={cx('flex items-center justify-center gap-3', age?.state === 'old' && 'opacity-50')}>
            <span className={cx('num text-[72px] font-bold leading-none', tone)}>{formatGlucose(last.v, v.unit)}</span>
            {last.trend && <span className={tone}><Icon name={TREND_ICON[last.trend]} size={44} label={TREND_WORDS[last.trend]} /></span>}
          </div>
        ) : <p className="py-4 text-xl font-bold text-near">{t('لا توجد قراءة حديثة')}</p>}
        <p className="mt-2 text-slate-500">{unitLabel(v.unit)}{last ? ` · ${sinceText(last.t)}` : ''}</p>
        {status && status !== 'in_range' && <p className={cx('mt-1 font-bold', tone)}>{status === 'low' || status === 'urgent_low' ? t('منخفض') : t('مرتفع')}</p>}
      </Card>
      {/* the last 12 hours, like her home screen; touch to read a point */}
      {v.readings.length > 1 && (
        <Card className="!px-1 !py-2">
          <BigGraph aspect={0.8} s={{ t: Float64Array.from(v.readings.map((r) => Date.parse(r.t))), v: Float64Array.from(v.readings.map((r) => r.v)) }}
            now={Date.now()} unit={v.unit} low={v.low} high={v.high} band={[v.low, v.high]} alarmHigh={v.alarm_high ?? 240}
            shots={[]} meals={[]} treats={[]} pricks={[]}
            span={Math.min(12, Math.max(3, Math.ceil((Date.now() - Date.parse(v.readings[0].t)) / 3600000)))} />
        </Card>
      )}
      {v.care_plan && (
        <>
          {v.care_plan.hypo && <Card><h2 className="mb-1 font-bold">{t('عند الانخفاض')}</h2><p className="whitespace-pre-wrap leading-relaxed">{v.care_plan.hypo}</p></Card>}
          {v.care_plan.hyper && <Card><h2 className="mb-1 font-bold">{t('عند الارتفاع')}</h2><p className="whitespace-pre-wrap leading-relaxed">{v.care_plan.hyper}</p></Card>}
          {v.care_plan.contacts && <Card><h2 className="mb-1 font-bold">{t('أرقام التواصل')}</h2><p className="whitespace-pre-wrap">{v.care_plan.contacts}</p></Card>}
        </>
      )}
      <p className="px-1 text-xs text-slate-400">{t('للعرض فقط وقد تتأخر عن الجهاز. يتحدّث كل دقيقة.')} {v.label} · {t('ينتهي {date}', { date: new Date(v.expires_at).toLocaleDateString(locale(), { timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions) })}</p>
    </main>
  );
}
