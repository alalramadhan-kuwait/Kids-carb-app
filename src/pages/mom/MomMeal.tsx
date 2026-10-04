// Mom mode, building a meal from Layan's database: saved meals, recipes and products (grouped, with pictures), each
// in one of its portions. Every choice is a full page; the meal being built is kept on the phone.
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { draftOps, saveMeal, useDraft, usePortions, useSavedMeals } from '../../lib/mom';
import { planMeal } from '../../lib/plans';
import { planItems, planItemsOf, readyForMom, type Catalog, type MomItem } from '../../engine/mom';
import { groupOf } from '../../lib/productGroups';
import { matches } from '../../lib/search';
import { fmt } from '../../lib/carbs';
import { supabase, uploadPhoto } from '../../lib/supabase';
import { Photo, cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, Choice, MomPage } from './MomUI';
import type { PlanItem } from '../../lib/types';

/** The catalogue Mom mode reads, and the carbs of any item or meal (null if any part is unknown). */
export function useCatalog() {
  const { products, recipes, ingsByRecipe, settings } = useData();
  const { portions } = usePortions();
  const c: Catalog = useMemo(() => ({ products, recipes, ingsByRecipe, portions }), [products, recipes, ingsByRecipe, portions]);
  const carbsOf = (items: PlanItem[] | null) => { if (!items) return null; const m = planMeal(items, products, settings); return m.complete ? Math.round(m.total.carbs * 10) / 10 : null; };
  const itemCarbs = (it: MomItem) => carbsOf(planItemsOf(it, c));
  const mealCarbs = (items: MomItem[]) => carbsOf(planItems(items, c));
  const nameOf = (it: { kind: 'product' | 'recipe'; id: string }) => tMaybe((it.kind === 'product' ? products : recipes).find((x) => x.id === it.id)?.name ?? '');
  const photoOf = (it: { kind: 'product' | 'recipe'; id: string }) => (it.kind === 'product' ? products : recipes).find((x) => x.id === it.id) ?? null;
  return { c, carbsOf, itemCarbs, mealCarbs, nameOf, photoOf };
}

const RECENT = 'mom-recent-v1';
const recent = (): { kind: 'product' | 'recipe'; id: string }[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]'); } catch { return []; } };
const remember = (x: { kind: 'product' | 'recipe'; id: string }) => {
  try { localStorage.setItem(RECENT, JSON.stringify([x, ...recent().filter((r) => !(r.kind === x.kind && r.id === x.id))].slice(0, 12))); } catch { /* blocked */ }
};

