// Analysis → Patterns → «أرقام الطبيب والواقع»: how glucose went after meals and corrections, against what the doctor's
// saved numbers predicted when the dose was given. It shows outcomes only: never a new ratio, correction factor or dose,
// and nothing here reaches the dose calculator. The 2-hour result is an early outcome; clean observations are never
// pooled with affected ones; a correction that fell more or less than predicted is not proof about the ISF.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { useDoctorCheck } from '../lib/doctorCheck';
import { DC, FLAGS, WINDOWS, discrepancy, type DoctorCheck as Check, type Confidence, type Flag, type Group, type GroupSummary, type Obs, type Stat, type Window } from '../engine/doctorCheck';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import { Card, Sheet, cx } from '../components/ui';
import { dir, isEn, t } from '../i18n';

export const GROUP_NAME: Record<Group, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', correction: 'التصحيح (إنسولين بدون أكل)' }; // i18n-ok: shown through t()
const GROUP_ICON: Record<Group, string> = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', correction: '💉' };
const GROUP_SHORT: Record<Group, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', correction: 'تصحيح بدون أكل' }; // i18n-ok: shown through t()
export const FLAG_NAME: Record<Flag, string> = { // i18n-ok: shown through t()
  overlap: 'إنسولين أو أكل من قبل لسه شغّال', tresiba: 'تريسيبا: السكر كان يتحرك لحاله قبلها', fatty: 'وجبة دسمة أو بروتين عالي', sensor: 'قراءات الحساس غير أكيدة', // i18n-ok
};
const FLAG_ICON: Record<Flag, string> = { overlap: '💉', tresiba: '🌙', fatty: '🍕', sensor: '📡' };
export const SENSOR_WHY: Record<string, string> = { day1: 'أول يوم للحساس', last_day: 'آخر يوم للحساس', gaps: 'نقص في القراءات', bias: 'الوخز يختلف عن الحساس' }; // i18n-ok: shown through t()
export const CONF_NAME: Record<Confidence, string> = { too_few: 'نظيفة قليلة', low: 'ثقة قليلة', moderate: 'ثقة متوسطة' }; // i18n-ok: shown through t()

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
  const [open, setOpen] = useState<GroupSummary | null>(null);
  const unit = settings.glucose_unit;
  const [h, setH] = useState<'early' | 'late'>('early');
  const [info, setInfo] = useState(false);
  const seg = (on: boolean) => cx('min-h-[40px] flex-1 rounded-full text-sm font-bold', on ? 'bg-white text-brand shadow-sm' : 'text-slate-500');
  return (
    <div className="space-y-3">
      <NumbersStrip check={check} onInfo={() => setInfo(true)} />
      <div className="flex gap-2">
        <div className="flex flex-[3] rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={t('المدة')}>
          {WINDOWS.map((w) => <button key={w} role="radio" aria-checked={win === w} onClick={() => setWin(w)} className={seg(win === w)}>{t('{n} يوم', { n: w })}</button>)}
        </div>
        <div className="flex flex-[2] rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={t('بعد')}>
          <button role="radio" aria-checked={h === 'early'} onClick={() => setH('early')} className={seg(h === 'early')}>{t('٢ س')}</button>
          <button role="radio" aria-checked={h === 'late'} onClick={() => setH('late')} className={seg(h === 'late')}>{t('٣–٥ س')}</button>
        </div>
      </div>
      {error && <p className="px-1 text-sm text-over">{t('تعذّر تحميل البيانات: {e}', { e: error })}</p>}
      {!check && !error && <p className="px-1 py-6 text-center text-slate-500">{t('جاري التحميل…')}</p>}
      {check && <OutcomeChart check={check} win={win} h={h} unit={unit} onOpen={setOpen} onInfo={() => setInfo(true)} />}
      <p className="px-2 pb-4 text-center text-xs text-slate-500">{t('للنقاش مع الطبيب · ما يغيّر أي جرعة')}</p>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? t(GROUP_NAME[open.group]) : ''}>
        {open && <ObsList s={open} unit={unit} />}
      </Sheet>
      <Sheet open={info} onClose={() => setInfo(false)} title={t('كيف تقرون الرسم')}>
        <div className="space-y-3 pb-4 text-[14px] text-slate-700">
          <ul className="space-y-1.5">
            <li>{t('كل نقطة = وجبة أو تصحيح: يسار = السكر انتهى أقل من المتوقع، يمين = أعلى. الشريط الأخضر = قريب (±1.5).')}</li>
            <li>{t('● نظيفة: ما في شي ثاني يأثر. ○ متأثرة (إنسولين قبلها، تريسيبا، أكل دسم، أو شك في الحساس): تنعرض بس وما تنحسب.')}</li>
            <li>{t('الدائرة = كم وحدة نظيفة من ٥ نحتاجها. بعد ٥ يطلع المتوسط ◆.')}</li>
            <li>{t('٢ س = نتيجة مبكرة، مو حكم على النسبة. ٣–٥ س لحالها.')}</li>
            <li>{t('التصحيح: إذا نزل أكثر أو أقل من المتوقع، هذا بروحه مو دليل إن رقم التصحيح غلط.')}</li>
          </ul>
          <DoctorNumbers />
          {check && <PeriodNotes check={check} unit={unit} />}
        </div>
      </Sheet>
    </div>
  );
}

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

