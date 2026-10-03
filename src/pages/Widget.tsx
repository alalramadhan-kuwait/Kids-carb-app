import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { widgetLoader } from '../lib/widgetScript';
import { Alert, Btn, Card, Page, toast } from '../components/ui';
import { lang, t } from '../i18n';

const SCRIPTABLE = 'https://apps.apple.com/app/scriptable/id1405459188';
// the app's folder (where widget/layan-widget.js is served), whatever page it was opened on
const appUrl = () => new URL('.', location.href.split('#')[0]).href;

/**
 * ويدجت الآيفون: makes a read-only share link for the widget (a year, revocable from Share), builds the Scriptable
 * script with it inside and copies it. The link is shown once, here, and never leaves the phone otherwise.
 */
export default function WidgetPage() {
  const nav = useNavigate();
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_widget_link', { p_label: t('ويدجت الآيفون') });
      if (error) throw error;
      const s = widgetLoader({ url: import.meta.env.VITE_SUPABASE_URL as string, key: import.meta.env.VITE_SUPABASE_ANON_KEY as string, token: data as string, app: appUrl(), lang: lang() });
      setScript(s);
      try { await navigator.clipboard.writeText(s); toast(t('نُسخ السكربت ✓')); } catch { /* shown below to copy by hand */ }
    } catch (e) { toast(t('تعذّر إنشاء الرابط: {e}', { e: (e as Error).message })); } finally { setBusy(false); }
  };
  const copy = async () => { if (!script) return; try { await navigator.clipboard.writeText(script); toast(t('نُسخ السكربت ✓')); } catch { toast(t('حدّدوا النص وانسخوه يدويًا')); } };

  const steps = [
    t('ثبّتوا تطبيق Scriptable المجاني من App Store.'),
    t('اضغطوا «أنشئ الويدجت وانسخ السكربت» هنا.'),
    t('في Scriptable: اضغطوا +، الصقوا السكربت، وسمّوه «ليان»، ثم «تم».'),
    t('اضغطوا مطوّلًا على الشاشة الرئيسية ← + ← Scriptable، واختاروا الحجم. ثم اضغطوا على الويدجت ← Script ← «ليان».'),
  ];
  return (
    <Page title={t('ويدجت الآيفون')} back={() => nav(-1)}>
      <div className="space-y-3">
        <Card className="space-y-3">
          <p className="text-sm text-slate-600">{t('السكر الآن والسهم وعمر القراءة، والإنسولين والكارب الفعّالان (IOB وCOB)، على الشاشة الرئيسية أو شاشة القفل، مع رسم آخر 3 ساعات في الحجم المتوسط. يتحدّث الويدجت بنفسه عند تحديث التطبيق.')}</p>
          <ol className="space-y-2 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span><span className="pt-0.5">{s}</span></li>
            ))}
          </ol>
          <a href={SCRIPTABLE} target="_blank" rel="noreferrer" className="block text-sm font-bold text-brand">{t('Scriptable في App Store ←')}</a>
          <Btn kind="primary" block disabled={busy} onClick={make}>{t('أنشئ الويدجت وانسخ السكربت')}</Btn>
          {script && (
            <div className="space-y-2">
              <Alert tone="info">{t('نُسخ السكربت. فيه رابط خاص بالويدجت يظهر مرة واحدة فقط: لا ترسلوه لأحد.')}</Alert>
              <textarea readOnly dir="ltr" value={script} onFocus={(e) => e.currentTarget.select()} className="h-28 w-full rounded-xl border border-slate-200 p-2 font-mono text-[10px]" />
              <Btn block kind="ghost" onClick={copy}>{t('نسخ مرة أخرى')}</Btn>
            </div>
          )}
        </Card>
        <p className="px-1 text-xs leading-relaxed text-slate-500">
          {t('الويدجت يقرأ فقط ولا يسجّل شيئًا. الآيفون يحدّثه كل 5 إلى 15 دقيقة تقريبًا، فقد يتأخر عن التطبيق: التنبيهات تبقى من التطبيق. الرابط صالح سنة، ويمكن إيقافه من')}{' '}
          <Link to="/share" className="font-medium text-brand underline">{t('المشاركة والتقارير')}</Link>.
        </p>
      </div>
    </Page>
  );
}