/** «وجبة ليان»: what is on her plate, the carb total (small), add more, then next. */
export function MomMeal() {
  const nav = useNavigate();
  const d = useDraft();
  const { itemCarbs, mealCarbs, nameOf, photoOf, c } = useCatalog();
  const { meals } = useSavedMeals();
  const total = mealCarbs(d.items);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const sameAsSaved = d.savedId && meals.find((m) => m.id === d.savedId && JSON.stringify(m.items) === JSON.stringify(d.items));
  const portionLabel = (it: MomItem) => it.portion_id ? tMaybe(c.portions.find((p) => p.id === it.portion_id)?.label ?? '')
    : `${fmt(it.amount ?? 0)} ${it.unit === 'serving' ? t('حصة') : it.unit === 'plate' ? t('صحن') : c.products.find((p) => p.id === it.id)?.unit === 'ml' ? t('مل') : t('غرام')}`;
  const Left = () => d.left.length ? <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[17px] font-bold text-over">⚠️ <bdi>{d.left.join(' · ')}</bdi> {t('ما ينحسب بالإبرة · كلّمي بابا')}</p> : null;
  const title = d.mode === 'plan' ? t('خطة وجبة') : t('وجبة ليان');
  if (!d.items.length) return (
    <MomPage title={title} back="/mom">
      <Left />
      {meals.length > 0 && <h2 className="text-[17px] font-bold text-slate-500">⭐ {t('وجباتها')}</h2>}
      {meals.slice(0, 6).map((m) => <Choice key={m.id} icon="⭐" label={m.name} sub={m.items.map((i) => nameOf(i)).join(' · ')} onClick={() => draftOps.load(m)} />)}
      <Big tone={meals.length ? 'soft' : 'primary'} onClick={() => nav(meals.length ? '/mom/add?tab=recipes' : '/mom/add')}>+ {t('شي ثاني')}</Big>
    </MomPage>
  );
  return (
    <MomPage title={d.name ?? title} back="/mom" foot={<Big disabled={total === null} onClick={() => nav(d.mode === 'plan' ? '/mom/when' : '/mom/dose')}>{d.mode === 'plan' ? `${t('التالي')} · 🕐 ${t('متى؟')}` : t('التالي')}</Big>}>
      <ul className="divide-y divide-slate-100 rounded-3xl border border-slate-100 bg-white px-3">
        {d.items.map((it, k) => {
          const g = itemCarbs(it), p = photoOf(it);
          return (
            <li key={k} className="flex items-center gap-3 py-2.5">
              <button onClick={() => nav(`/mom/item/${it.kind}/${it.id}?k=${k}`)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                <Photo path={p?.image_path} category={p?.category} className="h-14 w-14 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1"><b className="block truncate text-[18px]"><bdi>{nameOf(it)}</bdi></b><span className="text-[15px] text-slate-500"><bdi>{portionLabel(it)}</bdi></span></span>
                <span className="text-[15px] text-slate-500">{g === null ? '—' : g < 1 ? t('بدون كارب') : `${fmt(g)} ${t('غرام')}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Left />
      <div className="flex items-baseline justify-between px-1 text-slate-500"><span>{t('الكارب')}</span><b className="num text-[22px] text-slate-900">{total === null ? '—' : `${fmt(total)} ${t('غرام')}`}</b></div>
      <Big tone="soft" onClick={() => nav('/mom/add')}>+ {t('إضافة شي')}</Big>
      {!sameAsSaved && d.items.length > 1 && (naming ? (
        <div className="flex gap-2">
          <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('اسم الوجبة')} maxLength={40} autoFocus />
          <button className="min-h-[48px] shrink-0 rounded-2xl bg-brand px-4 font-bold text-white disabled:opacity-40" disabled={!name.trim()} onClick={async () => {
            try { await saveMeal({ name, emoji: null, items: d.items }); toast(t('انحفظت ⭐')); setNaming(false); } catch (e) { toast((e as Error).message); }
          }}>{t('حفظ')}</button>
        </div>
      ) : <button className="min-h-[44px] text-[16px] font-bold text-brand" onClick={() => setNaming(true)}>⭐ {t('احفظيها وجبة')}</button>)}
    </MomPage>
  );
}

/** «شنو بتاكل؟»: saved meals | recipes | products (grouped with pictures), most used first, search. Full page. */
export function MomAdd() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { meals } = useSavedMeals();
  const tab = (sp.get('tab') ?? (meals.length ? 'saved' : 'products')) as 'saved' | 'recipes' | 'products';
  const group = sp.get('g');
  const [q, setQ] = useState('');
  const { c, mealCarbs, nameOf } = useCatalog();
  const products = c.products.filter((p) => p.available !== false && readyForMom('product', p.id, c));
  const recipes = c.recipes.filter((r) => readyForMom('recipe', r.id, c));
  const rec = recent().filter((r) => readyForMom(r.kind, r.id, c)).slice(0, 6);
  const pick = (kind: 'product' | 'recipe', id: string) => nav(`/mom/item/${kind}/${id}`);
  const shown = products.filter((p) => (!group || groupOf(p.category).key === group) && matches([p.name, p.brand, p.category], q));
  const groups = [...new Map(products.map((p) => [groupOf(p.category).key, groupOf(p.category)])).values()];
  const missing = q.trim() && !shown.length && !recipes.some((r) => matches([r.name], q));
  const Tile = ({ kind, id }: { kind: 'product' | 'recipe'; id: string }) => {
    const x = (kind === 'product' ? c.products : c.recipes).find((y) => y.id === id)!;
    return (
      <button onClick={() => pick(kind, id)} className="flex flex-col items-center gap-1 rounded-2xl border border-slate-100 bg-white p-2 active:opacity-80">
        <Photo path={x.image_path} category={x.category} className="h-20 w-full rounded-xl" />
        <span className="line-clamp-2 text-center text-[15px] font-bold leading-tight"><bdi>{tMaybe(x.name)}</bdi></span>
      </button>
    );
  };
  return (
    <MomPage title={t('شنو بتاكل؟')} back="/mom/meal">
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-[15px]">
        {(['saved', 'recipes', 'products'] as const).map((k) => <button key={k} onClick={() => setSp({ tab: k }, { replace: true })} className={cx('min-h-[44px] rounded-full', tab === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'saved' ? t('وجباتها') : k === 'recipes' ? t('طبخ البيت') : t('أكل')}</button>)}
      </div>
      {tab === 'saved' && (meals.length ? meals.map((m) => {
        const g = mealCarbs(m.items);
        return <Choice key={m.id} icon="⭐" label={m.name} sub={m.items.map((i) => nameOf(i)).join(' · ')} onClick={() => { draftOps.load(m); nav('/mom/meal'); }} color={g === null ? '#e2e8f0' : undefined} />;
      }) : <p className="text-center text-slate-500">{t('ما في وجبات محفوظة بعد')}</p>)}
      {tab === 'recipes' && (recipes.length ? <div className="grid grid-cols-2 gap-2">{recipes.map((r) => <Tile key={r.id} kind="recipe" id={r.id} />)}</div> : <p className="text-center text-slate-500">{t('بابا ما جهّز وصفات بعد')}</p>)}
      {tab === 'products' && (
        <>
          <input className={inputCls} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحثي: كورن فليكس، توبي…')} />
          {!q && rec.length > 0 && !group && (<><h2 className="text-[16px] font-bold text-slate-500">{t('الأكثر')}</h2><div className="grid grid-cols-3 gap-2">{rec.map((r) => <Tile key={r.kind + r.id} kind={r.kind} id={r.id} />)}</div></>)}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
            <button onClick={() => setSp({ tab: 'products' }, { replace: true })} className={cx('min-h-[44px] shrink-0 rounded-full px-4 font-bold', !group ? 'bg-brand text-white' : 'bg-white')}>{t('الكل')}</button>
            {groups.map((gr) => <button key={gr.key} onClick={() => setSp({ tab: 'products', g: gr.key }, { replace: true })} className={cx('min-h-[44px] shrink-0 rounded-full px-4 font-bold', group === gr.key ? 'bg-brand text-white' : 'bg-white')}>{gr.emoji} {tMaybe(gr.label)}</button>)}
          </div>
          {(group ? [groups.find((x) => x.key === group)!].filter(Boolean) : groups).map((gr) => {
            const list = shown.filter((p) => groupOf(p.category).key === gr.key);
            if (!list.length) return null;
            return (<section key={gr.key}><h2 className="mb-1.5 text-[16px] font-bold text-slate-500">{gr.emoji} {tMaybe(gr.label)}</h2><div className="grid grid-cols-3 gap-2">{list.map((p) => <Tile key={p.id} kind="product" id={p.id} />)}</div></section>);
          })}
          {!products.length && <p className="text-center text-slate-500">{t('بابا ما جهّز الكميات بعد')}</p>}
        </>
      )}
      <Big tone="ghost" className={cx(missing ? '' : 'mt-auto')} onClick={() => nav('/mom/new')}>{t('مو موجود؟')}</Big>
    </MomPage>
  );
}

/** One item: its picture and label facts, Dad's portions first, then a label serving or grams (a recipe: plates).
 *  Nothing preselected unless changing an item already on the plate. */
export function MomPortion() {
  const nav = useNavigate();
  const { kind, id } = useParams() as { kind: 'product' | 'recipe'; id: string };
  const [sp] = useSearchParams();
  const k = sp.get('k');
  const d = useDraft();
  const { c, itemCarbs, nameOf, photoOf } = useCatalog();
  const mine = c.portions.filter((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id));
  const prod = kind === 'product' ? c.products.find((p) => p.id === id) ?? null : null;
  const ss = prod?.serving_size ? Number(prod.serving_size) : null;
  const gUnit = prod?.unit === 'ml' ? t('مل') : t('غرام');
  const cur = k !== null ? d.items[Number(k)] ?? null : null;
  // the choice: one of Dad's portions, or 'serving' / 'g' / 'plate' with an amount
  const [sel, setSel] = useState<string | null>(cur ? cur.portion_id ?? cur.unit ?? null : null);
  const [amt, setAmt] = useState<number | null>(cur && !cur.portion_id ? cur.amount ?? null : null);
  const free = sel === 'serving' || sel === 'g' || sel === 'plate';
  const item: MomItem | null = !sel ? null : free ? (amt && amt > 0 ? { kind, id, portion_id: null, amount: amt, unit: sel as 'serving' | 'g' | 'plate' } : null) : { kind, id, portion_id: sel };
  const g = item ? itemCarbs(item) : null;
  const x = photoOf({ kind, id });
  const pick = (v: string, a: number | null) => { setSel(v); setAmt(a); };
  const done = () => {
    if (!item || g === null) return;
    if (k !== null) draftOps.replace(Number(k), item); else draftOps.add(item);
    remember({ kind, id });
    nav('/mom/meal', { replace: true });
  };
  const carbsText = (v: number | null) => (v === null ? '' : v < 1 ? t('بدون كارب') : `${fmt(v)} ${t('غرام كارب')}`);
  const step = sel === 'g' ? (ss && ss < 40 ? 5 : 10) : 0.5;
  return (
    <MomPage title={nameOf({ kind, id })} foot={<>
      {item && g !== null && <div className="text-center text-[18px] font-bold text-brand">{carbsText(g)}</div>}
      <Big disabled={!item || g === null} onClick={done}>{k !== null ? t('تم') : t('إضافة')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white p-3">
        <Photo path={x?.image_path} category={x?.category} className="h-24 w-24 shrink-0 rounded-2xl" />
        {prod ? (
          <div className="space-y-0.5 text-[16px]">
            <div><b className="num">{fmt(Number(prod.carbs_per_100))}</b> {t('غرام كارب بكل 100 {u}', { u: gUnit })}</div>
            {ss && <div className="text-slate-600">{t('الحصة {s} {u} = {g}', { s: fmt(ss), u: gUnit, g: carbsText(itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'serving' })) })}</div>}
            {prod.brand && <div className="text-sm text-slate-500"><bdi>{prod.brand}</bdi></div>}
          </div>
        ) : <div className="text-[16px]">{t('الصحن الواحد = {g}', { g: carbsText(itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'plate' })) })}</div>}
      </div>
      <h2 className="text-[18px] font-bold">{t('كم؟')}</h2>
      {mine.map((p) => <Choice key={p.id} icon={p.photo_path ? <Photo path={p.photo_path} className="h-11 w-11" /> : '⭐'} label={tMaybe(p.label)} sub={carbsText(itemCarbs({ kind, id, portion_id: p.id }))} on={sel === p.id} onClick={() => pick(p.id, null)} />)}
      {prod && ss && <Choice icon="🥄" label={t('بالحصة')} sub={t('حصة = {s} {u}', { s: fmt(ss), u: gUnit })} on={sel === 'serving'} onClick={() => pick('serving', sel === 'serving' ? amt : 1)} />}
      {prod && <Choice icon="⚖️" label={prod.unit === 'ml' ? t('بالمل') : t('بالغرام')} on={sel === 'g'} onClick={() => pick('g', sel === 'g' ? amt : ss ?? null)} />}
      {!prod && <Choice icon="🍽️" label={t('بالصحون')} on={sel === 'plate'} onClick={() => pick('plate', sel === 'plate' ? amt : 1)} />}
      {free && (
        <div className="flex items-center justify-center gap-4">
          <button aria-label="+" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setAmt(Math.round(((amt ?? 0) + step) * 10) / 10)}>+</button>
          {sel === 'g'
            ? <input inputMode="decimal" dir="ltr" className={cx(inputCls, '!w-28 !text-center !text-[28px] font-bold')} value={amt ?? ''} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setAmt(e.target.value === '' || !Number.isFinite(v) ? null : v); }} />
            : <span className="num w-24 text-center text-[40px] font-extrabold">{amt === null ? '—' : fmt(amt)}</span>}
          <button aria-label="−" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setAmt(Math.max(0, Math.round(((amt ?? 0) - step) * 10) / 10))}>−</button>
          <span className="text-[18px] text-slate-500">{sel === 'g' ? gUnit : sel === 'serving' ? t('حصة') : t('صحن')}</span>
        </div>
      )}
      {k !== null && <button className="min-h-[44px] font-bold text-over" onClick={() => { draftOps.remove(Number(k)); nav('/mom/meal', { replace: true }); }}>{t('شيليه من الصحن')}</button>}
    </MomPage>
  );
}

/** Not in Layan's list: a photo and a name go to Dad; no dose is ever worked out for it. */
export function MomNew() {
  const nav = useNavigate();
  const { reload } = useData();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = async () => {
    setBusy(true);
    try {
      const photo = file ? await uploadPhoto(file, 'products') : null;
      const { error } = await supabase.from('products').insert({ name: name.trim(), brand: null, category: 'أخرى', kind: 'commercial', image_path: photo, unit: 'g', carbs_per_100: 0, approved: false, available: true, // i18n-ok: stored value
        notes: 'من ماما: ينتظر بابا يكمّل الملصق والكميات' }); // i18n-ok: stored note
      if (error) throw new Error(error.message);
      await reload(); setSent(true);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  if (sent) return (
    <MomPage title={t('انرسل لبابا ✓')} back="/mom/meal">
      <p className="text-center text-[18px] text-slate-600">{t('وبالحين؟')}</p>
      <Big onClick={() => { draftOps.leaveOut(name.trim()); nav('/mom/meal', { replace: true }); }}>{t('كمّلي الوجبة بدونه')}</Big>
      <Big tone="ghost" onClick={() => nav('/mom', { replace: true })}>{t('انتظري بابا')}</Big>
      <p className="mt-auto text-center text-sm text-slate-500">{t('ما نحسب إبرة لشي مو مؤكد')}</p>
    </MomPage>
  );
  return (
    <MomPage title={t('مو موجود')} back="/mom/add">
      <button onClick={() => input.current?.click()} className="grid h-48 place-items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white text-center">
        {file ? <img src={URL.createObjectURL(file)} alt="" className="h-44 rounded-2xl object-cover" /> : <span><span className="block text-5xl">📷</span><b className="text-[18px]">{t('صوّري الأكل أو الملصق')}</b></span>}
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('الاسم')} maxLength={60} />
      <Big disabled={busy || !name.trim()} onClick={send}>{t('أرسليه لبابا')}</Big>
    </MomPage>
  );
}
