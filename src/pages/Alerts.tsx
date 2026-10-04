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
import { Alert, Btn, Card, Chip, Field, NumInput, Page, Toggle, cx, inputCls, toast } from '../components/ui';
import { hhmm } from '../lib/schedule';
import { isEn, t } from '../i18n';

type Sub = { id: string; user_id: string; device_label: string | null; last_ok_at: string | null; last_error: string | null; endpoint: string };
const KEYS = ['alert_urgent_low_mgdl', 'alert_low_mgdl', 'alert_high_mgdl', 'alert_low_delay_min', 'alert_high_delay_min', 'alert_nodata_min', 'alert_renotify_min',
  'alert_high_renotify_min', 'alert_rapid_rate', 'alert_fall_rate', 'alert_rise_rate', 'alert_predict_low_min', 'night_start', 'night_end', 'night_low_mgdl', 'night_high_mgdl', 'night_high_silent', 'night_theme',
  'school_days', 'school_start', 'school_end', 'school_low_mgdl', 'school_high_mgdl', 'escalate_min'] as const;
// Arabic labels; translated with t() where shown.
const WEEK = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']; // i18n-ok
const ROLE: [string, string][] = [['primary', 'أولًا'], ['backup', 'احتياط'], ['off', 'لا']]; // i18n-ok

