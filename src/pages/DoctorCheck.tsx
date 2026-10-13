// Analysis → Patterns → «أرقام الطبيب والواقع»: how glucose went after meals and corrections, against what the doctor's
// saved numbers predicted when the dose was given. It shows outcomes only: never a new ratio, correction factor or dose,
// and nothing here reaches the dose calculator. The 2-hour result is an early outcome; clean observations are never
// pooled with affected ones; a correction that fell more or less than predicted is not proof about the ISF.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { useDoctorCheck } from '../lib/doctorCheck';
import { DC, GROUPS, WINDOWS, discrepancy, stat, type DoctorCheck as Check, type Confidence, type Flag, type Group, type LedgerRow, type Reason, type Window } from '../engine/doctorCheck';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import { Card, Sheet, cx } from '../components/ui';
import { isEn, t } from '../i18n';

export const GROUP_NAME: Record<Group, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', correction: 'التصحيح (إنسولين بدون أكل)' }; // i18n-ok: shown through t()
const GROUP_ICON: Record<Group, string> = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', correction: '💉' };
const GROUP_SHORT: Record<Group, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', correction: 'تصحيح بدون أكل' }; // i18n-ok: shown through t()
export const FLAG_NAME: Record<Flag, string> = { // i18n-ok: shown through t()
  overlap: 'إنسولين أو أكل من قبل لسه شغّال', tresiba: 'تريسيبا: السكر كان يتحرك لحاله قبلها', fatty: 'وجبة دسمة أو بروتين عالي', sensor: 'قراءات الحساس غير أكيدة', // i18n-ok
};
const FLAG_ICON: Record<Flag, string> = { overlap: '💉', tresiba: '🌙', fatty: '🍕', sensor: '📡' };
export const SENSOR_WHY: Record<string, string> = { day1: 'أول يوم للحساس', last_day: 'آخر يوم للحساس', gaps: 'نقص في القراءات', bias: 'الوخز يختلف عن الحساس' }; // i18n-ok: shown through t()
export const CONF_NAME: Record<Confidence, string> = { too_few: 'نظيفة قليلة', low: 'ثقة قليلة', moderate: 'ثقة متوسطة' }; // i18n-ok: shown through t()
/** Every reason a prediction can carry, with an icon and words, so nothing depends on colour alone. */
export const REASON: Record<Reason, { icon: string; name: string }> = { // i18n-ok: names shown through t()
  clean: { icon: '✅', name: 'نظيفة' }, overlap: { icon: '💉', name: 'إنسولين أو أكل قبلها لسه شغّال' }, tresiba: { icon: '🌙', name: 'تريسيبا: السكر يتحرك لحاله' }, // i18n-ok
  fatty: { icon: '🍕', name: 'وجبة دسمة' }, sensor: { icon: '📡', name: 'شك في الحساس' }, deleted: { icon: '🗑️', name: 'التسجيل انحذف' }, edited: { icon: '✏️', name: 'التسجيل انعدل بعدين' }, // i18n-ok
  food_near: { icon: '🍽️', name: 'أكل حول التصحيح' }, other_entry: { icon: '➕', name: 'أكل أو جرعة قبل ساعتين' }, no_data: { icon: '❔', name: 'ما في قراءة بعد ساعتين' }, pending: { icon: '⏳', name: 'ما مرّت ساعتين' }, // i18n-ok
};
/** The chart's shape for a dot's primary reason: a filled circle is clean; each factor has its own outline shape. */
const SHAPE: Partial<Record<Reason, 'circle' | 'square' | 'triangle' | 'diamond' | 'cross'>> = { clean: 'circle', overlap: 'square', tresiba: 'triangle', fatty: 'diamond', sensor: 'cross' };
const FACTORS: Flag[] = ['overlap', 'tresiba', 'fatty', 'sensor'];

