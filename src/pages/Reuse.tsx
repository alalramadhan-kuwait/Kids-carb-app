// A new meal from one already in the Log: pick it, change its amounts (or remove / add items), choose what it is and
// when, then save it and go straight to the insulin entry, where the dose calculator takes the new meal's carbs. The
// meal it came from is not changed. Two full pages, each with its own way back.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { fmt } from '../lib/carbs';
import { mealFrom } from '../lib/entrySave';
import { mealSlot, reusable } from '../lib/entryActions';
import { dayTitle, dayStartOf } from '../engine/day';
import { fmtTime } from '../lib/constants';
import type { HistoryEntry } from '../lib/types';
import { EditItems } from '../components/EditItems';
import { TimePicker } from '../components/TimePicker';
import { Card, Chip, Page, inputCls, toast } from '../components/ui';
import { isEn, t, tMaybe } from '../i18n';

/** The names a meal is logged under (as simple mode stores them), by time of day. */
export const MEAL_NAMES = ['فطور', 'غدا', 'عشا', 'سناك'] as const; // i18n-ok: stored names, shown via t()
const nameFor = (ms: number) => ({ breakfast: 'فطور', lunch: 'غدا', dinner: 'عشا', late: 'سناك' } as const)[mealSlot(ms)]; // i18n-ok

/** Step 1: which meal. */
export function ReusePick() {
  const nav = useNavigate();
  const { history } = useData();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const all = reusable(history), s = q.trim().toLowerCase();
    return s ? all.filter((h) => [h.name, tMaybe(h.name), ...h.lines.map((l) => l.name)].some((x) => x.toLowerCase().includes(s))) : all;
  }, [history, q]);
  return (
    <Page title={t('من وجبة سابقة')} back={() => nav(-1)}>
      <p className="mb-3 text-[15px] text-slate-600">{t('اختاري وجبة، وعدّلي كمياتها لوجبة جديدة. الوجبة القديمة تبقى كما هي.')}</p>
      <input type="search" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحثي بالاسم أو الصنف')} />
      <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {list.map((h) => (
          <li key={h.id}>
            <button onClick={() => nav(`/reuse/${h.id}`)} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-start active:bg-slate-50">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-medium"><bdi>{tMaybe(h.name)}</bdi></span>
                <span className="block truncate text-[14px] text-slate-500"><bdi>{h.lines.map((l) => tMaybe(l.name)).join(' · ')}</bdi></span>
                <span className="block text-[13px] text-slate-400">{dayTitle(dayStartOf(Date.parse(h.eaten_at)))} · {fmtTime(new Date(h.eaten_at))}</span>
              </span>
              <span className="num shrink-0 text-lg font-bold text-brand-num">{fmt(h.total_carbs)}<span className="text-xs font-medium"> {t('غ')}</span></span>
              <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
            </button>
          </li>
        ))}
      </ul>
      {!list.length && <Card className="mt-3"><p className="text-slate-500">{t('لا توجد وجبات فيها أصناف في آخر 30 يوم.')}</p></Card>}
    </Page>
  );
}

/** Step 2: change it, name it, time it, save, then the insulin entry. */
export function ReuseEdit() {
  const nav = useNavigate();
  const { id } = useParams();
  const { history, reload } = useData();
  const h = history.find((x) => x.id === id);
  const [at, setAt] = useState(() => Date.now());
  const [name, setName] = useState<string>(() => nameFor(Date.now()));
  if (!h) return <Page title={t('من وجبة سابقة')} back={() => nav(-1)}><Card><p className="text-slate-500">…</p></Card></Page>;
  return (
    <Page title={t('عدّلي لوجبة جديدة')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-slate-500">{t('من')}</span>
            <span className="block truncate text-[17px] font-bold"><bdi>{tMaybe(h.name)}</bdi></span>
            <span className="block text-[13px] text-slate-500">{dayTitle(dayStartOf(Date.parse(h.eaten_at)))} · {fmtTime(new Date(h.eaten_at))}</span>
          </span>
          <span className="num shrink-0 text-xl font-bold text-slate-400">{fmt(h.total_carbs)}<span className="text-xs font-medium"> {t('غ')}</span></span>
        </Card>
        <Card>
          <h2 className="mb-1 text-[17px] font-bold">{t('الأصناف والكميات')}</h2>
          <EditItems h={h} onCancel={() => nav(-1)} onDone={() => {}} saveLabel={t('احفظ واحسب الجرعة')}
            note={t('تنحفظ وجبة جديدة؛ القديمة لا تتغير. الكارب من ملصق كل منتج.')}
            extra={(
              <div className="space-y-3 pt-1">
                <div>
                  <div className="mb-1.5 text-[15px] font-bold">{t('شنو هذي؟')}</div>
                  <div className="flex flex-wrap gap-2">{MEAL_NAMES.map((n) => <Chip key={n} active={name === n} onClick={() => setName(n)}>{t(n)}</Chip>)}</div>
                </div>
                <div>
                  <div className="mb-1.5 text-[15px] font-bold">{t('متى أكلت؟')}</div>
                  <TimePicker value={at} onChange={setAt} />
                </div>
              </div>
            )}
            onSave={async (r) => {
              if (!r.lines.length) throw new Error(t('أبقوا صنفًا واحدًا على الأقل، أو احذفوا التسجيل كله'));
              await mealFrom(h, r, name, at);
              await reload();
              toast(t('انحفظت: {x}', { x: `${t(name)} · ${t('{g} غ', { g: fmt(r.carbs) })}` }));
              nav('/?log=insulin', { replace: true });
            }} />
        </Card>
      </div>
    </Page>
  );
}
