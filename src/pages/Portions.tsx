// Dad's screen: Layan's portions. Each product or recipe gets a few household measures («صحن ليان الصغير» = 30 g),
// weighed once with a kitchen scale. Mom mode shows only items that have portions. Also lists what Mom added and
// is waiting for a parent (unapproved products).
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { deletePortion, savePortion, usePortions } from '../lib/mom';
import { planMeal } from '../lib/plans';
import { portion } from '../lib/portion';
import { matches } from '../lib/search';
import { fmt } from '../lib/carbs';
import { Btn, Card, NumInput, Page, Photo, cx, inputCls, toast } from '../components/ui';
import { t, tMaybe } from '../i18n';
import type { Portion } from '../lib/types';

const QUICK = ['صحن ليان الصغير', 'صحن ليان الكبير', 'نص صحن', 'كوب ليان', 'حبة', 'ملعقة']; // i18n-ok: stored labels, shown via tMaybe

export function PortionList() {
  const nav = useNavigate();
  const { products, recipes } = useData();
  const { portions } = usePortions();
  const [tab, setTab] = useState<'products' | 'recipes'>('products');
  const [q, setQ] = useState('');
  const count = (kind: string, id: string) => portions.filter((p) => (kind === 'products' ? p.product_id === id : p.recipe_id === id)).length;
  const waiting = products.filter((p) => !p.approved);
  const rows = useMemo(() => (tab === 'products' ? products.filter((p) => p.approved) : recipes.filter((r) => r.approved))
    .filter((x) => matches([x.name, 'brand' in x ? x.brand : null, x.category], q))
    .sort((a, b) => count(tab, b.id) - count(tab, a.id) || a.name.localeCompare(b.name)), [tab, products, recipes, q, portions]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page title={t('كميات ليان')} back={() => nav('/more')}>
      <p className="mb-3 text-sm text-slate-500">{t('زِن بالميزان مرة وحدة. ماما تشوف الأسماء والصور بس.')}</p>
      {waiting.length > 0 && (
        <Card className="mb-3 space-y-1">
          <h2 className="font-bold">{t('ينتظرك')}</h2>
          {waiting.map((p) => <Link key={p.id} to={`/products/${p.id}`} className="flex min-h-[48px] items-center gap-3"><Photo path={p.image_path} category={p.category} className="h-10 w-10 rounded-lg" /><span className="flex-1 font-medium"><bdi>{tMaybe(p.name)}</bdi></span><span className="text-sm text-brand">{t('كمّل')}</span></Link>)}
        </Card>
      )}
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm">
        {(['products', 'recipes'] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={cx('min-h-[40px] rounded-full', tab === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'products' ? t('المنتجات') : t('الوصفات')}</button>)}
      </div>
      <input className={cx(inputCls, 'mb-3')} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث')} />
      <Card className="!p-0 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 120).map((x) => {
            const n = count(tab, x.id);
            return (
              <li key={x.id}><Link to={`/portions/${tab === 'products' ? 'product' : 'recipe'}/${x.id}`} className="flex min-h-[56px] items-center gap-3 px-3 py-1.5 active:bg-slate-50">
                <Photo path={x.image_path} category={x.category} className="h-11 w-11 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1 truncate font-medium"><bdi>{tMaybe(x.name)}</bdi></span>
                <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', n ? 'bg-ok-soft text-ok' : 'bg-slate-100 text-slate-500')}>{n ? t('{n} كميات', { n }) : t('بدون')}</span>
              </Link></li>
            );
          })}
        </ul>
      </Card>
    </Page>
  );
}