/** A difference in the family's unit, with its sign. */
export const fmtDiff = (mg: number, unit: GlucoseUnit) => `${mg > 0 ? '+' : mg < 0 ? '−' : '±'}${formatGlucose(Math.abs(mg), unit)}`;
/** «ended X higher / lower / near», from a median difference. */
export function direction(mg: number, unit: GlucoseUnit, correction: boolean) {
  const u = unitLabel(unit), v = formatGlucose(Math.abs(mg), unit);
  if (Math.abs(mg) <= DC.near) return correction ? t('غالبًا نزل قريب من المتوقع') : t('غالبًا انتهى قريب من المتوقع');
  if (correction) return mg < 0 ? t('غالبًا نزل {v} {u} أكثر من المتوقع', { v, u }) : t('غالبًا نزل {v} {u} أقل من المتوقع', { v, u });
  return mg > 0 ? t('غالبًا انتهى {v} {u} أعلى من المتوقع', { v, u }) : t('غالبًا انتهى {v} {u} أقل من المتوقع', { v, u });
}

export function DoctorCheck() {
  const { settings } = useData();
  const { g } = useGlucose();
  const sensorStart = g?.sensor?.started_at ? Date.parse(g.sensor.started_at) : null;
  const { check, error } = useDoctorCheck(sensorStart);
  const [win, setWin] = useState<Window>(30);
  const [mode, setMode] = useState<'clean' | 'observed'>('clean');
  const [h, setH] = useState<'early' | 'late'>('early');
  const [dot, setDot] = useState<LedgerRow | null>(null);
  const [all, setAll] = useState(false);
  const [info, setInfo] = useState(false);
  const unit = settings.glucose_unit;
  const seg = (on: boolean) => cx('min-h-[40px] flex-1 rounded-full text-sm font-bold', on ? 'bg-white text-brand shadow-sm' : 'text-slate-500');
  return (
    <div className="space-y-3">
      <NumbersStrip check={check} onInfo={() => setInfo(true)} />
      <div className="flex gap-2">
        <div className="flex flex-[3] rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={t('المدة')}>
          {WINDOWS.map((w) => <button key={w} role="radio" aria-checked={win === w} aria-label={t('{n} يوم', { n: w })} onClick={() => setWin(w)} className={seg(win === w)}>{t('{n}ي', { n: w })}</button>)}
        </div>
        <div className="flex flex-[4] rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={t('العرض')}>
          <button role="radio" aria-checked={mode === 'clean'} onClick={() => setMode('clean')} className={seg(mode === 'clean')}>{t('نظيفة')}</button>
          <button role="radio" aria-checked={mode === 'observed'} onClick={() => setMode('observed')} className={seg(mode === 'observed')}>{t('الملاحظ')}</button>
        </div>
      </div>
      {error && <p className="px-1 text-sm text-over">{t('تعذّر تحميل البيانات: {e}', { e: error })}</p>}
      {!check && !error && <p className="px-1 py-6 text-center text-slate-500">{t('جاري التحميل…')}</p>}
      {check && (mode === 'clean'
        ? <CleanChart check={check} win={win} h={h} setH={setH} unit={unit} onDot={setDot} onInfo={() => setInfo(true)} />
        : <ObservedChart check={check} win={win} unit={unit} onDot={setDot} onInfo={() => setInfo(true)} />)}
      {check && <LedgerCard rows={rowsIn(check, win)} onOpen={() => setAll(true)} />}
      <p className="px-2 pb-4 text-center text-xs text-slate-500">{t('للنقاش مع الطبيب · ما يغيّر أي جرعة')}</p>
      <Sheet open={!!dot} onClose={() => setDot(null)} title={dot ? t(GROUP_NAME[dot.group]) : ''}>
        {dot && <DotDetail r={dot} unit={unit} />}
      </Sheet>
      <Sheet open={all} onClose={() => setAll(false)} title={t('كل التوقعات')}>
        {check && <LedgerList rows={rowsIn(check, win)} unit={unit} onPick={(r) => { setAll(false); setDot(r); }} />}
      </Sheet>
      <Sheet open={info} onClose={() => setInfo(false)} title={t('كيف تقرون الرسم')}>
        <div className="space-y-3 pb-4 text-[14px] text-slate-700">
          <ul className="space-y-1.5">
            <li>{t('كل علامة = وجبة أو تصحيح: يسار = السكر انتهى أقل من المتوقع، يمين = أعلى. الشريط الأخضر = قريب (±1.5). اضغطوا أي علامة للتفاصيل.')}</li>
            <li>{t('«نظيفة»: ما في شي ثاني معروف يأثر. هي بس اللي تنحسب، والدائرة = كم وحدة من ٥ نحتاجها.')}</li>
            <li>{t('«الملاحظ»: كل نتائج الساعتين، فيها المتأثرة، مقسومة حسب الأرقام اللي كانت محفوظة وقتها. وصف بس: ما ينحسب منها أي رقم، وما تقول إن رقم معيّن صح أو غلط.')}</li>
            <li>{t('التوقعات اللي السجل تغيّر بعدها، أو فيها أكل أو جرعة قبل ساعتين، ما تطلع في أي رسم. تنعد تحت مع السبب.')}</li>
            <li>{t('٢ س = نتيجة مبكرة، مو حكم على النسبة. ٣–٥ س لحالها.')}</li>
          </ul>
          <DoctorNumbers />
          {check && <PeriodNotes check={check} unit={unit} />}
        </div>
      </Sheet>
    </div>
  );
}

