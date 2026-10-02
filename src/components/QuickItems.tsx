import { useState } from 'react';
import { useData } from '../lib/data';
import { deleteQuick, logQuick, saveQuick, useQuickItems, type QuickItem } from '../lib/quick';
import { deleteHistory } from '../lib/api';
import { fmt } from '../lib/carbs';
import { Btn, Field, NumInput, Sheet, cx, inputCls, toast } from './ui';
import { KIND_STYLE } from '../lib/kinds';
import { t, tMaybe } from '../i18n';

/** أكل متكرر on the Meals tab: log with one tap; tap the name to correct it or remove it. */
export function QuickItemsSection() {
  const { reload } = useData();
  const { items, reload: reloadQuick } = useQuickItems();
  const [edit, setEdit] = useState<QuickItem | null>(null);
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;

  const log = async (q: QuickItem) => {
    setBusy(true);
    try {
      const id = await logQuick(q); await reload(); void reloadQuick();
      toast(t('تم التسجيل: {x}', { x: `${tMaybe(q.name)} · ${t('{g} غ', { g: fmt(q.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="mb-2 mt-6 text-lg font-bold">{t('أكل متكرر')}</h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {items.map((q) => (
          <li key={q.id} className="flex items-center gap-3 px-4 py-2">
            <button className="min-w-0 flex-1 text-start" onClick={() => setEdit(q)}>
              <bdi className="block truncate font-bold">{tMaybe(q.name)}</bdi>
              <span className="block text-xs text-slate-500"><span className="num">{fmt(q.carbs)}</span> {t('غ كارب')} · {t('{n} مرة', { n: q.uses })}</span>
            </button>
            <Btn kind="soft" className={cx('min-h-[44px] shrink-0 !px-4', KIND_STYLE.meal.soft)} disabled={busy} onClick={() => log(q)}>{t('سجّل')}</Btn>
          </li>
        ))}
      </ul>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? tMaybe(edit.name) : ''}>
        {edit && <QuickEdit q={edit} onDone={async () => { setEdit(null); await reloadQuick(); }} />}
      </Sheet>
    </>
  );
}

function QuickEdit({ q, onDone }: { q: QuickItem; onDone: () => void }) {
  const [name, setName] = useState(q.name);
  const [carbs, setCarbs] = useState<number | null>(q.carbs);
  const ok = !!name.trim() && carbs !== null && carbs >= 0 && carbs < 300;
  return (
    <div className="space-y-3">
      <Field label={t('الاسم')}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('الكارب للحصة (غ)')}><NumInput value={carbs} onChange={setCarbs} /></Field>
      {q.note && <p className="text-xs text-slate-500" dir="auto">{q.note}</p>}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Btn kind="danger" onClick={async () => { if (confirm(t('حذف من الأكل المتكرر؟'))) { await deleteQuick(q.id); onDone(); } }}>{t('حذف')}</Btn>
        <Btn kind="primary" disabled={!ok} onClick={async () => { try { await saveQuick(q.id, { name: name.trim(), carbs: carbs! }); toast(t('تم الحفظ ✓')); onDone(); } catch (e) { toast((e as Error).message); } }}>{t('حفظ')}</Btn>
      </div>
    </div>
  );
}