/** The whole picture: one strip per meal time, one dot per meal on the same scale (left lower than predicted, right
 *  higher), the green band "near". Clean dots filled, affected hollow. The ring: clean ones so far out of 5. */
export function OutcomeChart({ check, win, h, unit, onOpen, onInfo, print }: { check: Check; win: Window; h: 'early' | 'late'; unit: GlucoseUnit; onOpen?: (g: GroupSummary) => void; onInfo?: () => void; print?: boolean }) {
  const W = 320, R = 108, X = (mg: number) => ((Math.max(-R, Math.min(R, mg)) + R) / (2 * R)) * (W - 16) + 8;
  const since = check.to - win * 86400000;
  return (
    <Card className={cx('space-y-1 !px-3 !py-2.5', print && 'mx-auto max-w-[400px]')}>
      <div className="flex items-center gap-3 pb-1 text-[11.5px] text-slate-500">
        <span>● {t('نظيفة')}</span><span>○ {t('متأثرة')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm bg-[rgb(var(--st-in)/0.25)]" />±1.5</span>
        {onInfo && <button onClick={onInfo} aria-label={t('شرح')} className="ms-auto grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-bold text-slate-500">i</button>}
      </div>
      {check.groups.map((g) => {
        const list = g.obs.filter((o) => o.t0 >= since && o[h]).sort((a, b) => Number(a.clean) - Number(b.clean));
        const st = g.win[win][h].clean;
        const stack = new Map<number, number>();
        const body = (
          <>
            <span className="flex items-center gap-2">
              <span aria-hidden>{GROUP_ICON[g.group]}</span>
              <b className="min-w-0 flex-1 truncate text-[14.5px]">{t(GROUP_SHORT[g.group])}</b>
              <Ring n={st.n} median={st.n >= RING_N ? st.median : null} unit={unit} />
            </span>
            <svg viewBox={`0 0 ${W} 30`} width="100%" height={30} direction="ltr" aria-hidden className="-mt-1 block">
              <rect x={X(-DC.near)} y={3} width={X(DC.near) - X(-DC.near)} height={24} rx={4} fill="rgb(var(--st-in))" fillOpacity={0.18} />
              <line x1={8} x2={W - 8} y1={15} y2={15} stroke="currentColor" strokeOpacity={0.12} />
              <line x1={X(0)} x2={X(0)} y1={1} y2={29} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
              {list.map((o) => {
                const d = o[h]!.diff, k = Math.round(X(d) / 8), n = stack.get(k) ?? 0; stack.set(k, n + 1);
                const col = Math.abs(d) <= DC.near ? 'rgb(var(--st-in))' : d > 0 ? 'rgb(var(--st-high))' : 'rgb(var(--st-low))';
                const cy = 15 + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 7;
                return <circle key={o.key} cx={X(d)} cy={cy} r={4.6} fill={o.clean ? col : 'rgb(var(--surface))'} stroke={o.clean ? 'rgb(var(--surface))' : 'rgb(var(--text-3))'} strokeWidth={o.clean ? 1.2 : 1.6} />;
              })}
              {st.n >= RING_N && st.median !== null && <path d={`M${X(st.median)} 6 l6 9 l-6 9 l-6 -9z`} fill="currentColor" />}
            </svg>
          </>
        );
        return print || !onOpen
          ? <div key={g.group} className="border-t border-slate-100 pt-1 first-of-type:border-t-0">{body}</div>
          : <button key={g.group} onClick={() => onOpen(g)} className="block w-full border-t border-slate-100 pt-1 text-start active:bg-slate-50">{body}</button>;
      })}
      <div className="flex justify-between px-1 pt-0.5 text-[11px] text-slate-500" dir="ltr">
        <span>◀ {t('انتهى أقل')}</span><span>{t('انتهى أعلى')} ▶</span>
      </div>
    </Card>
  );
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
  if (check.spans.length <= 1 && !check.dropped.n) return null;
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
      {check.dropped.n > 0 && <p className="text-slate-600">{t('{n} توقع قديم ما انحسب: السجل تغيّر بعد ما انحفظ (أكل أو جرعة انضافت أو انعدلت أو انحذفت بعدين).', { n: check.dropped.n })}</p>}
    </Card>
  );
}





