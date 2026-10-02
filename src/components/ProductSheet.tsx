import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { amountChoices, logProduct, portion } from '../lib/productLog';
import { deleteHistory } from '../lib/api';
import { fmt } from '../lib/carbs';
import type { Product } from '../lib/types';
import { TimePicker } from './TimePicker';
import { Icon } from './Icon';
import { Alert, Btn, NumInput, Photo, Sheet, cx, toast } from './ui';
import { t, tMaybe } from '../i18n';

/** A product tapped in the catalogue: log an amount of it at a chosen time, or edit it. */
export function ProductSheet({ p, onClose }: { p: Product | null; onClose: () => void }) {
  return (
    <Sheet open={!!p} onClose={onClose} title={p?.name ?? ''}>
      {p && <Body key={p.id} p={p} onClose={onClose} />}
    </Sheet>
  );
}

function Body({ p, onClose }: { p: Product; onClose: () => void }) {
  const nav = useNavigate();
  const { reload } = useData();
  const [mode, setMode] = useState<'choose' | 'log'>('choose');
  const choices = amountChoices(p);
  const [amount, setAmount] = useState<number | null>(choices[0]?.amount ?? null);
  const [at, setAt] = useState(Date.now());
  const [kind, setKind] = useState<'snack' | 'meal'>('snack');
  const [busy, setBusy] = useState(false);
  const u = p.unit === 'ml' ? t('مل') : t('غ');
  const x = amount && amount > 0 ? portion(p, amount) : null;
  const ok = !!x && amount! <= 3000 && p.approved;
  const label = (k: string, a: number) => (k === 'pack' ? t('العلبة ({a} {u})', { a: fmt(a), u }) : k === 'serving' ? t('حصة ({a} {u})', { a: fmt(a), u }) : `${fmt(a)} ${u}`);

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const id = await logProduct(p, amount!, at, kind);
      await reload(); onClose();
      toast(t('تم التسجيل: {x}', { x: `${p.name} · ${t('{g} غ', { g: fmt(x!.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Photo path={p.image_path} category={p.category} className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0 text-sm text-slate-600">
          <div>{p.brand ?? t('مرجعي')} · {tMaybe(p.category)}</div>
          <div><b className="num text-slate-800">{fmt(p.carbs_per_100)}</b> {p.unit === 'ml' ? t('غ/100مل') : t('غ/100غ')}</div>
        </div>
      </div>

      {mode === 'choose' ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMode('log')} className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl bg-brand text-white active:opacity-90">
            <Icon name="plus" size={22} /><span className="font-bold">{t('سجّل')}</span>
          </button>
          <button onClick={() => { onClose(); nav(`/products/${p.id}`); }} className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl bg-slate-50 text-slate-700 active:bg-slate-100">
            <Icon name="edit" size={22} /><span className="font-bold">{t('تعديل')}</span>
          </button>
        </div>
      ) : (
        <>
          {!p.approved && <Alert tone="near">{t('هذا المنتج غير معتمد: راجعوا الملصق واعتمدوه من «تعديل» قبل تسجيله.')}</Alert>}
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">{t('الكمية')}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {choices.map((c) => (
                <button key={c.key} onClick={() => setAmount(c.amount)} className={cx('min-h-[40px] rounded-full px-3.5 text-sm font-medium', amount === c.amount ? 'bg-brand text-white' : 'bg-slate-50 text-slate-700')}>{label(c.key, c.amount)}</button>
              ))}
              <div className="flex items-center gap-1">
                <NumInput className="!min-h-[40px] !w-20 !rounded-xl !px-2 !py-1.5 !text-center" value={choices.some((c) => c.amount === amount) ? null : amount} onChange={setAmount} placeholder={t('أخرى')} />
                <span className="text-sm text-slate-500">{u}</span>
              </div>
            </div>
          </div>
          {x && (
            <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand">
              <b className="num text-lg">{fmt(x.carbs)}</b> {t('غ كارب')}
              {x.kcal !== null && <> · <span className="num">{x.kcal}</span> {t('سعرة')}</>}
              {x.fat !== null && <> · {t('دهون')} <span className="num">{fmt(x.fat)}</span></>}
              {x.protein !== null && <> · {t('بروتين')} <span className="num">{fmt(x.protein)}</span></>}
            </p>
          )}
          <TimePicker value={at} onChange={setAt} />
          <div className="grid h-[40px] grid-cols-2 gap-1 rounded-xl bg-slate-50 p-1 text-sm">
            {(['snack', 'meal'] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={kind === k ? 'rounded-lg bg-white font-medium text-brand shadow-sm' : 'text-slate-500'}>{k === 'snack' ? t('سناك') : t('وجبة')}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn kind="ghost" onClick={() => setMode('choose')}>{t('رجوع')}</Btn>
            <Btn kind="primary" disabled={busy || !ok} onClick={save}>{busy ? t('جارٍ الحفظ…') : t('سجّل')}</Btn>
          </div>
        </>
      )}
    </div>
  );
}
