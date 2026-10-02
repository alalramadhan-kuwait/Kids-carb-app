import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { applyGluroo, existingFrom, planFrom, readGlurooFile, type ImportResult } from '../lib/importGluroo';
import type { GlurooPlan } from '../lib/gluroo';
import { formatGlucose } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { Alert, Btn, Card, Page, toast } from '../components/ui';
import { locale, t, tMaybe } from '../i18n';

const day = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);

/**
 * استيراد من Gluroo: pick the export (.zip or .csv), see exactly what will be added and what was left out, then
 * import. Importing the same export again adds nothing.
 */
export default function ImportPage() {
  const nav = useNavigate();
  const { events, history, settings, reload } = useData();
  const file = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<GlurooPlan | null>(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const unit = settings.glucose_unit;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setPlan(null); setDone(null);
    try { setPlan(planFrom(await readGlurooFile(f), existingFrom(events, history))); }
    catch (e) { setErr((e as Error).message === 'not_gluroo' || (e as Error).message === 'no_csv' ? t('هذا ليس ملف تصدير من Gluroo.') : (e as Error).message); }
  };
  const run = async () => {
    if (!plan) return;
    try { const r = await applyGluroo(plan, setStep); setDone(r); await reload(); toast(t('تم الاستيراد ✓')); }
    catch (e) { setErr((e as Error).message); } finally { setStep(null); }
  };

  const counts = useMemo(() => plan && {
    rapid: plan.events.filter((e) => e.kind === 'insulin' && e.insulin_type === 'rapid').length,
    long: plan.events.filter((e) => e.kind === 'insulin' && e.insulin_type === 'long').length,
    bg: plan.events.filter((e) => e.kind === 'bg_check').length,
    treat: plan.events.filter((e) => e.kind === 'treatment').length,
  }, [plan]);

  return (
    <Page title={t('استيراد من Gluroo')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <p className="text-sm text-slate-600">{t('في Gluroo: القائمة ← تصدير البيانات. اختاروا الملف هنا (zip أو csv). سترون كل ما سيُضاف قبل الاستيراد، والاستيراد مرة ثانية لا يكرر شيئًا.')}</p>
          <input ref={file} type="file" accept=".zip,.csv,text/csv,application/zip" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Btn kind={plan ? 'ghost' : 'primary'} block onClick={() => file.current?.click()}>{plan ? t('اختيار ملف آخر') : t('اختيار ملف التصدير')}</Btn>
          {err && <Alert tone="near">{err}</Alert>}
        </Card>

        {plan && counts && !done && (
          <>
            <Card className="space-y-2">
              <h2 className="font-bold">{t('سيُضاف')}</h2>
              <Row label={t('قراءات السكر')} value={plan.range ? t('{n} · {from} – {to}', { n: plan.readings.length, from: day(plan.range[0]), to: day(plan.range[1]) }) : '0'} hint={t('فقط الأوقات التي ليس فيها قراءة')} />
              <Row label={t('إنسولين سريع')} value={String(counts.rapid)} hint={t('«لوجبة» إذا سُجّل أكل قبلها بـ20 د أو بعدها بـ45 د، وإلا «تصحيح»')} />
              <Row label={t('تريسيبا')} value={String(counts.long)} />
              <Row label={t('وخز إصبع')} value={String(counts.bg)} />
              <Row label={t('علاج انخفاض')} value={String(counts.treat)} hint={t('عصير أو حلاوة 20 غ أو أقل والسكر تحت 4.4')} />
              <Row label={t('وجبات وسناكات')} value={String(plan.meals.length)} hint={t('ما سُجّل خلال 20 دقيقة يصبح وجبة واحدة')} />
              <Row label={t('أكل متكرر (يُسجَّل بضغطة)')} value={String(plan.quick.length)} />
            </Card>

            {plan.flagged.map((f) => (
              <Alert key={f.t} tone="near">{t('تريسيبا {u} وحدة سُجّلت مرة ثانية بعد {m} دقيقة من شخص آخر ({when}). لم تُستورد. تأكدوا أنها جرعة واحدة.', { u: f.amount, m: f.minutes, when: day(f.t) })}</Alert>
            ))}

            <Card className="space-y-2">
              <h2 className="font-bold">{t('سُجّل مرتين ({n})', { n: plan.doubles.length })}</h2>
              <p className="text-sm text-slate-600">{t('نفس الأكل مرة ثانية خلال 30 دقيقة (تقدير مصحَّح)، أو من الوالد الآخر خلال ساعة (نفس الطبق). يُحفظ الأخير فقط.')}</p>
              <details>
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-brand">{t('عرض التفاصيل')}</summary>
                <ul className="space-y-1 text-sm">
                  {plan.doubles.map((d, i) => (
                    <li key={i} className="flex justify-between gap-2"><span><bdi>{tMaybe(d.item.name)}</bdi> · <span className="num">{fmt(d.item.g)}</span> {t('غ')}</span><span className="text-slate-500">{day(d.item.t)} → <span className="num">{fmt(d.keptG)}</span> {t('غ')}</span></li>
                  ))}
                </ul>
              </details>
              {plan.skipped.length > 0 && <p className="text-sm text-slate-600">{t('موجود في التطبيق، لن يُكرَّر: {n}', { n: plan.skipped.length })}</p>}
            </Card>

            <Card className="space-y-2">
              <h2 className="font-bold">{t('الوجبات')}</h2>
              <details>
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-brand">{t('عرض {n} وجبة', { n: plan.meals.length })}</summary>
                <ul className="divide-y divide-slate-100 text-sm">
                  {plan.meals.map((m) => (
                    <li key={m.key} className="flex justify-between gap-3 py-1.5">
                      <span className="min-w-0"><bdi className="block">{m.items.map((i) => tMaybe(i.name)).join(' + ')}</bdi><span className="text-xs text-slate-500">{day(m.t)}{m.glucose ? ` · ${formatGlucose(m.glucose.mg, unit)}` : ''}</span></span>
                      <b className="num shrink-0">{fmt(m.carbs)} {t('غ')}</b>
                    </li>
                  ))}
                </ul>
              </details>
              <h3 className="pt-2 text-sm font-bold">{t('الأكل المتكرر')}</h3>
              <ul className="space-y-1 text-sm">
                {plan.quick.map((q) => <li key={q.name} className="flex justify-between gap-2"><bdi>{tMaybe(q.name)}</bdi><span><b className="num">{fmt(q.carbs)}</b> {t('غ')} <span className="text-xs text-slate-500">· {t('{n} مرة', { n: q.uses })}</span></span></li>)}
              </ul>
            </Card>

            <Btn kind="primary" block disabled={!!step} onClick={run}>{step ? t('جارٍ الاستيراد…') : t('استيراد')}</Btn>
          </>
        )}

        {done && (
          <Card className="space-y-2">
            <h2 className="font-bold">{t('تم الاستيراد')}</h2>
            <Row label={t('قراءات السكر')} value={String(done.readings)} />
            <Row label={t('إنسولين ووخز وعلاج')} value={String(done.events)} />
            <Row label={t('وجبات وسناكات')} value={String(done.meals)} />
            <Row label={t('أكل متكرر')} value={String(done.quick)} />
            <p className="text-xs text-slate-500">{t('ما كان موجودًا من قبل لم يُكرَّر.')}</p>
            <Link to="/timeline" className="flex min-h-[44px] items-center font-bold text-brand">{t('فتح السجل')}</Link>
          </Card>
        )}
      </div>
    </Page>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="min-w-0"><span className="block font-medium">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
      <b className="num shrink-0 text-end">{value}</b>
    </div>
  );
}