/** Every observation of a group, newest first: what was predicted and what happened, why it is affected, and a way
 *  into that entry in the Log. */
function ObsList({ s, unit }: { s: GroupSummary; unit: GlucoseUnit }) {
  const u = unitLabel(unit);
  const logKey = (k: string) => k.replace(':', '');
  const out = (o: Obs, h: 'early' | 'late') => { const x = o[h]; return x ? <><bdi className="num" dir="ltr">{formatGlucose(x.pred, unit)} → {formatGlucose(x.actual, unit)}</bdi> <b className="num" dir="ltr">({fmtDiff(x.diff, unit)})</b></> : <span className="text-slate-400">—</span>; };
  return (
    <ul className="space-y-2 pb-4">
      <li className="text-xs text-slate-500">{t('المتوقع → الفعلي ({u})', { u })}</li>
      {s.obs.map((o) => (
        <li key={o.key}><Link to={`/timeline?open=${logKey(o.key)}`} className="block rounded-2xl border border-slate-100 bg-white px-3 py-2 active:bg-slate-50">
          <span className="flex items-center gap-2 text-[13px]">
            <b className="min-w-0 flex-1 truncate">{new Date(o.t0).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions)} {fmtTime(new Date(o.t0))}{o.name ? <> · <bdi>{o.name}</bdi></> : null}</b>
            <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', o.clean ? 'bg-ok-soft text-ok' : 'bg-slate-100 text-slate-600')}>{o.clean ? t('نظيفة') : t('متأثرة')}</span>
          </span>
          <span className="block text-xs text-slate-500">{o.carbs > 0 ? t('{g} غ', { g: fmt(o.carbs) }) + ' · ' : ''}{t('{u} وحدة', { u: fmt(o.units) })} · {t('البداية {v}', { v: formatGlucose(o.start, unit) })} · <bdi dir="ltr">1:{fmt(o.cr)}</bdi> · {t('التصحيح {v}', { v: formatGlucose(o.isf, unit) })}</span>
          <span className="mt-1 grid grid-cols-2 gap-2 text-[12.5px]">
            <span><span className="block text-[11px] text-slate-500">{t('بعد ساعتين')}</span>{out(o, 'early')}</span>
            <span><span className="block text-[11px] text-slate-500">{o.late ? t('بعد {h} ساعات', { h: Math.round(o.late.min / 60) }) : t('متأخرة')}</span>{out(o, 'late')}</span>
          </span>
          {!o.clean && <span className="mt-1 flex flex-wrap gap-1">{o.flags.map((f) => (
            <span key={f} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{FLAG_ICON[f]} {f === 'sensor' && o.sensorWhy.length ? o.sensorWhy.map((w) => t(SENSOR_WHY[w])).join(isEn() ? ', ' : '، ') : t(FLAG_NAME[f])}</span> // i18n-ok: list commas
          ))}</span>}
        </Link></li>
      ))}
    </ul>
  );
}
