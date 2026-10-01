import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { Icon } from '../components/Icon';
import { computeMeal, fmt, problemText, unitText } from '../lib/carbs';
import { blocker } from '../lib/suggest';
import { acceptTotal, setFavorite, setRecipeImage } from '../lib/api';
import { uploadPhoto } from '../lib/supabase';
import type { Ingredient } from '../lib/types';
import { Alert, Badge, Btn, CarbBadge, Card, Chip, Nutrition, NumInput, Page, Photo, recipeArt, toast } from '../components/ui';
import { lineName, useChoose } from '../components/meal';
import { isEn, t, tMaybe } from '../i18n';

export function RecipeList() {
  const { candidates, settings } = useData();
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const cats = [...new Set(candidates.map((c) => c.recipe.category).filter(Boolean))] as string[];
  const rows = candidates.filter((c) => (!cat || c.recipe.category === cat) && c.recipe.name.includes(q));
  return (
    <Page title={t('الوصفات')} action={<Link to="/recipes/new" className="grid min-h-[44px] place-items-center rounded-xl bg-brand px-4 font-medium text-white">{t('+ إضافة وصفة')}</Link>}>
      <input className="mb-3 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3" placeholder={t('ابحث عن وصفة')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        <Chip active={!cat} onClick={() => setCat('')}>{t('الكل')}</Chip>
        {cats.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{tMaybe(c)}</Chip>)}
      </div>
      <div className="space-y-3">
        {rows.map(({ recipe, meal }) => {
          const why = blocker({ recipe, ings: [], meal }, settings);
          return (
            <Link key={recipe.id} to={`/recipes/${recipe.id}`}>
              <Card className="flex items-center gap-3 !p-3">
                <Photo path={recipe.image_path} category={recipe.category} art={recipeArt(recipe.category)} className="h-20 w-20 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 font-bold">{recipe.favorite && <span aria-label={t('مفضلة')} className="text-brand"><Icon name="heart" size={16} active /></span>}<span className="truncate">{recipe.name}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!recipe.approved ? <Badge tone="near">{t('تحت المراجعة')}</Badge> : why ? <Badge tone="near">{why}</Badge> : <Badge tone="ok">{t('جاهزة')}</Badge>}
                    {recipe.category && <Badge>{tMaybe(recipe.category)}</Badge>}
                  </div>
                </div>
                <CarbBadge carbs={meal.total.carbs} level={meal.level} unknown={!meal.complete} />
              </Card>
            </Link>
          );
        })}
        {rows.length === 0 && <Card><p className="text-slate-500">{t('لا توجد وصفات.')}</p></Card>}
      </div>
    </Page>
  );
}