export default function AlertsPage() {
  const nav = useNavigate();
  const { settings, reload, nameOf, members } = useData();
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
  type GKey = 'alert_urgent_low_mgdl' | 'alert_low_mgdl' | 'alert_high_mgdl' | 'night_low_mgdl' | 'night_high_mgdl' | 'school_low_mgdl' | 'school_high_mgdl';
  const g = (k: GKey) => (s[k] === null ? null : Number(formatGlucose(s[k]!, unit)));
  const setG = (k: GKey) => (v: number | null) => setS({ ...s, [k]: v === null ? null : toMgdl(v, unit) });
  // fast fall and fast rise are stored in mg/dL per minute and shown in the parents' unit per minute; each has its own
  // threshold (the older shared one is cleared once either is saved)
  const shown = (mg: number | null) => (mg === null ? null : unit === 'mmol' ? Math.round((mg / 18.016) * 100) / 100 : mg);
  const stored = (v: number | null) => (v === null ? null : Math.round((unit === 'mmol' ? v * 18.016 : v) * 10) / 10);
  const fall = shown(s.alert_fall_rate ?? s.alert_rapid_rate), rise = shown(s.alert_rise_rate ?? s.alert_rapid_rate);
  const setFall = (v: number | null) => setS({ ...s, alert_fall_rate: stored(v), alert_rise_rate: s.alert_rise_rate ?? s.alert_rapid_rate, alert_rapid_rate: null });
  const setRise = (v: number | null) => setS({ ...s, alert_rise_rate: stored(v), alert_fall_rate: s.alert_fall_rate ?? s.alert_rapid_rate, alert_rapid_rate: null });
  const rateOk = (r: number | null) => r === null || (r >= 1 && r <= 6);
  const time = (k: 'night_start' | 'night_end' | 'school_start' | 'school_end') => (
    <input type="time" dir="ltr" className={inputCls} value={hhmm(s[k])} onChange={(e) => setS({ ...s, [k]: e.target.value || null })} />
  );
  const setRole = async (user: string, role: string) => {
    const { error } = await supabase.rpc('set_alert_role', { p_user: user, p_role: role });
    if (error) toast(error.message); else await reload();
  };
  const u = s.alert_urgent_low_mgdl, l = s.alert_low_mgdl, h = s.alert_high_mgdl;
  const problem =
    u !== null && (u < 40 || u > 100) ? t('المنخفض جدًا خارج المعقول') :
    l !== null && (l < 50 || l > 150) ? t('المنخفض خارج المعقول') :
    h !== null && (h < 120 || h > 450) ? t('المرتفع خارج المعقول') :
    u !== null && l !== null && u >= l ? t('المنخفض جدًا يجب أن يكون أقل من المنخفض') :
    l !== null && h !== null && l >= h ? t('المنخفض يجب أن يكون أقل من المرتفع') :
    !rateOk(s.alert_rapid_rate) || !rateOk(s.alert_fall_rate) || !rateOk(s.alert_rise_rate) ? t('سرعة التغيّر خارج المعقول') :
    s.alert_renotify_min < 5 || s.alert_renotify_min > 60 ? t('تكرار المنخفض بين 5 و60 دقيقة') :
    s.alert_high_renotify_min < 15 || s.alert_high_renotify_min > 240 ? t('تكرار المرتفع بين 15 و240 دقيقة') :
    s.alert_predict_low_min !== null && (s.alert_predict_low_min < 10 || s.alert_predict_low_min > 40) ? t('المنخفض المتوقع بين 10 و40 دقيقة') :
    (s.night_start === null) !== (s.night_end === null) ? t('اكتب بداية ونهاية الليل') :
    (s.school_start === null) !== (s.school_end === null) ? t('اكتب بداية ونهاية المدرسة') : '';

  const save = async () => {
    const patch = Object.fromEntries(KEYS.map((k) => [k, s[k]]));
    const { error } = await supabase.from('settings').update(patch).eq('id', true);
    if (error) return toast(error.message);
    await reload(); toast(t('تم الحفظ ✓'));
  };
  const turnOn = async () => {
    setBusy(true);
    try { setPs(await enablePush()); loadLists(); } catch (e) { toast(t('تعذّر التفعيل: {msg}', { msg: (e as Error).message })); } finally { setBusy(false); }
  };

  return (
    <Page title={t('التنبيهات')} back={() => nav(-1)}>
      <div className="space-y-3">
        <Card className="space-y-3">
          <h2 className="font-bold">{t('على هذا الجوال')}</h2>
          {ps === 'needs_install' && <Alert tone="info">{t('في الآيفون تعمل التنبيهات من أيقونة التطبيق فقط: زر المشاركة ←')} <b>{t('إضافة إلى الشاشة الرئيسية')}</b>{t('، ثم افتحه من الأيقونة وارجع هنا.')}</Alert>}
          {ps === 'unsupported' && <Alert tone="near">{t('هذا المتصفح لا يدعم التنبيهات.')}</Alert>}
          {ps === 'denied' && <Alert tone="near">{t('التنبيهات مرفوضة. فعّلها من إعدادات الجوال ← الإشعارات ← ليان.')}</Alert>}
          {ps === 'off' && <Btn kind="primary" block className="min-h-[52px]" disabled={busy} onClick={turnOn}>{t('فعّل التنبيهات')}</Btn>}
          {ps === 'on' && (
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={async () => { const r = await testPush(); toast(r.ok ? t('أُرسل ✓ — انتظر الإشعار') : t('لم يصل. جرّب إيقاف وتفعيل')); loadLists(); }}>{t('أرسل تجربة')}</Btn>
              <Btn kind="ghost" onClick={async () => { await disablePush(); setPs(await pushState()); loadLists(); }}>{t('إيقاف')}</Btn>
            </div>
          )}
          <p className="text-xs text-slate-500">{t('تنبيهات مساعدة. تطبيق Libre يبقى المنبّه الأساسي، وقد لا يصل الإشعار إذا كان الجوال صامتًا أو في وضع التركيز.')}</p>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('الحدود')} <span className="text-sm font-normal text-slate-500">({unitLabel(unit)})</span></h2>
          <p className="text-sm text-slate-600">{t('من الطبيب. اتركه فارغًا لإيقاف ذلك التنبيه.')}</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('منخفض جدًا')}><NumInput value={g('alert_urgent_low_mgdl')} onChange={setG('alert_urgent_low_mgdl')} /></Field>
            <Field label={t('منخفض')}><NumInput value={g('alert_low_mgdl')} onChange={setG('alert_low_mgdl')} /></Field>
            <Field label={t('مرتفع')}><NumInput value={g('alert_high_mgdl')} onChange={setG('alert_high_mgdl')} /></Field>
          </div>
          <h3 className="pt-1 text-sm font-bold text-slate-600">{t('بالدقائق')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('انتظار المنخفض')}><NumInput value={s.alert_low_delay_min} onChange={(v) => setS({ ...s, alert_low_delay_min: v ?? 5 })} /></Field>
            <Field label={t('انتظار المرتفع')}><NumInput value={s.alert_high_delay_min} onChange={(v) => setS({ ...s, alert_high_delay_min: v ?? 30 })} /></Field>
            <Field label={t('بدون قراءة بعد')}><NumInput value={s.alert_nodata_min} onChange={(v) => setS({ ...s, alert_nodata_min: v ?? 20 })} /></Field>
            <Field label={t('تكرار المنخفض كل')}><NumInput value={s.alert_renotify_min} onChange={(v) => setS({ ...s, alert_renotify_min: v ?? 15 })} /></Field>
            <Field label={t('تكرار المرتفع كل')}><NumInput value={s.alert_high_renotify_min} onChange={(v) => setS({ ...s, alert_high_renotify_min: v ?? 60 })} /></Field>
          </div>
          {problem && <Alert tone="near">{problem}</Alert>}
          <Btn kind="primary" block disabled={!!problem} onClick={save}>{t('حفظ')}</Btn>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('النزول أو الصعود السريع')}</h2>
          <p className="text-sm text-slate-600">{t('{unit} بالدقيقة. فارغ = متوقف. من الطبيب.', { unit: unitLabel(unit) })}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('نزول أسرع من')}><NumInput value={fall} onChange={setFall} /></Field>
            <Field label={t('صعود أسرع من')}><NumInput value={rise} onChange={setRise} /></Field>
          </div>
          <Field label={t('منخفض متوقع: نبّه قبل (دقائق)')} hint={t('ينبّه إذا كانت تنزل والنزول (وهو يخفّ تدريجيًا) يقرّبها من حد المنخفض خلال هذه المدة، ونصف ساعة على الأقل. فارغ = متوقف.')}>
            <NumInput value={s.alert_predict_low_min} onChange={(v) => setS({ ...s, alert_predict_low_min: v })} />
          </Field>
          <Btn kind="primary" block disabled={!!problem} onClick={save}>{t('حفظ')}</Btn>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-bold">{t('وضع الليل')}</h2><span className="text-xs text-slate-500">{t('فارغ = متوقف')}</span></div>
          <div className="grid grid-cols-2 gap-2"><Field label={t('من')}>{time('night_start')}</Field><Field label={t('إلى')}>{time('night_end')}</Field></div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('منخفض بالليل')} hint={t('فارغ = مثل النهار')}><NumInput value={g('night_low_mgdl')} onChange={setG('night_low_mgdl')} /></Field>
            <Field label={t('مرتفع بالليل')} hint={t('فارغ = مثل النهار')}><NumInput value={g('night_high_mgdl')} onChange={setG('night_high_mgdl')} /></Field>
          </div>
          <label className="flex min-h-[44px] items-center justify-between"><span>{t('المرتفع بدون إشعار بالليل')}</span><Toggle on={s.night_high_silent} onChange={(v) => setS({ ...s, night_high_silent: v })} label={t('المرتفع بدون إشعار بالليل')} /></label>
          <label className="flex min-h-[44px] items-center justify-between"><span>{t('ألوان الليل في وقته')}</span><Toggle on={s.night_theme} onChange={(v) => setS({ ...s, night_theme: v })} label={t('ألوان الليل في وقته')} /></label>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-bold">{t('وضع المدرسة')}</h2><span className="text-xs text-slate-500">{t('فارغ = متوقف')}</span></div>
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((w, d) => <Chip key={d} active={s.school_days.includes(d)} onClick={() => setS({ ...s, school_days: s.school_days.includes(d) ? s.school_days.filter((x) => x !== d) : [...s.school_days, d].sort() })}>{t(w)}</Chip>)}
          </div>
          <div className="grid grid-cols-2 gap-2"><Field label={t('من')}>{time('school_start')}</Field><Field label={t('إلى')}>{time('school_end')}</Field></div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('منخفض بالمدرسة')} hint={t('فارغ = مثل النهار')}><NumInput value={g('school_low_mgdl')} onChange={setG('school_low_mgdl')} /></Field>
            <Field label={t('مرتفع بالمدرسة')} hint={t('فارغ = مثل النهار')}><NumInput value={g('school_high_mgdl')} onChange={setG('school_high_mgdl')} /></Field>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('من يصله التنبيه')}</h2>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2">
                <span className="flex-1 font-medium">{nameOf(m.user_id)}</span>
                <div className="flex gap-1" role="radiogroup">
                  {ROLE.map(([v, label]) => (
                    <button key={v} role="radio" aria-checked={(m.alert_role ?? 'primary') === v} onClick={() => setRole(m.user_id, v)}
                      className={cx('min-h-[40px] rounded-xl px-3 text-sm font-medium', (m.alert_role ?? 'primary') === v ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600')}>{t(label)}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <Field label={t('إذا لم يرد أحد، يصل للاحتياط بعد (دقائق)')} hint={t('المنخفض جدًا بعد 5 دقائق كحد أقصى')}>
            <NumInput value={s.escalate_min} onChange={(v) => setS({ ...s, escalate_min: v ?? 10 })} />
          </Field>
          <Btn kind="primary" block disabled={!!problem} onClick={save}>{t('حفظ')}</Btn>
        </Card>

        <Link to="/care-plan"><Card className="flex items-center gap-3 !p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="heart" size={22} /></span><div className="flex-1 font-bold">{t('خطة الطبيب')}</div><span className="text-slate-300">{isEn() ? '›' : '‹'}</span></Card></Link>

        <Card>
          <h2 className="mb-2 font-bold">{t('الأجهزة')}</h2>
          {subs.length === 0 ? <p className="text-sm text-slate-500">{t('لا يوجد جهاز مفعّل بعد.')}</p> : (
            <ul className="space-y-1.5 text-sm">
              {subs.map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className={x.last_error ? 'font-bold text-slate-800' : 'text-brand'}>{x.last_error ? '!' : '✓'}</span>
                  <span className="flex-1"><b>{nameOf(x.user_id)}</b> · {x.device_label ?? t('جهاز')}</span>
                  <span className="text-xs text-slate-400">{x.last_ok_at ? t('وصل {when}', { when: sinceText(x.last_ok_at) }) : x.last_error ? t('لم يصل') : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card>
            <h2 className="mb-2 font-bold">{t('آخر التنبيهات')}</h2>
            <ul className="space-y-1.5 text-sm">
              {past.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="flex-1">{ALERT_NAME[a.kind]}{a.worst_mgdl !== null && a.kind !== 'no_data' ? <>{" "}<b className="num">{formatGlucose(a.worst_mgdl, unit)}</b></> : null}
                    {a.acknowledged_by ? <span className="text-slate-500"> · {nameOf(a.acknowledged_by)}</span> : null}</span>
                  <span className="text-xs text-slate-400">{sinceText(a.started_at)}{a.state !== 'resolved' ? ' · ' + t('مستمر') : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