export function PortionEdit() {
  const nav = useNavigate();
  const { kind, id } = useParams() as { kind: 'product' | 'recipe'; id: string };
  const { products, recipes, ingsByRecipe, settings } = useData();
  const { portions } = usePortions();
  const product = kind === 'product' ? products.find((p) => p.id === id) ?? null : null;
  const recipe = kind === 'recipe' ? recipes.find((r) => r.id === id) ?? null : null;
  const mine = portions.filter((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id));
  // carbs of one recipe plate, from its ingredients now
  const plate = useMemo(() => {
    if (!recipe) return null;
    const items = (ingsByRecipe.get(recipe.id) ?? []).filter((i) => i.role !== 'snack').map((i) => ({ product_id: i.product_id, slot_category: i.slot_category, label: i.label, quantity: Number(i.quantity), unit: i.unit, state: i.state, role: i.role }));
    const m = planMeal(items, products, settings);
    return m.complete ? m.total.carbs : null;
  }, [recipe, ingsByRecipe, products, settings]);
  const unit = product ? (product.unit === 'ml' ? t('مل') : t('غ')) : t('صحن');
  const carbsOf = (amount: number | null) => (!amount ? null : product ? portion(product, amount).carbs : plate === null ? null : plate * amount);
  // a portion that looks wrong: almost no carbs from a carb food (a «شريحة» typed as 1 g), or far from the others
  const warn = (amount: number | null, self?: string) => {
    const c = carbsOf(amount);
    if (!amount || c === null) return null;
    if (product && Number(product.carbs_per_100) >= 5 && c < 2) return t('قليل وايد: {g} غ كارب. الكمية بالغرام مو بالحبة', { g: fmt(c) });
    const others = mine.filter((p) => p.id !== self).map((p) => Number(p.amount));
    if (others.length && (amount > 5 * Math.max(...others) || amount * 5 < Math.min(...others))) return t('بعيد وايد عن باقي الكميات · تأكد');
    return null;
  };
  const serving = product?.serving_size ? Number(product.serving_size) : null;
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  if (!product && !recipe) return <Page title={t('كميات ليان')} back={() => nav('/portions')}><p className="text-slate-500">…</p></Page>;
  const name = tMaybe((product ?? recipe)!.name);
  return (
    <Page title={name} back={() => nav('/portions')}>
      <div className="space-y-3">
        <Card className="flex items-center gap-3">
          <Photo path={(product ?? recipe)!.image_path} category={(product ?? recipe)!.category} className="h-16 w-16 rounded-xl" />
          <div className="text-sm text-slate-600">{product ? <><b className="num text-slate-900">{fmt(product.carbs_per_100)}</b> {product.unit === 'ml' ? t('غ/100مل') : t('غ/100غ')}</> : plate !== null ? t('الصحن الواحد {g} غ كارب', { g: fmt(Math.round(plate * 10) / 10) }) : t('كارب الوصفة غير مكتمل')}</div>
        </Card>
        <Card className="!p-0 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {mine.map((p) => <PortionRow key={p.id} p={p} unit={unit} carbsOf={carbsOf} warn={warn} busy={busy} run={run} />)}
            {!mine.length && <li className="p-3 text-sm text-slate-500">{t('ما في كميات بعد. ماما ما تشوف هذا الصنف لين تضيف كمية.')}</li>}
          </ul>
        </Card>
        <Card className="space-y-2">
          <h2 className="font-bold">{t('+ كمية جديدة')}</h2>
          <div className="flex flex-wrap gap-1.5">{QUICK.map((q) => <button key={q} onClick={() => setLabel(tMaybe(q))} className={cx('min-h-[36px] rounded-full px-3 text-sm', label === tMaybe(q) ? 'bg-brand text-white' : 'bg-slate-100')}>{tMaybe(q)}</button>)}</div>
          <input className={inputCls} dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('الاسم: صحن ليان الصغير')} maxLength={60} />
          {recipe && <p className="text-xs text-slate-500">{t('بالصحون: 1 = صحن واحد من الوصفة (حسب عدد الصحون فيها) · نص صحن = 0.5. الطبخ ما يغيّر الحساب.')}</p>}
          {serving && <div className="flex flex-wrap gap-1.5">{[1, 2].map((n) => <button key={n} onClick={() => { setAmount(serving * n); if (!label.trim()) setLabel(n === 1 ? tMaybe('حبة') : t('{n} حبات', { n })); }} className="min-h-[36px] rounded-full bg-brand-soft px-3 text-sm font-bold text-brand">{n === 1 ? t('حبة = {g} {u}', { g: fmt(serving), u: unit }) : t('{n} حبات = {g} {u}', { n, g: fmt(serving * n), u: unit })}</button>)}</div>}
          <div className="flex items-center gap-2">
            <NumInput value={amount} onChange={setAmount} className="!w-28 !text-center" placeholder={product ? '30' : '1'} />
            <span className="text-sm text-slate-500">{unit}</span>
            {carbsOf(amount) !== null && <span className="ms-auto text-sm text-brand">= <b className="num">{fmt(Math.round(carbsOf(amount)! * 10) / 10)}</b> {t('غ كارب')}</span>}
          </div>
          {warn(amount) && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm font-bold text-near">⚠️ {warn(amount)}</p>}
          <Btn kind="primary" block disabled={busy || !label.trim() || !amount || amount <= 0} onClick={() => run(async () => {
            await savePortion({ product_id: product?.id ?? null, recipe_id: recipe?.id ?? null, label, amount: amount!, photo_path: null, sort: mine.length });
            setLabel(''); setAmount(null); toast(t('حُفظ ✓'));
          })}>{t('حفظ')}</Btn>
        </Card>
      </div>
    </Page>
  );
}

function PortionRow({ p, unit, carbsOf, warn, busy, run }: { p: Portion; unit: string; carbsOf: (a: number | null) => number | null; warn: (a: number | null, self?: string) => string | null; busy: boolean; run: (f: () => Promise<void>) => void }) {
  const [label, setLabel] = useState(p.label);
  const [amount, setAmount] = useState<number | null>(Number(p.amount));
  const changed = label.trim() !== p.label || amount !== Number(p.amount);
  const c = carbsOf(amount);
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <input className={cx(inputCls, '!min-h-[40px]')} dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      <div className="flex items-center gap-2">
        <NumInput value={amount} onChange={setAmount} className="!min-h-[40px] !w-24 !text-center" />
        <span className="text-sm text-slate-500">{unit}</span>
        {c !== null && <span className="text-sm text-slate-600">= <b className="num">{fmt(Math.round(c * 10) / 10)}</b> {t('غ كارب')}</span>}
        <span className="ms-auto flex gap-1">
          {changed && <Btn kind="primary" className="!min-h-[40px] !px-3" disabled={busy || !label.trim() || !amount} onClick={() => run(() => savePortion({ ...p, label, amount: amount! }))}>{t('حفظ')}</Btn>}
          <Btn kind="ghost" className="!min-h-[40px] !px-3" disabled={busy} onClick={() => { if (window.confirm(t('تحذف «{x}»؟', { x: tMaybe(p.label) }))) run(() => deletePortion(p.id)); }}>{t('حذف')}</Btn>
        </span>
      </div>
      {warn(amount, p.id) && <p className="rounded-xl bg-near-soft px-3 py-1.5 text-xs font-bold text-near">⚠️ {warn(amount, p.id)}</p>}
    </li>
  );
}