export function RecipeView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { recipes, ingsByRecipe, products, settings, reload, history } = useData();
  const recipe = recipes.find((r) => r.id === id);
  const base = useMemo(() => ingsByRecipe.get(id ?? '') ?? [], [ingsByRecipe, id]);
  // quantities can be changed for this meal only; that logs as a modified meal
  const [over, setOver] = useState<Record<string, number>>({});
  const ings: Ingredient[] = useMemo(() => base.map((i) => (over[i.id] !== undefined ? { ...i, quantity: over[i.id] } : i)), [base, over]);
  const meal = useMemo(() => computeMeal(ings, products, settings), [ings, products, settings]);
  const { choose, busy } = useChoose();
  if (!recipe) return <Page title={t('الوصفة')} back={() => nav(-1)}><Card>{t('الوصفة غير موجودة.')}</Card></Page>;

  const modified = Object.keys(over).some((k) => over[k] !== base.find((i) => i.id === k)?.quantity);
  const drift = recipe.saved_total_carbs !== null && meal.complete && !modified && Math.abs(meal.total.carbs - recipe.saved_total_carbs) >= 0.05;
  const problems = meal.lines.filter((l) => l.problem);
  const roles = { main: t('الوجبة'), drink: t('المشروب'), snack: t('السناك') } as const;
  const hasDrink = ings.some((i) => i.role === 'drink');

  return (
    <Page title={recipe.name} back={() => nav(-1)}
      action={<button aria-label={t('مفضلة')} className="grid h-10 w-10 place-items-center rounded-full bg-white text-xl shadow-sm"
        onClick={async () => { await setFavorite(recipe.id, !recipe.favorite); await reload(); }}><span className="text-brand"><Icon name="heart" size={24} active={recipe.favorite} label={recipe.favorite ? t('إزالة من المفضلة') : t('إضافة للمفضلة')} /></span></button>}>
      <div className="relative mb-4">
        <Photo path={recipe.image_path} category={recipe.category} art={recipeArt(recipe.category)} className="h-52 w-full rounded-2xl" />
        <label className="absolute bottom-3 end-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/90 px-3 py-2 text-sm font-medium shadow">
          <Icon name="camera" size={20} /> {recipe.image_path ? t('تغيير الصورة') : t('إضافة صورة')}
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { await setRecipeImage(recipe.id, await uploadPhoto(f, 'recipes')); await reload(); toast(t('تم حفظ الصورة ✓')); }
            catch (er) { toast(t('تعذّر رفع الصورة: {err}', { err: (er as Error).message })); }
          }} />
        </label>
      </div>

      <Card className="mb-3 space-y-3">
        <div className="flex items-center justify-between">
          <CarbBadge carbs={meal.total.carbs} level={meal.level} size="lg" unknown={!meal.complete} />
          <div className="text-end text-sm text-slate-500">{recipe.approved ? <Badge tone="ok">{t('معتمدة')}</Badge> : <Badge tone="near">{t('تحت المراجعة')}</Badge>}</div>
        </div>
        {meal.complete && <Nutrition n={meal.total} partial={meal.nutritionPartial} />}
        {meal.complete && meal.level === 'near' && <Alert tone="near">{t('قريبة من الحد الأقصى ({max}غ).', { max: settings.max_meal_carbs })}</Alert>}
        {meal.complete && meal.level === 'over' && <Alert tone="over">{t('تحذير: الكارب {carbs}غ يتجاوز الحد ({max}غ). يمكن تسجيلها بعد تأكيد.', { carbs: fmt(meal.total.carbs), max: settings.max_meal_carbs })}</Alert>}
        {recipe.carb_pending && <Alert tone="near">{recipe.pending_note ?? t('الكارب غير مكتمل.')}</Alert>}
        {drift && (
          <Alert tone="info">
            <div className="flex items-center justify-between gap-2">
              <span>{t('تغيّر الحساب بعد تغيير منتج أو كمية.')}<br />{t('السابق:')} <span className="num font-bold">{fmt(recipe.saved_total_carbs)}</span> {t('غ')} {isEn() ? '→' : '←'} {t('الجديد:')} <span className="num font-bold">{fmt(meal.total.carbs)}</span> {t('غ')}</span>
              <Btn onClick={async () => { await acceptTotal(recipe.id, meal.total.carbs); await reload(); toast(t('تم اعتماد الحساب الجديد')); }}>{t('اعتماد')}</Btn>
            </div>
          </Alert>
        )}
        {problems.map((l) => (
          <Alert key={l.ing.id} tone="over">
            <b>{lineName(l)}:</b> {problemText(l.problem!)}{' '}
            {l.problem === 'no_product' && l.ing.slot_category && <Link className="underline" to={`/products/new?category=${encodeURIComponent(l.ing.slot_category)}`}>{t('إضافة المنتج')}</Link>}
            {(l.problem === 'unapproved' || l.problem === 'no_yield' || l.problem === 'no_serving') && l.product && <Link className="underline" to={`/products/${l.product.id}`}>{t('فتح المنتج')}</Link>}
          </Alert>
        ))}
      </Card>

      {(() => { const n = history.filter((h) => h.kind === 'meal' && h.recipe_id === recipe.id).length; return n > 0 && (
        <Link to={`/analysis?mode=meals&recipe=${recipe.id}`} className="mb-3 flex min-h-[52px] items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 shadow-sm">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-muted/70 text-brand"><Icon name="glucose" size={19} /></span>
          <span className="flex-1 font-medium">{t('كيف يستجيب سكرها لهذه الوصفة')}</span><span className="text-sm text-slate-500">{t('{n} مرة', { n })}</span><span className="text-slate-400">{isEn() ? '›' : '‹'}</span>
        </Link>); })()}
      <Card className="mb-3">
        <h2 className="mb-2 font-bold">{t('المكونات')}</h2>
        {(['main', 'drink', 'snack'] as const).map((role) => {
          const ls = meal.lines.filter((l) => l.ing.role === role);
          if (!ls.length) return null;
          return (
            <div key={role} className="mb-3 last:mb-0">
              <div className="mb-1 flex justify-between text-sm font-medium text-slate-500"><span>{roles[role]}</span><span><span className="num">{fmt(meal.byRole[role])}</span> {t('غ')}</span></div>
              <ul className="divide-y divide-slate-100">
                {ls.map((l) => (
                  <li key={l.ing.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{lineName(l)}</div>
                      <div className="truncate text-xs text-slate-500">
                        {l.product ? [l.product.name, l.product.brand].filter(Boolean).join(' — ') : '—'}
                        {l.product && !l.product.available && l.product.kind === 'commercial' ? ` • ${t('غير موجود بالبيت')}` : ''}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {l.ing.state !== 'as_is' && <Badge tone={l.ing.state === 'cooked' ? 'brand' : 'gray'}>{l.ing.state === 'cooked' ? t('الوزن بعد الطبخ') : t('الوزن قبل الطبخ')}</Badge>}
                        {!l.ing.qty_confirmed && <Badge tone="near">{t('كمية مبدئية')}</Badge>}
                        {l.ing.note && <span className="text-xs text-slate-400">{l.ing.note}</span>}
                      </div>
                    </div>
                    <div className="w-20 shrink-0"><NumInput aria-label={t('كمية {name}', { name: lineName(l) })} value={l.ing.quantity} onChange={(v) => v && setOver((o) => ({ ...o, [l.ing.id]: v }))} /></div>
                    <div className="w-10 shrink-0 text-xs text-slate-500">{unitText(l.ing.unit)}</div>
                    <div className="num w-14 shrink-0 text-end text-lg font-bold">{fmt(l.carbs)}</div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!hasDrink && <p className="mt-2 text-sm text-slate-500">{t('المشروب: ماء')}</p>}
        {modified && <div className="mt-2"><Alert tone="info">{t('عدّلتم الكميات لهذه المرة فقط. ستُسجَّل الوجبة كـ"معدّلة".')}</Alert> <Btn kind="ghost" className="mt-2" onClick={() => setOver({})}>{t('إرجاع الكميات الأصلية')}</Btn></div>}
      </Card>

      {recipe.instructions && <Card className="mb-3"><h2 className="mb-1 font-bold">{t('طريقة التحضير')}</h2><p className="whitespace-pre-line leading-loose text-slate-700">{recipe.instructions}</p></Card>}
      {recipe.notes && <Card className="mb-3"><h2 className="mb-1 font-bold">{t('ملاحظات')}</h2><p className="whitespace-pre-line text-slate-700">{recipe.notes}</p></Card>}

      <div className="grid grid-cols-2 gap-2">
        <Btn kind="primary" disabled={busy || !meal.complete}
          onClick={async () => { if (await choose({ kind: 'meal', recipe_id: recipe.id, name: recipe.name, category: recipe.category, meal, modified })) nav('/'); }}>{t('اخترناها اليوم')}</Btn>
        <Link to={`/recipes/${recipe.id}/edit`} className="grid min-h-[44px] place-items-center rounded-xl bg-white font-medium text-slate-700 ring-1 ring-slate-200">{t('تعديل')}</Link>
      </div>
    </Page>
  );
}
