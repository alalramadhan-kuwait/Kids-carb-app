import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { openedFromRecovery, supabase } from './lib/supabase';
import { DataProvider, useData } from './lib/data';
import { Alert, Btn, Card, Field, Toaster, cx, inputCls } from './components/ui';
import Today from './pages/Today';
import { PlanHistoryPage, PlanPage } from './pages/PlanReview';
import { PlanReport } from './pages/PlanReport';
import Now from './pages/Now';
import Analysis from './pages/Analysis';
import { RecipeList, RecipeView } from './pages/Recipes';
import RecipeEdit from './pages/RecipeEdit';
import { ProductList } from './pages/Products';
import ProductEdit from './pages/ProductEdit';
import History from './pages/History';
import { ReuseEdit, ReusePick } from './pages/Reuse';
import Plan from './pages/Plan';
import Cgm from './pages/Cgm';
import Status from './pages/Status';
import ImportPage from './pages/Import';
import SensorAccuracy from './pages/SensorAccuracy';
import Research from './pages/Research';
import { useLabRunner } from './lib/lab';
import AlertsPage from './pages/Alerts';
import CarePlanPage from './pages/CarePlan';
import Night from './pages/Night';
import Shared from './pages/Shared';
import SharePage from './pages/Share';
import WidgetPage from './pages/Widget';
import DietSheetPage from './pages/DietSheet';
import GrowthPage from './pages/Growth';
import Report from './pages/Report';
import Scan from './pages/Scan';
import { isNight } from './lib/schedule';
import { UpdateBanner, VersionTag } from './components/Version';
import { Icon } from './components/Icon';
import type { IconName } from './icons/defs';
import { More, SnacksPage, SettingsPage } from './pages/More';
import { themePref } from './lib/theme';
import { t, useLang } from './i18n';
import { LangSwitch } from './components/LangSwitch';
import { MomHome } from './pages/mom/MomHome';
import { MomAdd, MomFoodItem, MomGroup, MomMeal, MomNew, MomPortion, MomRestaurant } from './pages/mom/MomMeal';
import { MomCompare } from './pages/mom/MomCompare';
import { MomAte, MomDose, MomGiven } from './pages/mom/MomDose';
import { MomMealEdit } from './pages/mom/MomMealEdit';
import { DeletedPage, MomDeleted } from './pages/Deleted';
import { MomJuice, MomRecordDose, MomShot, MomSite, MomSites, MomTresiba } from './pages/mom/MomShots';
import { MomEntry } from './pages/mom/MomEntry';
import { Alarm } from './components/Alarm';
import { useKeepAwake } from './lib/keepAwake';
import { MomLog } from './pages/mom/MomLog';
import { MomMealEntry } from './pages/mom/MomMealEntry';
import { MomPrick } from './pages/mom/MomPrick';
import { SameMealPage, MomSame } from './pages/SameMeal';
import { MomActivity, MomMore, MomPlanView, MomPlans, MomSensor, MomWhen } from './pages/mom/MomPlan';
import { MomTabs } from './pages/mom/MomUI';
import { PortionEdit, PortionList } from './pages/Portions';
import { fullModeNow } from './lib/mom';

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
    const id = email.trim();
    // the shift app (Timekeeper) shares the sign-in system and the web address, so the phone may fill in its
    // username: that account is not Layan's family, say so instead of opening the setup screen
    if (!id.includes('@') || /\.local$/i.test(id)) { setErr(t('هذا حساب تطبيق المناوبات. ادخل ببريدك الخاص بتطبيق ليان.')); setBusy(false); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: id, password });
    if (error) setErr(t('البريد أو كلمة المرور غير صحيحة')); setBusy(false);
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    // the link must come back to this app, not to the site's default address
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    setBusy(false);
    if (error) setErr(error.message.toLowerCase().includes('rate') ? t('حاولت كثيرًا. انتظر قليلًا ثم أعد المحاولة.') : t('تعذّر الإرسال. حاول لاحقًا.'));
    else setSent(true);
  };
  return (
    <Centered>
      <img src={`${import.meta.env.BASE_URL}icons/layan-logo-256.webp`} alt={t('ليان')} width={128} height={128} className="mx-auto h-32 w-32" />
      <h1 className="text-center text-3xl font-bold">{t('ليان')}</h1>
      <div className="text-center"><VersionTag /></div>
      <LangSwitch className="mx-auto w-full max-w-xs" />
      <Card>
        {forgot ? (
          <form onSubmit={reset} className="space-y-3">
            <p className="text-sm text-slate-600">{t('اكتب بريدك الإلكتروني الحقيقي وسيصلك رابط لتعيين كلمة مرور جديدة.')}</p>
            <Field label={t('البريد الإلكتروني')}><input className={inputCls} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            {sent && <Alert tone="ok">{t('إن كان البريد مسجّلًا فقد أُرسل إليه رابط. افتحه من نفس الجوال.')}</Alert>}
            {err && <Alert tone="over">{err}</Alert>}
            <Btn kind="primary" block disabled={busy || sent}>{t('إرسال الرابط')}</Btn>
            <Btn kind="ghost" block type="button" onClick={() => { setForgot(false); setSent(false); setErr(''); }}>{t('رجوع')}</Btn>
          </form>
        ) : (
          <form onSubmit={go} className="space-y-3">
            <Field label={t('البريد الإلكتروني')}><input className={inputCls} dir="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label={t('كلمة المرور')}><input className={inputCls} dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {err && <Alert tone="over">{err}</Alert>}
            <Btn kind="primary" block disabled={busy}>{t('دخول')}</Btn>
            <button type="button" className="block w-full text-center text-sm text-brand underline" onClick={() => { setForgot(true); setErr(''); }}>{t('نسيت كلمة المرور؟')}</button>
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
    if (pw.length < 8) return setErr(t('كلمة المرور 8 خانات على الأقل'));
    if (pw !== pw2) return setErr(t('الكلمتان غير متطابقتين'));
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message.includes('different') ? t('اختر كلمة مختلفة عن الحالية') : t('تعذّر الحفظ: {e}', { e: error.message })); else onDone();
  };
  return (
    <Centered>
      <h1 className="text-center text-2xl font-bold">{t('كلمة مرور جديدة')}</h1>
      <Card>
        <form onSubmit={save} className="space-y-3">
          <Field label={t('كلمة المرور الجديدة')}><input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label={t('أعد كتابتها')}><input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          {err && <Alert tone="over">{err}</Alert>}
          <Btn kind="primary" block disabled={busy}>{t('حفظ')}</Btn>
        </form>
      </Card>
    </Centered>
  );
}

