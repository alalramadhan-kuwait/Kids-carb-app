import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { callGlucose } from '../lib/api';
import { GLUCOSE_ERRORS, type GlucoseState } from '../lib/glucose';
import { Alert, Btn, Card, Field, Page, asset, inputCls, toast } from '../components/ui';
import { isEn, t } from '../i18n';

export default function Cgm() {
  const nav = useNavigate();
  const [st, setSt] = useState<GlucoseState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { callGlucose({ action: 'status' }).then(setSt).catch((e) => setErr(e.message)); }, []);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await callGlucose({ action: 'save', email, password });
      if (r.error) setErr(GLUCOSE_ERRORS[r.error] ?? r.error);
      else { setSt(r); setPassword(''); toast(t('تم ربط قراءات السكر ✓')); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title={t('قراءات السكر')} back={() => nav(-1)}>
      <div className="space-y-4">
        {st?.connected ? (
          <Card className="space-y-3">
            <Alert tone="ok">{t('مربوط بحساب LibreLinkUp:')} <span dir="ltr" className="font-bold">{st.account_hint}</span></Alert>
            {st.last_ok_at && (() => {
              const min = Math.max(0, Math.round((Date.now() - new Date(st.last_ok_at).getTime()) / 60000));
              return <p className="text-sm text-slate-600">{min < 1 ? t('آخر تحديث من الخادم: الآن') : t('آخر تحديث من الخادم: قبل {n} د', { n: min })} {min <= 3 ? t('✓ يعمل كل دقيقة، حتى والتطبيق مغلق') : t('— متأخر، تحقق من الجوال الذي عليه Libre')}</p>;
            })()}
            {st.last_error && <Alert tone="near">{GLUCOSE_ERRORS[st.last_error] ?? st.last_error}</Alert>}
            <p className="text-sm text-slate-600">{t('الوحدة ونطاق التلوين من')} <Link to="/settings" className="text-brand underline">{t('الإعدادات')}</Link>.</p>
            <Btn kind="danger" block onClick={async () => { if (confirm(t('فصل الربط وحذف بيانات الدخول المحفوظة؟'))) { setSt(await callGlucose({ action: 'clear' })); toast(t('تم الفصل')); } }}>{t('فصل الربط')}</Btn>
          </Card>
        ) : (
          <>
            <Card className="space-y-2">
              <img src={asset('04_objects/obj_cgm.svg')} alt="" className="mx-auto h-20 w-20" />
              <h2 className="font-bold">{t('كيف يعمل')}</h2>
              <p className="text-sm leading-relaxed text-slate-600">{t('يقرأ التطبيق من خدمة')} <b>LibreLinkUp</b> {t('من Abbott، وهي نفس الخدمة التي يستخدمها Gluroo. يلزم حساب LibreLinkUp (متابع) تتم مشاركة قراءات الطفلة معه:')}</p>
              <ol className="list-decimal space-y-1 ps-5 text-sm text-slate-700">
                <li>{t('في تطبيق')} <b>{t('Libre الرئيسي')}</b> {t('(الذي على جوال الطفلة): القائمة ← المتصلون (Connected Apps) ← LibreLinkUp ← أضف متابعًا.')}</li>
                <li>{t('من تطبيق')} <b>LibreLinkUp</b> {t('على جوالك أنت: أنشئ الحساب وقبِل الدعوة، وافتحه مرة واحدة ووافق على الشروط.')}</li>
                <li>{t('اكتب هنا بريد وكلمة مرور حساب')} <b>LibreLinkUp</b>{isEn() ? ' account.' : '.'}</li>
              </ol>
              <p className="text-xs text-slate-500">{t('إن كان Gluroo يستخدم نفس حساب المتابع فهذا مناسب أيضًا.')}</p>
            </Card>
            <Card className="space-y-3">
              <Field label={t('بريد LibreLinkUp')}><input className={inputCls} dir="ltr" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label={t('كلمة المرور')}><input className={inputCls} dir="ltr" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              {err && <Alert tone="over">{err}</Alert>}
              <Btn kind="primary" block disabled={busy || !email || !password} onClick={save}>{busy ? t('جاري الاختبار…') : t('ربط')}</Btn>
              <p className="text-xs leading-relaxed text-slate-500">{t('تُحفظ مشفّرة على الخادم ولا تظهر في التطبيق بعد الحفظ. استخدم كلمة مرور خاصة بهذا الحساب فقط.')}</p>
            </Card>
          </>
        )}
        <Card><p className="text-sm leading-relaxed text-slate-600">{t('القراءات قد تتأخر بضع دقائق عن الجهاز. حاسبة الجرعة لا تعطي رقمًا من قراءة أقدم من 15 دقيقة.')}</p></Card>
      </div>
    </Page>
  );
}
