import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { sinceText } from '../lib/now';
import { Alert, Btn, Card, Field, Page, inputCls, toast } from '../components/ui';
import { t } from '../i18n';
import { isShiftAccount, loginEmail, shownLogin } from '../lib/login';

type Acc = { user_id: string; display_name: string | null; email: string | null; last_sign_in_at: string | null; shared: boolean };
const ERR: Record<string, string> = { // i18n-ok: Arabic keys, translated with t() where shown
  bad_email: 'اسم المستخدم أو البريد غير صحيح', short_password: 'كلمة المرور 8 خانات على الأقل', email_taken: 'هذا البريد مستخدم لحساب آخر', // i18n-ok
  shared_account: 'هذا حساب تطبيق المناوبات: بريده ما يتغيّر من هنا', not_yourself: 'ما تقدر تشيل نفسك', not_allowed: 'غير مسموح', // i18n-ok
};

/** One call to the accounts function (carb-admin); its error turned into words. */
async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('carb-admin', { body });
  if (error) {
    let code = '';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? ''; } catch { /* no body */ }
    throw new Error(ERR[code] ? t(ERR[code]) : error.message);
  }
  return data;
}

/** More › Accounts: who uses Layan's app; add an account, change a name, email or password, take someone out. */
export function AccountsPage() {
  const nav = useNavigate();
  const { reload } = useData();
  const [list, setList] = useState<Acc[] | null>(null);
  const [me, setMe] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ name: '', email: '', password: '' });
  const load = async () => { try { const d = await call({ action: 'list' }); setList(d.members); setMe(d.me); } catch (e) { toast((e as Error).message); setList([]); } };
  useEffect(() => { void load(); }, []);
  const run = async (f: () => Promise<unknown>, ok: string) => { setBusy(true); try { await f(); toast(ok); await load(); await reload(); return true; } catch (e) { toast((e as Error).message); return false; } finally { setBusy(false); } };
  return (
    <Page title={t('الحسابات')} back={() => nav(-1)}>
      <div className="space-y-3">
        {list === null ? <p className="text-center text-slate-500">…</p> : list.map((a) => (
          <AccountCard key={a.user_id} a={a} me={a.user_id === me} open={open === a.user_id} busy={busy} onOpen={() => setOpen(open === a.user_id ? null : a.user_id)}
            onSave={(p) => run(() => call({ action: 'update', user_id: a.user_id, ...p }), t('تم الحفظ ✓')).then((ok) => ok && setOpen(null))}
            onRemove={() => { if (confirm(t('تشيلين {n} من تطبيق ليان؟ حسابه يبقى، وتسجيلاته تبقى في السجل.', { n: a.display_name || a.email || '' }))) void run(() => call({ action: 'remove', user_id: a.user_id }), t('تمت الإزالة ✓')); }} />
        ))}
        <Card className="space-y-3">
          <h2 className="font-bold">{t('إضافة حساب')}</h2>
          <Field label={t('الاسم')}><input className={inputCls} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder={t('مثلًا: ماما')} /></Field>
          <Field label={t('اسم المستخدم')} hint={t('قصير بالإنجليزي، مثل rawan. أو بريد إلكتروني.')}><input className={inputCls} dir="ltr" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} placeholder="rawan" /></Field>
          <Field label={t('كلمة المرور')} hint={t('8 خانات على الأقل. إذا البريد له حساب من قبل، ينضاف بكلمة مروره الحالية.')}>
            <input className={inputCls} dir="ltr" type="text" autoComplete="new-password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} />
          </Field>
          <Btn kind="primary" block disabled={busy || !add.email} onClick={async () => {
            setBusy(true);
            const email = loginEmail(add.email);
            if (!email) { toast(t('اسم المستخدم: حروف إنجليزية وأرقام، من 2 إلى 24')); setBusy(false); return; }
            try { const d = await call({ action: 'create', ...add, email }); toast(d.existing ? t('انضاف بحسابه الموجود ✓') : t('تم إنشاء الحساب ✓')); setAdd({ name: '', email: '', password: '' }); await load(); await reload(); }
            catch (e) { toast((e as Error).message); } finally { setBusy(false); }
          }}>{t('إضافة')}</Btn>
        </Card>
      </div>
    </Page>
  );
}

function AccountCard({ a, me, open, busy, onOpen, onSave, onRemove }: { a: Acc; me: boolean; open: boolean; busy: boolean; onOpen: () => void; onSave: (p: { name?: string; email?: string; password?: string }) => void; onRemove: () => void }) {
  const [name, setName] = useState(a.display_name ?? '');
  const [email, setEmail] = useState(shownLogin(a.email));
  const [pw, setPw] = useState('');
  useEffect(() => { setName(a.display_name ?? ''); setEmail(shownLogin(a.email)); setPw(''); }, [a, open]);
  const shift = isShiftAccount(a.email);
  return (
    <Card className="space-y-3">
      <button onClick={onOpen} className="flex w-full items-center gap-3 text-start">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-soft text-[18px] font-bold text-brand">{(a.display_name || a.email || '?').slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <b className="block truncate"><bdi>{a.display_name || '—'}</bdi>{me ? ` (${t('أنت')})` : ''}</b>
          <span dir="ltr" className="block truncate text-start text-sm text-slate-500">{shownLogin(a.email)}</span>
          <span className="block text-xs text-slate-400">{a.last_sign_in_at ? t('آخر دخول {when}', { when: sinceText(a.last_sign_in_at) }) : t('ما دخل بعد')}</span>
        </span>
        <span className="text-[14px] font-bold text-brand">{open ? t('إغلاق') : t('تعديل')}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <Field label={t('الاسم')}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('اسم المستخدم أو البريد')}><input className={inputCls} dir="ltr" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} disabled={shift} onChange={(e) => setEmail(e.target.value)} /></Field>
          {shift && <Alert tone="near">{t('هذا الحساب مشترك مع تطبيق المناوبات: كلمة المرور الجديدة تتغيّر هناك بعد.')}</Alert>}
          <Field label={t('كلمة مرور جديدة')} hint={t('اتركها فاضية إذا ما تبي تغيّرها')}><input className={inputCls} dir="ltr" type="text" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Btn kind="primary" block disabled={busy} onClick={() => {
            const next = email.trim() === shownLogin(a.email) ? null : loginEmail(email);
            if (email.trim() !== shownLogin(a.email) && !next) return toast(t('اسم المستخدم: حروف إنجليزية وأرقام، من 2 إلى 24'));
            onSave({ name, ...(next ? { email: next } : {}), ...(pw ? { password: pw } : {}) });
          }}>{t('حفظ')}</Btn>
          {!me && <Btn kind="ghost" block disabled={busy} onClick={onRemove}>✕ {t('إزالة من تطبيق ليان')}</Btn>}
        </div>
      )}
    </Card>
  );
}