/** First parent to sign in enters the one-time setup code; the second is added from "المزيد". */
function Claim({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [who, setWho] = useState('');
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setWho(data.user?.email ?? '')); }, []);
  const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const { error } = await supabase.rpc('claim_household', { p_code: code.trim(), p_name: name.trim() || null });
    if (error) setErr(error.message.includes('already') ? t('التطبيق مفعّل مسبقًا. اطلب من أحد الوالدين إضافتك من "المزيد".') : t('رمز التفعيل غير صحيح')); else onDone();
  };
  return (
    <Centered>
      <img src={`${import.meta.env.BASE_URL}icons/layan-logo-256.webp`} alt="" width={96} height={96} className="mx-auto h-24 w-24" />
      <h1 className="text-center text-2xl font-bold">{t('تفعيل التطبيق')}</h1>
      <Card className="space-y-3">
        <Alert tone="info">{t('هذا الحساب غير مضاف لتطبيق ليان:')} <b dir="ltr" className="break-all">{who || '…'}</b></Alert>
        <Btn kind="primary" block type="button" onClick={() => supabase.auth.signOut()}>{t('الدخول بحساب آخر')}</Btn>
        <p className="text-xs text-slate-500">{t('إذا كان بريدك جديد: اطلب من الأم أو الأب إضافته من المزيد ← إضافة أحد الوالدين.')}</p>
        <details>
          <summary className="min-h-[40px] cursor-pointer py-2 text-sm text-slate-600">{t('أول تفعيل للتطبيق (رمز التفعيل)')}</summary>
          <form onSubmit={go} className="space-y-3">
            <Field label={t('اسمك')}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t('رمز التفعيل')}><input className={inputCls} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
            {err && <Alert tone="over">{err}</Alert>}
            <Btn block>{t('تفعيل')}</Btn>
          </form>
        </details>
      </Card>
    </Centered>
  );
}