const rowsIn = (check: Check, win: Window) => check.ledger.filter((r) => r.t0 >= check.to - win * 86400000);

/** The doctor's numbers in one line; the warning and the changes in the period as small marks, details behind ⓘ. */
function NumbersStrip({ check, onInfo }: { check: Check | null; onInfo: () => void }) {
  const { settings } = useData();
  const unit = settings.glucose_unit;
  const ratios = [...(settings.ratios ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  const diff = discrepancy(ratios);
  const isfs = [...new Set(ratios.map((r) => r.isf))];
  const spans = check?.spans ?? [];
  const total = spans.length ? Math.max(1, spans[spans.length - 1].last - spans[0].first) : 1;
  return (
    <button onClick={onInfo} className="block w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-start active:bg-slate-50">
      <span className="flex items-center gap-2">
        <span aria-hidden>🩺</span>
        <span className="num min-w-0 flex-1 truncate text-[15px] font-bold" dir="ltr">
          {ratios.map((r) => `1:${fmt(r.cr)}`).join(' · ')} · ISF {isfs.map((x) => formatGlucose(x, unit)).join('/')}
        </span>
        {diff && <span className="shrink-0 rounded-full bg-near-soft px-2 py-0.5 text-xs font-bold text-near">⚠ {t('تأكدوا')}</span>}
        <span aria-label={t('شرح')} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">i</span>
      </span>
      {spans.length > 1 && (
        <span className="mt-1.5 flex h-5 gap-0.5 overflow-hidden rounded-md text-[10.5px] font-bold" dir="ltr" aria-label={t('الأرقام المحفوظة تغيّرت خلال هذي الفترة')}>
          {spans.map((x, i) => (
            <span key={i} className={cx('grid place-items-center text-white', ['bg-slate-400', 'bg-near-fill', 'bg-brand'][Math.min(2, spans.length - 1 - i === 0 ? 2 : i)])}
              style={{ flex: Math.max(0.12, (x.last - x.first) / total) }}>ISF {formatGlucose(x.isf, unit)}</span>
          ))}
        </span>
      )}
    </button>
  );
}

const RING_N = DC.minN;
function Ring({ n, median, unit }: { n: number; median: number | null; unit: GlucoseUnit }) {
  const r = 15, c = 2 * Math.PI * r, f = Math.min(1, n / RING_N), done = n >= RING_N && median !== null;
  const tone = !done ? 'text-slate-400' : Math.abs(median!) <= DC.near ? 'text-ok' : median! > 0 ? 'text-near' : 'text-over';
  return (
    <span className={cx('relative grid h-11 w-11 shrink-0 place-items-center', tone)}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${f * c} ${c}`} />
      </svg>
      <b className="num relative text-[11.5px] leading-none" dir="ltr">{done ? fmtDiff(median!, unit) : `${n}/${RING_N}`}</b>
    </span>
  );
}

const W = 320, R = 108;
const X = (mg: number) => ((Math.max(-R, Math.min(R, mg)) + R) / (2 * R)) * (W - 16) + 8;
/** One mark: its shape says the primary reason (never colour alone); its colour says lower / near / higher. */
function Mark({ x, y, reason, d, onTap }: { x: number; y: number; reason: Reason; d: number; onTap?: () => void }) {
  const col = Math.abs(d) <= DC.near ? 'rgb(var(--st-in))' : d > 0 ? 'rgb(var(--st-high))' : 'rgb(var(--st-low))';
  const sh = SHAPE[reason] ?? 'circle', s = 4.6, line = { fill: 'rgb(var(--surface))', stroke: col, strokeWidth: 2 };
  const el = sh === 'circle' ? <circle cx={x} cy={y} r={s} fill={col} stroke="rgb(var(--surface))" strokeWidth={1.2} />
    : sh === 'square' ? <rect x={x - s + 0.6} y={y - s + 0.6} width={2 * s - 1.2} height={2 * s - 1.2} {...line} />
      : sh === 'triangle' ? <path d={`M${x} ${y - s - 0.6} L${x + s + 0.6} ${y + s - 0.4} L${x - s - 0.6} ${y + s - 0.4}Z`} {...line} />
        : sh === 'diamond' ? <path d={`M${x} ${y - s - 0.8} L${x + s + 0.8} ${y} L${x} ${y + s + 0.8} L${x - s - 0.8} ${y}Z`} {...line} />
          : <path d={`M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}`} stroke={col} strokeWidth={2.4} strokeLinecap="round" />;
  return onTap ? <g onClick={onTap} style={{ cursor: 'pointer' }} role="button">{el}<circle cx={x} cy={y} r={12} fill="transparent" /></g> : el;
}

/** One strip: the green "near" band, zero, the marks (spread up and down where they meet), and the median as a bar. */
function Strip({ rows, h, median, onDot }: { rows: LedgerRow[]; h: 'early' | 'late'; median?: number | null; onDot?: (r: LedgerRow) => void }) {
  const stack = new Map<number, number>();
  return (
    <svg viewBox={`0 0 ${W} 30`} width="100%" height={30} direction="ltr" className="-mt-0.5 block" aria-hidden={!onDot}>
      <rect x={X(-DC.near)} y={3} width={X(DC.near) - X(-DC.near)} height={24} rx={4} fill="rgb(var(--st-in))" fillOpacity={0.18} />
      <line x1={8} x2={W - 8} y1={15} y2={15} stroke="currentColor" strokeOpacity={0.12} />
      <line x1={X(0)} x2={X(0)} y1={1} y2={29} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
      {median != null && <rect x={X(median) - 1.5} y={2} width={3} height={26} rx={1.5} fill="currentColor" fillOpacity={0.75} />}
      {rows.map((r) => {
        const d = r[h]!.diff, k = Math.round(X(d) / 8), n = stack.get(k) ?? 0; stack.set(k, n + 1);
        return <Mark key={r.key} x={X(d)} y={15 + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 7} reason={r.primary} d={d} onTap={onDot ? () => onDot(r) : undefined} />;
      })}
    </svg>
  );
}

function Axis() {
  return <div className="flex justify-between px-1 pt-0.5 text-[11px] text-slate-500" dir="ltr"><span>◀ {t('انتهى أقل')}</span><span>{t('انتهى أعلى')} ▶</span></div>;
}

function Legend({ items, onInfo, extra }: { items: Reason[]; onInfo?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-[11.5px] text-slate-600">
      {items.map((r) => (
        <span key={r} className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="overflow-visible"><Mark x={7} y={7} reason={r} d={r === 'clean' ? 0 : 60} /></svg>
          {t(SHORT[r] ?? REASON[r].name)}{/* i18n-ok: table values */}
        </span>
      ))}
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm bg-[rgb(var(--st-in)/0.25)]" />±1.5</span>
      {extra}
      {onInfo && <button onClick={onInfo} aria-label={t('شرح')} className="ms-auto grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-bold text-slate-500">i</button>}
    </div>
  );
}
const SHORT: Partial<Record<Reason, string>> = { clean: 'نظيفة', overlap: 'إنسولين قبلها', tresiba: 'تريسيبا', fatty: 'دسمة', sensor: 'الحساس', deleted: 'انحذف', edited: 'انعدل بعدين', food_near: 'أكل حولها', other_entry: 'أكل/جرعة قبل ٢ س', no_data: 'ما في قراءة ٢ س', pending: 'ما مرّت ٢ س' }; // i18n-ok: shown through t()

/** Clean only: one strip per meal time, the ring = clean ones out of the 5 needed; the median bar from 5. */
export function CleanChart({ check, win, h, setH, unit, onDot, onInfo, print }: { check: Check; win: Window; h: 'early' | 'late'; setH?: (h: 'early' | 'late') => void; unit: GlucoseUnit; onDot?: (r: LedgerRow) => void; onInfo?: () => void; print?: boolean }) {
  const rows = rowsIn(check, win).filter((r) => r.status === 'clean' && r[h]);
  return (
    <Card className={cx('space-y-1 !px-3 !py-2.5', print && 'mx-auto max-w-[400px]')}>
      {print && <b className="block text-[13px]">{t('نظيفة')} · {h === 'early' ? t('٢ س') : t('٣–٥ س')}</b>}
      <Legend items={['clean']} onInfo={onInfo} extra={setH && (
        <span className="flex rounded-full bg-slate-100 p-0.5">
          {(['early', 'late'] as const).map((k) => <button key={k} onClick={() => setH(k)} aria-pressed={h === k} className={cx('min-h-[32px] rounded-full px-2.5 text-[12px] font-bold', h === k ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}>{k === 'early' ? t('٢ س') : t('٣–٥ س')}</button>)}
        </span>
      )} />
      {GROUPS.map((g) => {
        const mine = rows.filter((r) => r.group === g), st = stat(mine.map((r) => r[h]!.diff));
        return (
          <div key={g} className="border-t border-slate-100 pt-1">
            <span className="flex items-center gap-2">
              <span aria-hidden>{GROUP_ICON[g]}</span>
              <b className="min-w-0 flex-1 truncate text-[14.5px]">{t(GROUP_SHORT[g])}</b>
              <Ring n={st.n} median={st.n >= RING_N ? st.median : null} unit={unit} />
            </span>
            <Strip rows={mine} h={h} median={st.n >= RING_N ? st.median : null} onDot={onDot} />
          </div>
        );
      })}
      <Axis />
    </Card>
  );
}

/** Observed: every 2-hour outcome that is still valid, clean and affected, each meal time split by the doctor's numbers in
 *  force then (never pooled across a change). Descriptive only: a median is drawn from 5 on one line, and nothing here
 *  says that any number is right or wrong. */
export function ObservedChart({ check, win, unit, onDot, onInfo, print }: { check: Check; win: Window; unit: GlucoseUnit; onDot?: (r: LedgerRow) => void; onInfo?: () => void; print?: boolean }) {
  const rows = rowsIn(check, win).filter((r) => r.status !== 'excluded' && r.early);
  return (
    <Card className={cx('space-y-1 !px-3 !py-2.5', print && 'mx-auto max-w-[400px]')}>
      {print && <b className="block text-[13px]">{t('الملاحظ')} · {t('٢ س')}</b>}
      <p className="rounded-lg bg-near-soft px-2 py-1 text-[12px] text-near">{t('وصف بس · فيه المتأثرة · ما ينحسب منه أي رقم')}</p>
      <Legend items={['clean', ...FACTORS]} onInfo={onInfo} />
      {GROUPS.map((g) => {
        const mine = rows.filter((r) => r.group === g);
        const sets: { k: string; isf: number; cr: number; list: LedgerRow[] }[] = [];
        for (const r of [...mine].sort((a, b) => a.t0 - b.t0)) {
          const k = g === 'correction' ? `${r.isf}` : `${r.isf}|${r.cr}`;
          const s0 = sets.find((x) => x.k === k);
          if (s0) s0.list.push(r); else sets.push({ k, isf: r.isf, cr: r.cr, list: [r] });
        }
        return (
          <div key={g} className="border-t border-slate-100 pt-1">
            <span className="flex items-center gap-2"><span aria-hidden>{GROUP_ICON[g]}</span><b className="min-w-0 flex-1 truncate text-[14.5px]">{t(GROUP_SHORT[g])}</b>
              {!sets.length && <span className="text-[11.5px] text-slate-500">{t('ما في')}</span>}</span>
            {sets.map((x) => {
              const st = stat(x.list.map((r) => r.early!.diff)), med = st.n >= DC.minN ? st.median : null;
              return (
                <div key={x.k}>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="num rounded-md bg-slate-100 px-1.5 font-bold text-slate-600" dir="ltr">ISF {formatGlucose(x.isf, unit)}{g === 'correction' ? '' : ` · 1:${fmt(x.cr)}`}</span>
                    <span className="num" dir="ltr">n={st.n}{med != null ? ` · ${t('الوسيط')} ${fmtDiff(med, unit)}` : ''}</span>
                  </div>
                  <Strip rows={x.list} h="early" median={med} onDot={onDot} />
                </div>
              );
            })}
          </div>
        );
      })}
      <Axis />
    </Card>
  );
}

/** Where every prediction of the period went, each once: clean, affected (shown in Observed), or left out with why. */
export function LedgerCard({ rows, onOpen, print }: { rows: LedgerRow[]; onOpen?: () => void; print?: boolean }) {
  const n = { clean: 0, affected: 0, excluded: 0 }, by = new Map<Reason, number>();
  for (const r of rows) { n[r.status]++; by.set(r.primary, (by.get(r.primary) ?? 0) + 1); }
  const order: Reason[] = ['clean', ...FACTORS, 'deleted', 'edited', 'food_near', 'other_entry', 'no_data', 'pending'];
  const seg = (k: keyof typeof n, c: string) => (n[k] ? <i className={cx('block', c)} style={{ flex: n[k] }} /> : null);
  const body = (
    <>
      <span className="flex items-center justify-between text-[13px] font-bold"><span>{t('كل التوقعات ({n})', { n: rows.length })}</span>{onOpen && <span className="text-brand">{isEn() ? '›' : '‹'}</span>}</span>
      <span className="mt-1.5 flex h-3 gap-0.5 overflow-hidden rounded-full" dir="ltr">{seg('clean', 'bg-ok-fill')}{seg('affected', 'bg-brand/50')}{seg('excluded', 'bg-slate-300')}</span>
      <span className="mt-1 flex gap-3 text-[12px] text-slate-600"><span>✅ {t('{n} نظيفة', { n: n.clean })}</span><span>◻️ {t('{n} متأثرة', { n: n.affected })}</span><span>⛔ {t('{n} ما تنقارن', { n: n.excluded })}</span></span>
      <span className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] text-slate-600">
        {order.filter((k) => k !== 'clean' && by.get(k)).map((k) => <span key={k} className="flex min-w-0 gap-1"><span aria-hidden>{REASON[k].icon}</span><b className="num">{by.get(k)}</b><span className="truncate">{t(SHORT[k] ?? REASON[k].name)}</span>{/* i18n-ok: table values */}</span>)}
      </span>
    </>
  );
  return print || !onOpen
    ? <Card className="!px-3 !py-2.5">{body}</Card>
    : <button onClick={onOpen} className="block w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-start active:bg-slate-50">{body}</button>;
}

/** The doctor's saved numbers, read only, and the warning while they differ from what the family reported. */
export function DoctorNumbers({ print }: { print?: boolean }) {
  const { settings } = useData();
  const unit = settings.glucose_unit, u = unitLabel(unit);
  const ratios = [...(settings.ratios ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  const diff = discrepancy(ratios);
  const isfs = [...new Set(ratios.map((r) => r.isf))];
  return (
    <Card className="space-y-2">
      <h3 className="font-bold">🩺 {t('أرقام الطبيب (المحفوظة في التطبيق)')}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {ratios.map((r, i) => (
          <div key={r.from}>
            <div className="text-xs text-slate-500">{t('نسبة الكارب')}</div>
            <div className="num text-lg font-bold" dir="ltr">1 : {fmt(r.cr)}</div>
            <div className="text-xs text-slate-500">{ratios.length > 1 ? t('من {time}', { time: r.from }) + (ratios[i + 1] ? ` – ${ratios[i + 1].from}` : '') : t('طول اليوم')}</div>
          </div>
        ))}
        {isfs.map((isf) => (
          <div key={isf}>
            <div className="text-xs text-slate-500">{t('التصحيح (ISF)')}</div>
            <div className="text-base font-bold"><bdi className="num" dir="ltr">{formatGlucose(isf, unit)}</bdi> {u} {t('لكل وحدة')}</div>
            {unit === 'mmol' && <div className="text-xs text-slate-500">{t('محفوظ {v} ملغ/دل', { v: Math.round(isf) })}</div>}
          </div>
        ))}
      </div>
      {diff && (
        <div className="rounded-2xl border border-near/30 bg-near-soft px-3 py-2 text-[13.5px]">
          <b className="block text-near">⚠ {t('تأكدوا من الطبيب')}</b>
          <p className="mt-0.5 text-slate-700">{t('الأرقام اللي ذكرتوها: نسبة 1:15 وتصحيح 4.0 مليمول/ل لكل وحدة. المحفوظ في التطبيق مختلف (فوق). ما تغيّر شي؛ الحاسبة تستخدم المحفوظ لين تعدّلونه.')}</p>
          {!print && <Link to="/doctor" className="mt-1 inline-flex min-h-[40px] items-center font-bold text-brand">{t('افتحي أرقام الطبيب')} {isEn() ? '›' : '‹'}</Link>}
        </div>
      )}
    </Card>
  );
}

/** When the saved numbers changed inside the period, and how many predictions no longer match the log. */
export function PeriodNotes({ check, unit }: { check: Check; unit: GlucoseUnit }) {
  const u = unitLabel(unit);
  const day = (ms: number) => new Date(ms).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  if (check.spans.length <= 1) return null;
  return (
    <Card className="space-y-2 text-[13.5px]">
      {check.spans.length > 1 && (
        <div>
          <b className="block text-near">⚠ {t('الأرقام المحفوظة تغيّرت خلال هذي الفترة')}</b>
          <p className="text-slate-600">{t('كل ملاحظة انقارنت بالأرقام اللي كانت محفوظة وقتها. لا تقارنون الفترات ببعض كأنها نفس الأرقام.')}</p>
          <ul className="mt-1">
            {check.spans.map((x, i) => (
              <li key={i} className="flex items-baseline gap-2 border-t border-slate-100 py-1 first:border-t-0">
                <span className="shrink-0 whitespace-nowrap text-slate-500">{day(x.first)} – {day(x.last)}</span>
                <span className="min-w-0 flex-1">{t('التصحيح {v} {u}', { v: formatGlucose(x.isf, unit), u })} · {x.crs.map((c) => `1:${fmt(c)}`).join(isEn() ? ', ' : '، ')}</span>{/* i18n-ok: list commas */}
                <span className="shrink-0 text-xs text-slate-500">{x.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}





const when = (ms: number) => `${new Date(ms).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions)} ${fmtTime(new Date(ms))}`;
const STATUS_CHIP: Record<LedgerRow['status'], [string, string]> = { clean: ['نظيفة', 'bg-ok-soft text-ok'], affected: ['متأثرة', 'bg-brand-soft text-brand'], excluded: ['ما تنقارن', 'bg-slate-100 text-slate-600'] }; // i18n-ok: shown through t()

/** One prediction in full: when, the doctor's numbers in force then, predicted vs actual at 2 h, every reason, the Log. */
function DotDetail({ r, unit }: { r: LedgerRow; unit: GlucoseUnit }) {
  const u = unitLabel(unit), [chip, tone] = STATUS_CHIP[r.status];
  const out = (o: LedgerRow['early'], label: string) => o && (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-center">
        <div><div className="text-[11px] text-slate-500">{t('المتوقع')}</div><b className="num text-[17px]">{formatGlucose(o.pred, unit)}</b></div>
        <div><div className="text-[11px] text-slate-500">{t('الفعلي')}</div><b className="num text-[17px]">{formatGlucose(o.actual, unit)}</b></div>
        <div><div className="text-[11px] text-slate-500">{t('الفرق')}</div><b className="num text-[17px]">{fmtDiff(o.diff, unit)}</b></div>
      </div>
      <div className="text-center text-[11px] text-slate-500">{u}</div>
    </div>
  );
  return (
    <div className="space-y-2.5 pb-4">
      <div className="flex items-center gap-2"><b className="min-w-0 flex-1 text-[15px]">{when(r.t0)}</b><span className={cx('rounded-full px-2 py-0.5 text-[12px] font-bold', tone)}>{t(chip)}</span></div>
      {r.name && <div className="truncate text-[14px] text-slate-700"><bdi>{r.name}</bdi></div>}
      <div className="flex flex-wrap gap-1.5 text-[12.5px]">
        <span className="num rounded-full bg-slate-100 px-2 py-0.5" dir="ltr">1:{fmt(r.cr)}</span>
        <span className="num rounded-full bg-slate-100 px-2 py-0.5" dir="ltr">ISF {formatGlucose(r.isf, unit)}</span>
        {r.carbs > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('{g} غ', { g: fmt(r.carbs) })}</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('{u} وحدة', { u: fmt(r.units) })}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('البداية {v}', { v: formatGlucose(r.start, unit) })}</span>
      </div>
      <p className="text-[11.5px] text-slate-500">{t('أرقام الطبيب المحفوظة وقت الجرعة')}</p>
      {r.early ? out(r.early, t('بعد ساعتين')) : <p className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600">{t('ما في مقارنة بعد ساعتين')}</p>}
      {out(r.late, r.late ? t('بعد {h} ساعات', { h: Math.round(r.late.min / 60) }) : '')}
      <ul className="space-y-1">
        {r.reasons.map((k, i) => (
          <li key={k} className="flex items-start gap-2 text-[13.5px]"><span aria-hidden>{REASON[k].icon}</span>
            <span className="min-w-0 flex-1">{t(REASON[k].name)}{k === 'sensor' && r.sensorWhy.length ? <span className="text-slate-500"> · {r.sensorWhy.map((w) => t(SENSOR_WHY[w])).join(isEn() ? ', ' : '، ')}</span> : null}</span>{/* i18n-ok: list commas */}
            {i === 0 && r.reasons.length > 1 && <span className="shrink-0 text-[11px] text-slate-500">{t('السبب الأول')}</span>}</li>
        ))}
      </ul>
      {r.primary !== 'deleted' && <Link to={`/timeline?open=${r.key.replace(':', '')}`} className="flex min-h-[44px] items-center justify-center rounded-2xl bg-brand-soft font-bold text-brand">{t('افتحي في السجل')}</Link>}
    </div>
  );
}

/** Every prediction of the period, grouped by its primary reason; each opens its details. */
function LedgerList({ rows, unit, onPick }: { rows: LedgerRow[]; unit: GlucoseUnit; onPick: (r: LedgerRow) => void }) {
  const order: Reason[] = ['clean', ...FACTORS, 'deleted', 'edited', 'food_near', 'other_entry', 'no_data', 'pending'];
  return (
    <div className="space-y-3 pb-4">
      {order.filter((k) => rows.some((r) => r.primary === k)).map((k) => (
        <section key={k}>
          <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-bold"><span aria-hidden>{REASON[k].icon}</span>{t(REASON[k].name)} <span className="text-slate-500">({rows.filter((r) => r.primary === k).length})</span></h3>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {rows.filter((r) => r.primary === k).map((r) => (
              <li key={r.key}><button onClick={() => onPick(r)} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-1.5 text-start text-[13px] active:bg-slate-50">
                <span aria-hidden>{GROUP_ICON[r.group]}</span>
                <span className="min-w-0 flex-1 truncate">{when(r.t0)}</span>
                {r.early && <b className="num shrink-0" dir="ltr">{fmtDiff(r.early.diff, unit)}</b>}
                <span className="shrink-0" aria-label={r.reasons.map((x) => t(REASON[x].name)).join(', ')}>{r.reasons.slice(1).map((x) => REASON[x].icon).join('')}</span>
              </button></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
