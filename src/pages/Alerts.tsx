import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push';
import { formatGlucose, toMgdl, unitLabel } from '../lib/glucose';
import { sinceText } from '../lib/now';
import type { AlertRow, Settings } from '../lib/types';
import { ALERT_NAME } from '../components/AlertStrip';
import { Icon } from '../components/Icon';
import { Alert, Btn, Card, Field, NumInput, Page, toast } from '../components/ui';

type Sub = { id: string; user_id: string; device_label: string | null; last_ok_at: string | null; last_error: string | null; endpoint: string };
const KEYS = ['alert_urgent_low_mgdl', 'alert_low_mgdl', 'alert_high_mgdl', 'alert_low_delay_min', 'alert_high_delay_min', 'alert_nodata_min', 'alert_renotify_min'] as const;

export default function AlertsPage() {
  const nav = useNavigate();
  const { settings, reload, nameOf } = useData();
  const [ps, setPs] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState<Settings>(settings);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [past, setPast] = useState<AlertRow[]>([]);
  useEffect(() => setS(settings), [settings]);
  const loadLists = async () => {
    const [a, b] = await Promise.all([
      supabase.from('push_subscriptions').select('id,user_id,device_label,last_ok_at,last_error,endpoint').order('created_at'),
      supabase.from('alerts').select('*').neq('state', 'pending').order('started_at', { ascending: false }).limit(15),
    ]);
    setSubs((a.data ?? []) as Sub[]); setPast((b.data ?? []) as AlertRow[]);
  };
  useEffect(() => { pushState().then(setPs); loadLists(); }, []);

  const unit = s.glucose_unit;
  const g = (k: 'alert_urgent_low_mgdl' | 'alert_low_mgdl' | 'alert_high_mgdl') => (s[k] === null ? null : Number(formatGlucose(s[k]!, unit)));
  const setG = (k: 'alert_urgent_low_mgdl' | 'alert_low_mgdl' | 'alert_high_mgdl') => (v: number | null) => setS({ ...s, [k]: v === null ? null : toMgdl(v, unit) });
  const u = s.alert_urgent_low_mgdl, l = s.alert_low_mgdl, h = s.alert_high_mgdl;
  const problem =
    u !== null && (u < 40 || u > 100) ? 'المنخفض جدًا خارج المعقول' :
    l !== null && (l < 50 || l > 150) ? 'المنخفض خارج المعقول' :
    h !== null && (h < 120 || h > 450) ? 'المرتفع خارج المعقول' :
    u !== null && l !== null && u >= l ? 'المنخفض جدًا يجب أن يكون أقل من المنخفض' :
    l !== null && h !== null && l >= h ? 'المنخفض يجب أن يكون أقل من المرتفع' : '';

  const save = async () => {
    const patch = Object.fromEntries(KEYS.map((k) => [k, s[k]]));
    const { error } = await supabase.from('settings').update(patch).eq('id', true);
    if (error) return toast(error.message);
    await reload(); toast('تم الحفظ ✓');
  };
  const turnOn = async () => {
    setBusy(true);
    try { setPs(await enablePush()); loadLists(); } catch (e) { toast('تعذّر التفعيل: ' + (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title="التنبيهات" back={() => nav(-1)}>
      <div className="space-y-3">
        <Card className="space-y-3">
          <h2 className="font-bold">على هذا الجوال</h2>
          {ps === 'needs_install' && <Alert tone="info">في الآيفون تعمل التنبيهات من أيقونة التطبيق فقط: زر المشاركة ← <b>إضافة إلى الشاشة الرئيسية</b>، ثم افتحه من الأيقونة وارجع هنا.</Alert>}
          {ps === 'unsupported' && <Alert tone="near">هذا المتصفح لا يدعم التنبيهات.</Alert>}
          {ps === 'denied' && <Alert tone="near">التنبيهات مرفوضة. فعّلها من إعدادات الجوال ← الإشعارات ← ليان.</Alert>}
          {ps === 'off' && <Btn kind="primary" block className="min-h-[52px]" disabled={busy} onClick={turnOn}>فعّل التنبيهات</Btn>}
          {ps === 'on' && (
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={async () => { const r = await testPush(); toast(r.ok ? 'أُرسل ✓ — انتظر الإشعار' : 'لم يصل. جرّب إيقاف وتفعيل'); loadLists(); }}>أرسل تجربة</Btn>
              <Btn kind="ghost" onClick={async () => { await disablePush(); setPs(await pushState()); loadLists(); }}>إيقاف</Btn>
            </div>
          )}
          <p className="text-xs text-slate-500">تنبيهات مساعدة. تطبيق Libre يبقى المنبّه الأساسي، وقد لا يصل الإشعار إذا كان الجوال صامتًا أو في وضع التركيز.</p>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">الحدود <span className="text-sm font-normal text-slate-500">({unitLabel(unit)})</span></h2>
          <p className="text-sm text-slate-600">من الطبيب. اتركه فارغًا لإيقاف ذلك التنبيه.</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="منخفض جدًا"><NumInput value={g('alert_urgent_low_mgdl')} onChange={setG('alert_urgent_low_mgdl')} /></Field>
            <Field label="منخفض"><NumInput value={g('alert_low_mgdl')} onChange={setG('alert_low_mgdl')} /></Field>
            <Field label="مرتفع"><NumInput value={g('alert_high_mgdl')} onChange={setG('alert_high_mgdl')} /></Field>
          </div>
          <h3 className="pt-1 text-sm font-bold text-slate-600">بالدقائق</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="انتظار المنخفض"><NumInput value={s.alert_low_delay_min} onChange={(v) => setS({ ...s, alert_low_delay_min: v ?? 5 })} /></Field>
            <Field label="انتظار المرتفع"><NumInput value={s.alert_high_delay_min} onChange={(v) => setS({ ...s, alert_high_delay_min: v ?? 30 })} /></Field>
            <Field label="بدون قراءة بعد"><NumInput value={s.alert_nodata_min} onChange={(v) => setS({ ...s, alert_nodata_min: v ?? 20 })} /></Field>
            <Field label="تكرار كل"><NumInput value={s.alert_renotify_min} onChange={(v) => setS({ ...s, alert_renotify_min: v ?? 10 })} /></Field>
          </div>
          {problem && <Alert tone="near">{problem}</Alert>}
          <Btn kind="primary" block disabled={!!problem} onClick={save}>حفظ</Btn>
        </Card>

        <Link to="/care-plan"><Card className="flex items-center gap-3 !p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="heart" size={22} /></span><div className="flex-1 font-bold">خطة الطبيب</div><span className="text-slate-300">‹</span></Card></Link>

        <Card>
          <h2 className="mb-2 font-bold">الأجهزة</h2>
          {subs.length === 0 ? <p className="text-sm text-slate-500">لا يوجد جهاز مفعّل بعد.</p> : (
            <ul className="space-y-1.5 text-sm">
              {subs.map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className={x.last_error ? 'text-over' : 'text-ok'}>{x.last_error ? '!' : '✓'}</span>
                  <span className="flex-1"><b>{nameOf(x.user_id)}</b> · {x.device_label ?? 'جهاز'}</span>
                  <span className="text-xs text-slate-400">{x.last_ok_at ? `وصل ${sinceText(x.last_ok_at)}` : x.last_error ? 'لم يصل' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card>
            <h2 className="mb-2 font-bold">آخر التنبيهات</h2>
            <ul className="space-y-1.5 text-sm">
              {past.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="flex-1">{ALERT_NAME[a.kind]}{a.worst_mgdl !== null && a.kind !== 'no_data' ? <>{" "}<b className="num">{formatGlucose(a.worst_mgdl, unit)}</b></> : null}
                    {a.acknowledged_by ? <span className="text-slate-500"> · {nameOf(a.acknowledged_by)}</span> : null}</span>
                  <span className="text-xs text-slate-400">{sinceText(a.started_at)}{a.state !== 'resolved' ? ' · مستمر' : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