/** Five tabs (Hick's Law). "match" lists the pages that belong to each tab. */
const TABS: { to: string; label: string; icon: IconName; match: string[] }[] = [
  { to: '/', label: 'الآن', icon: 'home', match: ['/'] }, // i18n-ok
  { to: '/timeline', label: 'السجل', icon: 'history', match: ['/timeline'] }, // i18n-ok
  { to: '/meals', label: 'الوجبات', icon: 'meals', match: ['/meals', '/recipes', '/products', '/plan', '/plans', '/snacks', '/scan'] }, // i18n-ok
  { to: '/analysis', label: 'التحليل', icon: 'advanced', match: ['/analysis', '/advanced'] }, // i18n-ok
  { to: '/more', label: 'المزيد', icon: 'more', match: ['/more', '/settings', '/cgm', '/alerts', '/care-plan', '/share', '/widget', '/diet-sheet', '/report'] }, // i18n-ok
];

/** Appearance: a fixed day or night choice on this phone, or automatic (night colours in the parents' night window
 *  if they turned it on, else the phone's dark mode). The full-screen night view always uses night colours. */
function NightTheme() {
  const { settings } = useData();
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement, pref = themePref();
      if (location.hash.startsWith('#/night')) return;
      const want = pref !== 'auto' ? pref : settings.night_theme && isNight(settings) ? 'night' : null;
      if (want) root.dataset.theme = want; else delete root.dataset.theme;
    };
    apply();
    const timer = setInterval(apply, 60000);
    window.addEventListener('themepref', apply);
    return () => { clearInterval(timer); window.removeEventListener('themepref', apply); };
  }, [settings]);
  return null;
}

