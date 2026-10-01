import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatGlucose, glucoseAge, glucoseStatus, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { sinceText } from '../lib/now';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { Card, cx } from '../components/ui';

interface View {
  error?: string; scope: 'school' | 'viewer'; label: string; expires_at: string; child: string; unit: GlucoseUnit;
  low: number; high: number; reference: boolean; readings: { t: string; v: number; trend: number | null }[];
  care_plan: { hypo: string | null; hyper: string | null; contacts: string | null } | null;
}

/** What a share-link holder sees, without signing in: the reading, its age, and (school) the care plan. Read only. */
export default function Shared({ token }: { token: string }) {
  const [v, setV] = useState<View | null>(null);
  const load = () => supabase.rpc('share_view', { p_token: token }).then(({ data, error }) => setV(error ? ({ error: 'invalid' } as View) : (data as View)));
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [token]);
  if (!v) return <main className="grid min-h-screen place-items-center text-slate-500">…</main>;
  if (v.error) return <main className="grid min-h-screen place-items-center p-6 text-center"><Card><p className="font-bold">الرابط غير صالح أو انتهى</p><p className="mt-1 text-sm text-slate-500">اطلب رابطًا جديدًا من الأهل.</p></Card></main>;
  const last = v.readings[v.readings.length - 1];
  const age = last ? glucoseAge(last.t) : null;
  const status = last ? glucoseStatus(last.v, v.low, v.high) : null;
  const tone = status === 'low' || status === 'urgent_low' ? 'text-over' : status === 'high' || status === 'very_high' ? 'text-near' : 'text-brand-num';
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 pb-10 pt-[max(16px,env(safe-area-inset-top))]">
      <h1 className="text-2xl font-bold">{v.child}</h1>
      <Card className="text-center">
        {last && age?.state !== 'stale' ? (
          <div className={cx('flex items-center justify-center gap-3', age?.state === 'old' && 'opacity-50')}>
            <span className={cx('num text-[72px] font-bold leading-none', tone)}>{formatGlucose(last.v, v.unit)}</span>
            {last.trend && <span className={tone}><Icon name={TREND_ICON[last.trend]} size={44} label={TREND_WORDS[last.trend]} /></span>}
          </div>
        ) : <p className="py-4 text-xl font-bold text-near">لا توجد قراءة حديثة</p>}
        <p className="mt-2 text-slate-500">{unitLabel(v.unit)}{last ? ` · ${sinceText(last.t)}` : ''}</p>
        {status && status !== 'in_range' && <p className={cx('mt-1 font-bold', tone)}>{status === 'low' || status === 'urgent_low' ? 'منخفض' : 'مرتفع'}</p>}
      </Card>
      {v.care_plan && (
        <>
          {v.care_plan.hypo && <Card><h2 className="mb-1 font-bold">عند الانخفاض</h2><p className="whitespace-pre-wrap leading-relaxed">{v.care_plan.hypo}</p></Card>}
          {v.care_plan.hyper && <Card><h2 className="mb-1 font-bold">عند الارتفاع</h2><p className="whitespace-pre-wrap leading-relaxed">{v.care_plan.hyper}</p></Card>}
          {v.care_plan.contacts && <Card><h2 className="mb-1 font-bold">أرقام التواصل</h2><p className="whitespace-pre-wrap">{v.care_plan.contacts}</p></Card>}
        </>
      )}
      <p className="px-1 text-xs text-slate-400">للعرض فقط وقد تتأخر عن الجهاز. يتحدّث كل دقيقة. {v.label} · ينتهي {new Date(v.expires_at).toLocaleDateString('ar-KW-u-nu-latn', { timeZone: 'Asia/Kuwait' })}</p>
    </main>
  );
}
