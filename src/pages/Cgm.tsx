import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { callGlucose } from '../lib/api';
import { GLUCOSE_ERRORS, type GlucoseState } from '../lib/glucose';
import { Alert, Btn, Card, Field, Page, inputCls, toast } from '../components/ui';

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
      else { setSt(r); setPassword(''); toast('تم ربط قراءات السكر ✓'); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title="قراءات السكر" back={() => nav(-1)}>
      <div className="space-y-4">
        {st?.connected ? (
          <Card className="space-y-3">
            <Alert tone="ok">مربوط بحساب LibreLinkUp: <span dir="ltr" className="font-bold">{st.account_hint}</span></Alert>
            {st.last_error && <Alert tone="near">{GLUCOSE_ERRORS[st.last_error] ?? st.last_error}</Alert>}
            <p className="text-sm text-slate-600">الوحدة ونطاق التلوين من <Link to="/settings" className="text-brand underline">الإعدادات</Link>.</p>
            <Btn kind="danger" block onClick={async () => { if (confirm('فصل الربط وحذف بيانات الدخول المحفوظة؟')) { setSt(await callGlucose({ action: 'clear' })); toast('تم الفصل'); } }}>فصل الربط</Btn>
          </Card>
        ) : (
          <>
            <Card className="space-y-2">
              <h2 className="font-bold">كيف يعمل</h2>
              <p className="text-sm leading-relaxed text-slate-600">يقرأ التطبيق من خدمة <b>LibreLinkUp</b> من Abbott، وهي نفس الخدمة التي يستخدمها Gluroo. يلزم حساب LibreLinkUp (متابع) تتم مشاركة قراءات الطفلة معه:</p>
              <ol className="list-decimal space-y-1 ps-5 text-sm text-slate-700">
                <li>في تطبيق <b>Libre الرئيسي</b> (الذي على جوال الطفلة): القائمة ← المتصلون (Connected Apps) ← LibreLinkUp ← أضف متابعًا.</li>
                <li>من تطبيق <b>LibreLinkUp</b> على جوالك أنت: أنشئ الحساب وقبِل الدعوة، وافتحه مرة واحدة ووافق على الشروط.</li>
                <li>اكتب هنا بريد وكلمة مرور حساب <b>LibreLinkUp</b>.</li>
              </ol>
              <p className="text-xs text-slate-500">إن كان Gluroo يستخدم نفس حساب المتابع فهذا مناسب أيضًا.</p>
            </Card>
            <Card className="space-y-3">
              <Field label="بريد LibreLinkUp"><input className={inputCls} dir="ltr" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="كلمة المرور"><input className={inputCls} dir="ltr" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              {err && <Alert tone="over">{err}</Alert>}
              <Btn kind="primary" block disabled={busy || !email || !password} onClick={save}>{busy ? 'جاري الاختبار…' : 'ربط'}</Btn>
              <p className="text-xs leading-relaxed text-slate-500">تُحفظ مشفّرة على الخادم ولا تظهر في التطبيق بعد الحفظ. استخدم كلمة مرور خاصة بهذا الحساب فقط.</p>
            </Card>
          </>
        )}
        <Card><p className="text-sm leading-relaxed text-slate-600">القراءات للعرض فقط، وقد تتأخر بضع دقائق عن الجهاز. لا يحسب التطبيق جرعات ولا يصدر إنذارات. اعتمد على Libre وGluroo في القرارات.</p></Card>
      </div>
    </Page>
  );
}
