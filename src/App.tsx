import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { openedFromRecovery, supabase } from './lib/supabase';
import { DataProvider, useData } from './lib/data';
import { Alert, Btn, Card, Field, Toaster, cx, inputCls } from './components/ui';
import Today from './pages/Today';
import { RecipeList, RecipeView } from './pages/Recipes';
import RecipeEdit from './pages/RecipeEdit';
import { ProductList } from './pages/Products';
import ProductEdit from './pages/ProductEdit';
import History from './pages/History';
import Plan from './pages/Plan';
import Cgm from './pages/Cgm';
import { UpdateBanner, VersionTag } from './components/Version';
import { Icon } from './components/Icon';
import type { IconName } from './icons/defs';
import { More, SnacksPage, SettingsPage } from './pages/More';

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid min-h-screen max-w-md place-items-center px-4"><div className="w-full space-y-4">{children}</div></main>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr('البريد أو كلمة المرور غير صحيحة'); setBusy(false);
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    // the link must come back to this app, not to the site's default address
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    setBusy(false);
    if (error) setErr(error.message.toLowerCase().includes('rate') ? 'حاولت كثيرًا. انتظر قليلًا ثم أعد المحاولة.' : 'تعذّر الإرسال. حاول لاحقًا.');
    else setSent(true);
  };
  return (
    <Centered>
      <h1 className="text-center text-3xl font-bold">ليان</h1>
      <div className="text-center"><VersionTag /></div>
      <Card>
        {forgot ? (
          <form onSubmit={reset} className="space-y-3">
            <p className="text-sm text-slate-600">اكتب بريدك الإلكتروني الحقيقي وسيصلك رابط لتعيين كلمة مرور جديدة.</p>
            <Field label="البريد الإلكتروني"><input className={inputCls} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            {sent && <Alert tone="ok">إن كان البريد مسجّلًا فقد أُرسل إليه رابط. افتحه من نفس الجوال.</Alert>}
            {err && <Alert tone="over">{err}</Alert>}
            <Btn kind="primary" block disabled={busy || sent}>إرسال الرابط</Btn>
            <Btn kind="ghost" block type="button" onClick={() => { setForgot(false); setSent(false); setErr(''); }}>رجوع</Btn>
          </form>
        ) : (
          <form onSubmit={go} className="space-y-3">
            <Field label="البريد الإلكتروني"><input className={inputCls} dir="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="كلمة المرور"><input className={inputCls} dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {err && <Alert tone="over">{err}</Alert>}
            <Btn kind="primary" block disabled={busy}>دخول</Btn>
            <button type="button" className="block w-full text-center text-sm text-brand underline" onClick={() => { setForgot(true); setErr(''); }}>نسيت كلمة المرور؟</button>
          </form>
        )}
      </Card>
    </Centered>
  );
}

/** Reached from the reset email (the link signs the person in), or from "المزيد". */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (pw.length < 8) return setErr('كلمة المرور 8 خانات على الأقل');
    if (pw !== pw2) return setErr('الكلمتان غير متطابقتين');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message.includes('different') ? 'اختر كلمة مختلفة عن الحالية' : 'تعذّر الحفظ: ' + error.message); else onDone();
  };
  return (
    <Centered>
      <h1 className="text-center text-2xl font-bold">كلمة مرور جديدة</h1>
      <Card>
        <form onSubmit={save} className="space-y-3">
          <Field label="كلمة المرور الجديدة"><input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="أعد كتابتها"><input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          {err && <Alert tone="over">{err}</Alert>}
          <Btn kind="primary" block disabled={busy}>حفظ</Btn>
        </form>
      </Card>
    </Centered>
  );
}

/** First parent to sign in enters the one-time setup code; the second is added from "المزيد". */
function Claim({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const { error } = await supabase.rpc('claim_household', { p_code: code.trim(), p_name: name.trim() || null });
    if (error) setErr(error.message.includes('already') ? 'التطبيق مفعّل مسبقًا. اطلب من أحد الوالدين إضافتك من "المزيد".' : 'رمز التفعيل غير صحيح'); else onDone();
  };
  return (
    <Centered>
      <h1 className="text-center text-2xl font-bold">تفعيل التطبيق</h1>
      <Card>
        <form onSubmit={go} className="space-y-3">
          <Alert tone="info">هذا الحساب غير مضاف إلى التطبيق بعد. إن كان التطبيق مفعّلًا، اطلب من الأم أو الأب إضافة بريدك من المزيد ← إضافة أحد الوالدين، ثم ادخل من جديد.</Alert>
          <p className="text-sm text-slate-600">رمز التفعيل لأول مرة فقط، عند تفعيل التطبيق لأول مستخدم.</p>
          <Field label="اسمك"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="رمز التفعيل"><input className={inputCls} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
          {err && <Alert tone="over">{err}</Alert>}
          <Btn kind="primary" block>تفعيل</Btn>
          <Btn kind="ghost" block type="button" onClick={() => supabase.auth.signOut()}>خروج</Btn>
        </form>
      </Card>
    </Centered>
  );
}

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'اليوم', icon: 'home' },
  { to: '/recipes', label: 'الوصفات', icon: 'meals' },
  { to: '/products', label: 'المنتجات', icon: 'products' },
  { to: '/history', label: 'السجل', icon: 'history' },
  { to: '/more', label: 'المزيد', icon: 'more' },
];

function Shell() {
  const { loading, error } = useData();
  if (loading) return <Centered><p className="text-center text-slate-500">جاري التحميل…</p></Centered>;
  if (error) return <Centered><Alert tone="over">تعذّر تحميل البيانات: {error}</Alert></Centered>;
  return (
    <>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/recipes" element={<RecipeList />} />
        <Route path="/recipes/new" element={<RecipeEdit />} />
        <Route path="/recipes/:id" element={<RecipeView />} />
        <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
        <Route path="/products" element={<ProductList />} />
        <Route path="/products/new" element={<ProductEdit />} />
        <Route path="/products/:id" element={<ProductEdit />} />
        <Route path="/history" element={<History />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/cgm" element={<Cgm />} />
        <Route path="/snacks" element={<SnacksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.to === '/'} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-xs', isActive ? 'font-bold text-brand' : 'text-slate-500')}>
                {({ isActive }) => <><Icon name={t.icon} active={isActive} />{t.label}</>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<boolean | null>(null);
  const [problem, setProblem] = useState('');
  const [recovery, setRecovery] = useState(openedFromRecovery);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true); setSession(s); });
    return () => data.subscription.unsubscribe();
  }, []);

  const check = async () => {
    setProblem('');
    const { data, error } = await supabase.rpc('is_member');
    if (error) { setProblem(error.message); setMember(null); } else setMember(Boolean(data));
  };
  useEffect(() => { if (session) void check(); else setMember(null); }, [session?.user.id]);

  if (session === undefined) return null;
  let body;
  if (session && recovery) body = <SetPassword onDone={() => setRecovery(false)} />;
  else if (!session) body = <Login />;
  else if (problem) body = (
    <Centered>
      <Alert tone="over">تعذّر الاتصال بقاعدة البيانات: {problem}</Alert>
      <p className="text-sm text-slate-600">إن كان الخطأ عن المخطط <span dir="ltr">carb</span>، أضِفه في Supabase ← Settings ← API ← Exposed schemas.</p>
      <Btn block onClick={check}>إعادة المحاولة</Btn>
    </Centered>
  );
  else if (member === null) body = null;
  else if (!member) body = <Claim onDone={check} />;
  else body = <DataProvider><Shell /></DataProvider>;
  return <>{body}<UpdateBanner /><Toaster /></>;
}
