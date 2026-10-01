import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { suggest } from '../lib/suggest';
import { shoppingList } from '../lib/shopping';
import { fmt } from '../lib/carbs';
import { addPlan, deletePlan } from '../lib/api';
import { dayName, fmtDate, isoDate } from '../lib/constants';
import { t, tMaybe } from '../i18n';
import { Alert, Badge, Btn, Card, Field, NumInput, Page, cx, inputCls, toast } from '../components/ui';

export default function Plan() {
  const nav = useNavigate();
  const { plan, recipes, candidates, ingsByRecipe, products, settings, history, reload } = useData();
  const [days, setDays] = useState(3);
  const [people, setPeople] = useState<number | null>(2);
  const [start, setStart] = useState(isoDate(new Date()));
  const [draft, setDraft] = useState<{ date: string; recipe_id: string }[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const eligible = candidates.filter((c) => c.meal.complete && c.recipe.approved && !c.recipe.carb_pending && c.meal.total.carbs <= settings.max_meal_carbs);
  const dates = Array.from({ length: days }, (_, i) => { const d = new Date(start + 'T12:00:00'); d.setDate(d.getDate() + i); return d; });

  // fill the days one by one, never repeating the meal of the day before
  const auto = () => {
    const out: { date: string; recipe_id: string }[] = [];
    let prev: string[] = [];
    dates.forEach((d, i) => {
      const pick = suggest({ candidates, history, settings, today: d, count: 1, shuffle: i, avoid: prev })[0];
      if (pick) { out.push({ date: isoDate(d), recipe_id: pick.recipe.id }); prev = [pick.recipe.id]; }
    });
    setDraft(out);
    if (out.length < dates.length) toast(t('لا توجد وصفات جاهزة كافية لكل الأيام'));
  };
  const chosen = (date: string) => draft.find((x) => x.date === date)?.recipe_id ?? '';
  const choose = (date: string, recipe_id: string) => setDraft((d) => [...d.filter((x) => x.date !== date), ...(recipe_id ? [{ date, recipe_id }] : [])]);

  const save = async () => {
    if (!draft.length || !people) return;
    try {
      await addPlan(draft.map((d) => ({ plan_date: d.date, recipe_id: d.recipe_id, people })));
      await reload(); setDraft([]); toast(t('تم حفظ الخطة ✓'));
    } catch (e) { toast((e as Error).message); }
  };

  const todayIso = isoDate(new Date());
  const upcoming = plan.filter((p) => p.plan_date >= todayIso);
  const list = useMemo(() => shoppingList(upcoming, recipes, ingsByRecipe, products, settings), [upcoming, recipes, ingsByRecipe, products, settings]);
  const need = list.filter((i) => !i.available && !i.natural);
  const have = list.filter((i) => i.available || i.natural);

  const item = (i: (typeof list)[number]) => (
    <li key={i.key} className="flex items-center gap-3 py-2">
      <input type="checkbox" className="h-6 w-6 shrink-0" checked={ticked.has(i.key)} aria-label={i.name}
        onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })} />
      <div className={cx('min-w-0 flex-1', ticked.has(i.key) && 'text-slate-400 line-through')}>
        <div className="font-medium">{i.name}{i.brand ? ` — ${i.brand}` : ''}</div>
        {i.unresolved ? <div className="text-xs text-over">{t('لا يوجد منتج مسجّل — أضفه ليُحسب')}</div>
          : <div className="text-xs text-slate-500">{tMaybe(i.category)}{i.plated !== null ? ` • ${t('الوزن بعد الطبخ {n}', { n: fmt(i.plated) })}` : ''}</div>}
      </div>
      {!i.unresolved && <div className="text-end"><div className="num font-bold">{fmt(i.qty)} {i.unit === 'g' ? t('غ') : t('مل')}</div>{i.packs !== null && <div className="text-xs text-slate-500">≈ {t('{n} عبوة', { n: i.packs })}</div>}</div>}
    </li>
  );

  return (
    <Page title={t('خطة الأيام')} back={() => nav(-1)}>
      <Card className="mb-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('عدد الأيام')}><NumInput value={days} onChange={(v) => setDays(Math.min(14, Math.max(1, Math.round(v ?? 1))))} /></Field>
          <Field label={t('عدد الأشخاص')}><NumInput value={people} onChange={setPeople} /></Field>
          <Field label={t('من تاريخ')}><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        </div>
        <Btn kind="primary" block onClick={auto}>{t('اقترح وجبات للأيام')}</Btn>
        <div className="space-y-2">
          {dates.map((d) => (
            <div key={isoDate(d)} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-sm"><b>{dayName(d)}</b><div className="num text-xs text-slate-500">{fmtDate(d)}</div></div>
              <select aria-label={t('وجبة {day}', { day: dayName(d) })} className={inputCls} value={chosen(isoDate(d))} onChange={(e) => choose(isoDate(d), e.target.value)}>
                <option value="">—</option>
                {eligible.map((c) => <option key={c.recipe.id} value={c.recipe.id}>{c.recipe.name} ({t('{n}غ', { n: fmt(c.meal.total.carbs) })})</option>)}
              </select>
            </div>
          ))}
        </div>
        {eligible.length === 0 && <Alert tone="near">{t('لا توجد وصفات جاهزة بعد. أكمل بيانات المنتجات أولًا.')}</Alert>}
        <Btn kind="primary" block disabled={!draft.length || !people} onClick={save}>{t('حفظ الخطة')}</Btn>
      </Card>

      <h2 className="mb-2 text-lg font-bold">{t('الخطة المحفوظة')}</h2>
      <Card className="mb-4">
        {upcoming.length === 0 ? <p className="text-slate-500">{t('لا توجد خطة قادمة.')}</p> : (
          <ul className="divide-y divide-slate-100">
            {upcoming.map((p) => {
              const d = new Date(p.plan_date + 'T12:00:00');
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span><b>{dayName(d)}</b> <span className="num text-xs text-slate-500">{fmtDate(d)}</span> — {recipes.find((r) => r.id === p.recipe_id)?.name} <Badge>{t('{n} أشخاص', { n: p.people })}</Badge></span>
                  <button aria-label={t('حذف')} className="text-over" onClick={async () => { await deletePlan([p.id]); await reload(); }}>✕</button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 text-lg font-bold">{t('قائمة الشراء')}</h2>
      <Card>
        {list.length === 0 ? <p className="text-slate-500">{t('احفظ خطة لتظهر القائمة.')}</p> : (
          <>
            {need.length > 0 && <><div className="mb-1 text-sm font-bold text-over">{t('ينقصنا')}</div><ul className="mb-3 divide-y divide-slate-100">{need.map(item)}</ul></>}
            {have.length > 0 && <><div className="mb-1 text-sm font-bold text-ok">{t('موجود بالبيت / مكوّنات طبيعية')}</div><ul className="divide-y divide-slate-100">{have.map(item)}</ul></>}
            <p className="mt-3 text-xs text-slate-500">{t('الكميات = كمية الوجبة × عدد الأشخاص. المنتجات المطبوخة تظهر بوزنها قبل الطبخ إن كان معامل الطبخ مسجّلًا.')}</p>
          </>
        )}
      </Card>
    </Page>
  );
}