function Shell() {
  const { loading, error, settings, events, history, members, me } = useData();
  const { pathname, search } = useLocation();
  // mom mode: this person's phone opens in the simple screens (one tap «الوضع الكامل» for this visit)
  const simple = !!members.find((m) => m.user_id === me)?.simple_mode && !fullModeNow();
  const mom = pathname === '/mom' || pathname.startsWith('/mom/');
  // the screen stays on while the app is open, if this phone chose so (so the alarm can sound)
  useKeepAwake();
  // mom mode's pages are one fixed screen each: the document is locked so it cannot slide under the clock
  useEffect(() => { document.documentElement.classList.toggle('mom-lock', mom); if (mom) window.scrollTo(0, 0); }, [mom]);
  // mom mode's own tabs (home, log, nutrition) on its three main pages
  const momTabs = pathname === '/mom' || pathname === '/mom/log' || pathname === '/mom/food' || pathname === '/mom/more';
  // the research lab runs by itself every 12 hours (one phone per slot); it never touches doses or readings
  useLabRunner({ loading: loading || !!error, settings, events, history });
  if (loading) return <Centered><p className="text-center text-slate-500">{t('جاري التحميل…')}</p></Centered>;
  if (error) return <Centered><Alert tone="over">{t('تعذّر تحميل البيانات: {e}', { e: error })}</Alert></Centered>;
  return (
    <>
      <NightTheme />
      {/* desktop: the tabs become a side menu, so every page shifts over by its width */}
      <div className={!mom && !momTabs ? 'lg:ps-60' : undefined}>
      <Routes>
        <Route path="/" element={simple ? <Navigate to={new URLSearchParams(search).get('plan') ? `/mom/plan/${new URLSearchParams(search).get('plan')}` : new URLSearchParams(search).get('at') ? `/mom?at=${new URLSearchParams(search).get('at')}` : '/mom'} replace /> : <Now />} />
        <Route path="/mom" element={<MomHome />} />
        <Route path="/mom/meal" element={<MomMeal />} />
        <Route path="/mom/add" element={<MomAdd />} />
        <Route path="/mom/add/g/:key" element={<MomGroup />} />
        <Route path="/mom/add/g/:key/:sub" element={<MomGroup />} />
        <Route path="/mom/item/:kind/:id" element={<MomPortion />} />
        <Route path="/mom/new" element={<MomNew />} />
        <Route path="/mom/dose" element={<MomDose />} />
        <Route path="/mom/given/:id" element={<MomGiven />} />
        <Route path="/mom/ate/:id" element={<MomAte />} />
        <Route path="/mom/juice" element={<MomJuice />} />
        <Route path="/mom/shot" element={<MomShot />} />
        <Route path="/mom/record" element={<MomRecordDose />} />
        <Route path="/mom/prick" element={<MomPrick />} />
        <Route path="/mom/tresiba" element={<MomTresiba />} />
        <Route path="/mom/site" element={<MomSite />} />
        <Route path="/mom/sites" element={<MomSites />} />
        <Route path="/mom/entry/:id" element={<MomEntry />} />
        <Route path="/mom/meal-entry/:id" element={<MomMealEntry />} />
        <Route path="/mom/meal-edit/:id" element={<MomMealEdit />} />
        <Route path="/mom/log" element={<MomLog />} />
        <Route path="/mom/more" element={<MomMore />} />
        <Route path="/mom/deleted" element={<MomDeleted />} />
        <Route path="/deleted" element={<DeletedPage />} />
        <Route path="/mom/food" element={<MomAdd browse />} />
        <Route path="/mom/food/g/:key" element={<MomGroup browse />} />
        <Route path="/mom/food/g/:key/:sub" element={<MomGroup browse />} />
        <Route path="/mom/food/r/:key" element={<MomRestaurant browse />} />
        <Route path="/mom/add/r/:key" element={<MomRestaurant />} />
        <Route path="/mom/food/:kind/:id" element={<MomFoodItem />} />
        <Route path="/mom/compare" element={<MomCompare />} />
        <Route path="/mom/sensor" element={<MomSensor />} />
        <Route path="/mom/activity" element={<MomActivity />} />
        <Route path="/mom/same/:id" element={<MomSame />} />
        <Route path="/same/:id" element={<SameMealPage />} />
        <Route path="/reuse" element={<ReusePick />} />
        <Route path="/reuse/:id" element={<ReuseEdit />} />
        <Route path="/mom/when" element={<MomWhen />} />
        <Route path="/mom/plans" element={<MomPlans />} />
        <Route path="/mom/plan/:id" element={<MomPlanView />} />
        <Route path="/portions" element={<PortionList />} />
        <Route path="/portions/:kind/:id" element={<PortionEdit />} />
        <Route path="/meals" element={<Today />} />
        <Route path="/timeline" element={<History />} />
        <Route path="/history" element={<Navigate to="/timeline" replace />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/advanced" element={<Navigate to="/analysis?mode=stats" replace />} />
        <Route path="/recipes" element={<RecipeList />} />
        <Route path="/recipes/new" element={<RecipeEdit />} />
        <Route path="/recipes/:id" element={<RecipeView />} />
        <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
        <Route path="/products" element={<ProductList />} />
        <Route path="/products/new" element={<ProductEdit />} />
        <Route path="/products/:id" element={<ProductEdit />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/plans/history" element={<PlanHistoryPage />} />
        <Route path="/plans/report" element={<PlanReport />} />
        <Route path="/plans/:id" element={<PlanPage />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/cgm" element={<Cgm />} />
        <Route path="/status" element={<Status />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/sensor-accuracy" element={<SensorAccuracy />} />
        <Route path="/research" element={<Research />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/care-plan" element={<CarePlanPage />} />
        <Route path="/night" element={<Night />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="/widget" element={<WidgetPage />} />
        <Route path="/diet-sheet" element={<DietSheetPage />} />
        <Route path="/growth" element={<GrowthPage />} />
        <Route path="/report" element={<Report />} />
        <Route path="/snacks" element={<SnacksPage />} />
        <Route path="/settings" element={<SettingsPage part="food" />} />
        <Route path="/settings/advanced" element={<SettingsPage part="advanced" />} />
        <Route path="/doctor" element={<SettingsPage part="doctor" />} />
        <Route path="/more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
      {momTabs && <MomTabs pathname={pathname} />}
      <Alarm />
      {!mom && !momTabs && <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-x-auto lg:inset-y-0 lg:start-0 lg:w-60 lg:border-e lg:border-t-0 lg:pb-0">
        <div className="hidden items-center gap-3 px-5 pb-4 pt-6 lg:flex">
          <img src={`${import.meta.env.BASE_URL}icons/layan-logo-256.webp`} alt="" className="h-11 w-11 rounded-xl" />
          <div><div className="text-lg font-bold">{t('ليان')}</div><VersionTag /></div>
        </div>
        <ul className="mx-auto grid max-w-2xl grid-cols-5 lg:mx-0 lg:flex lg:max-w-none lg:flex-col lg:gap-1 lg:px-3">
          {TABS.map((tab) => {
            const on = tab.to === '/' ? pathname === '/' : tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
            return (
              <li key={tab.to}>
                <NavLink to={tab.to} aria-current={on ? 'page' : undefined} className="flex min-h-[56px] items-center justify-center py-1 lg:min-h-[48px] lg:justify-start lg:py-0">
                  <span className={cx('flex min-w-[60px] flex-col items-center gap-0.5 rounded-2xl px-2.5 py-1.5 text-xs transition-colors lg:w-full lg:flex-row lg:gap-3 lg:px-4 lg:py-3 lg:text-[15px]', on ? 'bg-brand-soft font-semibold text-brand' : 'text-slate-500 lg:hover:bg-slate-50')}><Icon name={tab.icon} active={on} />{t(tab.label)}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>}
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
  // push alerts follow this phone's language: send it every time the app opens signed in, so a language chosen
  // before signing in (or before the server kept it) still reaches the alerts
  const lang = useLang();
  useEffect(() => { if (member) void supabase.rpc('set_my_lang', { p_lang: lang }).then(() => undefined, () => undefined); }, [member, lang]);

  // a share link (#/s/<token>) is read-only and works without signing in
  const shared = location.hash.match(/^#\/s\/([0-9a-f]{48})$/);
  if (shared) return <Shared token={shared[1]} />;
  if (session === undefined) return null;
  let body;
  if (session && recovery) body = <SetPassword onDone={() => setRecovery(false)} />;
  else if (!session) body = <Login />;
  else if (problem) body = (
    <Centered>
      <Alert tone="over">{t('تعذّر الاتصال بقاعدة البيانات: {e}', { e: problem })}</Alert>
      <p className="text-sm text-slate-600">{t('إن كان الخطأ عن المخطط')} <span dir="ltr">carb</span>{t('، أضِفه في Supabase ← Settings ← API ← Exposed schemas.')}</p>
      <Btn block onClick={check}>{t('إعادة المحاولة')}</Btn>
    </Centered>
  );
  else if (member === null) body = null;
  else if (!member) body = <Claim onDone={check} />;
  else body = <DataProvider><Shell /></DataProvider>;
  return <>{body}<UpdateBanner /><Toaster /></>;
}
