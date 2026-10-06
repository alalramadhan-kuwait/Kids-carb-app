import { fmtTime } from '../lib/constants';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { amountChoices, logProduct, portion } from '../lib/productLog';
import { deleteEvent, deleteHistory, saveEvent } from '../lib/api';
import { supabase } from '../lib/supabase';
import { effectiveRange, formatGlucose } from '../lib/glucose';
const uuid = () => crypto.randomUUID();
import { fmt } from '../lib/carbs';
import type { Product } from '../lib/types';
import { TimePicker } from './TimePicker';
import { Icon } from './Icon';
import { Alert, Btn, NumInput, Photo, Sheet, cx, toast } from './ui';
import { t, tMaybe } from '../i18n';

/** A product tapped in the catalogue: log an amount of it at a chosen time, or edit it. */
export function ProductSheet({ p, onClose, start = 'choose' }: { p: Product | null; onClose: () => void; start?: 'choose' | 'log' }) {
  return (
    <Sheet open={!!p} onClose={onClose} title={p?.name ?? ''}>
      {p && <Body key={p.id} p={p} onClose={onClose} start={start} />}
    </Sheet>
  );
}

function Body({ p, onClose, start }: { p: Product; onClose: () => void; start: 'choose' | 'log' }) {
  const nav = useNavigate();
  const { reload, settings, me } = useData();
  const [mode, setMode] = useState<'choose' | 'log'>(start);
  const choices = amountChoices(p);
  const [amount, setAmount] = useState<number | null>(null); // nothing preselected: a tap on Save never logs a guessed 100 g
  const [at, setAt] = useState(Date.now());
  const [picked, setKind] = useState<'snack' | 'meal' | 'low' | null>(null);
  // was she low in the 30 minutes before the time it is logged for? then a small item is most likely a low treatment
  const low = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl).low ?? 70;
  const [wasLow, setWasLow] = useState<{ mg: number; at: number } | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from('glucose_readings').select('taken_at,mg_dl').gte('taken_at', new Date(at - 30 * 60000).toISOString()).lte('taken_at', new Date(at + 5 * 60000).toISOString()).order('mg_dl').limit(1)
      .then(({ data }) => { const r = (data ?? [])[0] as { taken_at: string; mg_dl: number } | undefined; if (live) setWasLow(r && r.mg_dl < low ? { mg: r.mg_dl, at: Date.parse(r.taken_at) } : null); });
    return () => { live = false; };
  }, [Math.floor(at / 60000), low]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const u = p.unit === 'ml' ? t('مل') : t('غ');
  const x = amount && amount > 0 ? portion(p, amount) : null;
  const ok = !!x && amount! <= 3000 && p.approved;
  const kind = picked ?? (wasLow && (!x || x.carbs <= 25) ? 'low' : 'snack');
  const label = (k: string, a: number) => (k === 'item' ? t('{n} حبة', { n: fmt(a / 100) }) : k === 'pack' ? t('العلبة ({a} {u})', { a: fmt(a), u }) : k === 'serving' ? t('حصة ({a} {u})', { a: fmt(a), u }) : `${fmt(a)} ${u}`);

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      if (kind === 'low') {
        // a low treatment is an event, not food: kept out of meals and shown in the treatments row
        const id = await saveEvent({ client_id: uuid(), kind: 'treatment', occurred_at: new Date(at).toISOString(), carbs_g: Math.round(x!.carbs * 10) / 10, treatment: p.name,
          insulin_units: null, insulin_type: null, bolus_purpose: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null });
        await reload(); onClose();
        toast(t('سُجّل علاج انخفاض: {x}', { x: `${p.name} · ${t('{g} غ', { g: fmt(x!.carbs) })}` }), id ? { label: t('تراجع'), run: async () => { await deleteEvent(id, me); await reload(); } } : undefined);
        return;
      }
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
          <div><b className="num text-slate-800">{fmt(p.carbs_per_100)}</b> {p.per_item ? t('غ كارب بالحبة') : p.unit === 'ml' ? t('غ/100مل') : t('غ/100غ')}</div>
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
            <div className="mb-1 text-xs font-medium text-slate-500">{t('الكمية')}{amount === null && <span className="text-over"> · {t('اختاروا الكمية')}</span>}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {choices.map((c) => (
                <button key={c.key} onClick={() => setAmount(c.amount)} className={cx('min-h-[40px] rounded-full px-3.5 text-sm font-medium', amount === c.amount ? 'bg-brand text-white' : 'bg-slate-50 text-slate-700')}>{label(c.key, c.amount)}</button>
              ))}
              {!p.per_item && <div className="flex items-center gap-1">
                <NumInput className="!min-h-[40px] !w-20 !rounded-xl !px-2 !py-1.5 !text-center" value={choices.some((c) => c.amount === amount) ? null : amount} onChange={setAmount} placeholder={t('أخرى')} />
                <span className="text-sm text-slate-500">{u}</span>
              </div>}
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
          <div className="space-y-1.5">
            <div className="grid h-[40px] grid-cols-2 gap-1 rounded-xl bg-slate-50 p-1 text-sm">
              {(['snack', 'meal'] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={kind === k ? 'rounded-lg bg-white font-medium text-brand shadow-sm' : 'text-slate-500'}>{k === 'snack' ? t('سناك') : t('وجبة')}</button>)}
            </div>
            <button onClick={() => setKind('low')} aria-pressed={kind === 'low'}
              className={cx('min-h-[44px] w-full rounded-xl border-2 text-sm font-bold', kind === 'low' ? 'border-over bg-over text-white' : 'border-over/40 text-over')}>{t('لعلاج انخفاض')}</button>
            {wasLow && <p className="text-xs text-slate-500">{t('السكر كان {v} الساعة {t}', { v: formatGlucose(wasLow.mg, settings.glucose_unit), t: fmtTime(new Date(wasLow.at)) })}</p>}
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
