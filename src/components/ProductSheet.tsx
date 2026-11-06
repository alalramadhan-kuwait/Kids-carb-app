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

/** the same, as a full page's content: Back leaves the page instead of returning to the choice */
export const ProductLog = ({ p, onDone, onBack }: { p: Product; onDone: () => void; onBack: () => void }) => <Body p={p} onClose={onDone} start="log" onBack={onBack} />;

function Body({ p, onClose, start, onBack }: { p: Product; onClose: () => void; start: 'choose' | 'log'; onBack?: () => void }) {
  const nav = useNavigate();
  const { reload, settings, me } = useData();
  const [mode, setMode] = useState<'choose' | 'log'>(start);
  const choices = amountChoices(p);
  // nothing preselected (a tap on Save never logs a guessed 100 g), except one piece of a food counted by the piece
  const [amount, setAmount] = useState<number | null>(() => (p.per_item ? choices.find((c) => c.key === 'item' && c.amount === 100)?.amount ?? null : null));
  const [at, setAt] = useState(Date.now());
  const [ago, setAgo] = useState<number | null>(0); // the time chips; null: «وقت آخر» (the full picker)
  const [picked, setKind] = useState<'meal' | 'low' | null>(null); // no snack-or-meal question: food is food
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
  // she was low then and it is a small item: asked (food or a low treatment?), never decided for them
  const ask = picked === null && !!wasLow && (!x || x.carbs <= 25);
  const kind = picked ?? 'meal';
  const label = (k: string, a: number) => (k === 'item' ? t('{n} حبة', { n: fmt(a / 100) }) : k === 'pack' ? t('العلبة ({a} {u})', { a: fmt(a), u }) : k === 'serving' ? t('حصة ({a} {u})', { a: fmt(a), u }) : `${fmt(a)} ${u}`);

  const save = async (withInsulin = false) => {
    if (!ok || ask) return;
    setBusy(true);
    try {
      if (kind === 'low') {
        // a low treatment is an event, not food: kept out of meals and shown in the treatments row
        const id = await saveEvent({ client_id: uuid(), kind: 'treatment', treat_purpose: 'low', occurred_at: new Date(at).toISOString(), carbs_g: Math.round(x!.carbs * 10) / 10, treatment: p.name,
          insulin_units: null, insulin_type: null, bolus_purpose: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null });
        await reload(); onClose();
        toast(t('سُجّل علاج انخفاض: {x}', { x: `${p.name} · ${t('{g} غ', { g: fmt(x!.carbs) })}` }), id ? { label: t('تراجع'), run: async () => { await deleteEvent(id, me); await reload(); } } : undefined);
        return;
      }
      const id = await logProduct(p, amount!, at, kind);
      // with insulin the page is left for the insulin entry (no Back first: it could undo the move)
      await reload(); if (!withInsulin) onClose();
      toast(t('تم التسجيل: {x}', { x: `${p.name} · ${t('{g} غ', { g: fmt(x!.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
      // the dose for it next: the insulin entry opens at the same time, for this meal (Now reads ?log=insulin&meal=)
      if (withInsulin) nav(`/?${new URLSearchParams({ log: 'insulin', at: String(at), meal: id, g: String(Math.round(x!.carbs * 10) / 10), n: p.name })}`);
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
          {/* when she ate: the usual answers as chips; «وقت آخر» opens the full clock */}
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">{t('متى أكلت؟')} <span className="num text-slate-700">· {fmtTime(new Date(at))}</span></div>
            <div className="grid grid-cols-5 gap-1.5">
              {[0, 15, 30, 60].map((m) => (
                <button key={m} onClick={() => { setAgo(m); setAt(Date.now() - m * 60000); }} className={cx('min-h-[44px] rounded-xl text-[13px] font-bold', ago === m ? 'bg-sky-500 text-white' : 'bg-slate-50 text-slate-700')}>
                  {m === 0 ? t('الآن') : m === 60 ? t('قبل ساعة') : t('قبل {m} د', { m })}
                </button>
              ))}
              <button onClick={() => setAgo(null)} className={cx('min-h-[44px] rounded-xl text-[13px] font-bold', ago === null ? 'bg-sky-500 text-white' : 'bg-slate-50 text-slate-700')}>{t('وقت آخر')}</button>
            </div>
            {ago === null && <div className="mt-2"><TimePicker value={at} onChange={setAt} /></div>}
          </div>
          {/* low then: asked, both answers one tap; otherwise a small switch */}
          {ask ? (
            <div className="space-y-2 rounded-2xl bg-over-soft p-3">
              <p className="text-sm font-bold text-over">{t('السكر كان {v} الساعة {t}. هذا علاج انخفاض؟', { v: formatGlucose(wasLow!.mg, settings.glucose_unit), t: fmtTime(new Date(wasLow!.at)) })}</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setKind('low')} className="min-h-[44px] rounded-xl bg-over text-sm font-bold text-white">{t('نعم، علاج انخفاض')}</button>
                <button onClick={() => setKind('meal')} className="min-h-[44px] rounded-xl bg-white text-sm font-bold">{t('لا، أكل')}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setKind(kind === 'low' ? 'meal' : 'low')} aria-pressed={kind === 'low'}
              className={cx('min-h-[40px] w-full rounded-xl text-sm font-bold', kind === 'low' ? 'bg-over text-white' : 'text-over')}>{kind === 'low' ? `✓ ${t('لعلاج انخفاض')}` : t('لعلاج انخفاض؟')}</button>
          )}
          {kind === 'low' ? (
            <Btn kind="primary" block disabled={busy || !ok || ask} onClick={() => void save()}>{busy ? t('جارٍ الحفظ…') : t('سجّل علاج الانخفاض')}</Btn>
          ) : (
            <div className="space-y-2">
              <button disabled={busy || !ok || ask} onClick={() => void save(true)} className="min-h-[54px] w-full rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 text-[16px] font-extrabold text-white shadow-lg shadow-violet-500/30 active:opacity-80 disabled:opacity-40">💉 {t('سجّل الأكل + إنسولين')}</button>
              <Btn block kind="ghost" disabled={busy || !ok || ask} onClick={() => void save()}>{t('الأكل فقط')}</Btn>
            </div>
          )}
          <button onClick={onBack ?? (() => setMode('choose'))} className="min-h-[40px] w-full text-sm text-slate-500">{t('رجوع')}</button>
        </>
      )}
    </div>
  );
}
