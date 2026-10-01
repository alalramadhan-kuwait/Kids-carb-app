import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { sinceText } from '../lib/now';
import type { CarePlan } from '../lib/types';
import { Btn, Card, Field, Page, inputCls, toast } from '../components/ui';
import { t } from '../i18n';

// Arabic labels; translated with t() where shown.
const PARTS: { key: keyof Pick<CarePlan, 'hypo' | 'hyper' | 'sick_day' | 'contacts'>; label: string; hint: string }[] = [
  { key: 'hypo', label: 'عند الانخفاض', hint: 'كما كتبها الطبيب أو الممرضة' }, // i18n-ok
  { key: 'hyper', label: 'عند الارتفاع', hint: 'كما كتبها الطبيب أو الممرضة' }, // i18n-ok
  { key: 'sick_day', label: 'أيام المرض', hint: '' }, // i18n-ok
  { key: 'contacts', label: 'أرقام التواصل', hint: 'العيادة، الطوارئ، الطبيب' }, // i18n-ok
];

/** The family's own written plan from the clinic. The app never writes or changes its content. */
export default function CarePlanPage() {
  const nav = useNavigate();
  const { nameOf } = useData();
  const [plan, setPlan] = useState<CarePlan | null>(null);
  const [edit, setEdit] = useState<CarePlan | null>(null);
  const load = async () => { const { data } = await supabase.from('care_plan').select('*').eq('id', true).maybeSingle(); setPlan(data as CarePlan); };
  useEffect(() => { load(); }, []);
  const empty = plan && PARTS.every((p) => !plan[p.key]?.trim());

  const save = async () => {
    if (!edit) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('care_plan').update({ hypo: edit.hypo, hyper: edit.hyper, sick_day: edit.sick_day, contacts: edit.contacts,
      updated_by: u.user?.id, updated_at: new Date().toISOString() }).eq('id', true);
    if (error) return toast(error.message);
    toast(t('تم الحفظ ✓')); setEdit(null); load();
  };

  return (
    <Page title={t('خطة الطبيب')} back={() => nav(-1)} action={plan && !edit ? <Btn onClick={() => setEdit(plan)}>{t('تعديل')}</Btn> : undefined}>
      {!plan ? <Card><p className="text-slate-500">…</p></Card> : edit ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('انسخوها كما هي من خطة العيادة. التطبيق يعرضها فقط ولا يقترح شيئًا.')}</p>
          {PARTS.map((p) => (
            <Field key={p.key} label={t(p.label)} hint={p.hint ? t(p.hint) : ''}>
              <textarea className={inputCls + ' min-h-[120px]'} value={edit[p.key] ?? ''} onChange={(e) => setEdit({ ...edit, [p.key]: e.target.value })} />
            </Field>
          ))}
          <div className="grid grid-cols-[1fr_2fr] gap-2"><Btn kind="ghost" onClick={() => setEdit(null)}>{t('إلغاء')}</Btn><Btn kind="primary" onClick={save}>{t('حفظ')}</Btn></div>
        </div>
      ) : empty ? (
        <Card className="space-y-3 text-center">
          <p className="font-bold">{t('لم تُكتب الخطة بعد')}</p>
          <p className="text-sm text-slate-600">{t('اكتبوا خطة العيادة هنا لتظهر مع كل تنبيه.')}</p>
          <Btn kind="primary" block onClick={() => setEdit(plan)}>{t('اكتب الخطة')}</Btn>
        </Card>
      ) : (
        <div className="space-y-3">
          {PARTS.filter((p) => plan[p.key]?.trim()).map((p) => (
            <Card key={p.key}><h2 className="mb-1 font-bold">{t(p.label)}</h2><p className="whitespace-pre-wrap text-[17px] leading-relaxed">{plan[p.key]}</p></Card>
          ))}
          <p className="px-1 text-xs text-slate-400">{t('آخر تعديل {when}', { when: sinceText(plan.updated_at) })}{plan.updated_by ? ` · ${nameOf(plan.updated_by)}` : ''}</p>
        </div>
      )}
    </Page>
  );
}
