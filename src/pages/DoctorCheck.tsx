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
export const FLAG_NAME: Record<Flag, string> = { // i18n-ok: shown through t()
  overlap: 'إنسولين أو أكل من قبل لسه شغّال', tresiba: 'تريسيبا: السكر كان يتحرك لحاله قبلها', fatty: 'وجبة دسمة أو بروتين عالي', sensor: 'قراءات الحساس غير أكيدة', // i18n-ok
};
const FLAG_ICON: Record<Flag, string> = { overlap: '💉', tresiba: '🌙', fatty: '🍕', sensor: '📡' };
export const SENSOR_WHY: Record<string, string> = { day1: 'أول يوم للحساس', last_day: 'آخر يوم للحساس', gaps: 'نقص في القراءات', bias: 'الوخز يختلف عن الحساس' }; // i18n-ok: shown through t()
export const CONF_NAME: Record<Confidence, string> = { too_few: 'نظيفة قليلة', low: 'ثقة قليلة', moderate: 'ثقة متوسطة' }; // i18n-ok: shown through t()
const CONF_TONE: Record<Confidence, string> = { too_few: 'bg-slate-100 text-slate-600', low: 'bg-near-soft text-near', moderate: 'bg-ok-soft text-ok' };

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
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-slate-600">{t('هل مشى السكر مثل ما توقعت أرقام الطبيب وقت الجرعة؟ مقارنة للنقاش مع الطبيب، مو نصيحة ولا تغيّر أي جرعة.')}</p>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={t('المدة')}>
        {WINDOWS.map((w) => (
          <button key={w} role="radio" aria-checked={win === w} onClick={() => setWin(w)}
            className={cx('min-h-[40px] rounded-full text-sm font-bold', win === w ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}>{t('{n} يوم', { n: w })}</button>
        ))}
      </div>
      <DoctorNumbers />
      {check && <PeriodNotes check={check} unit={unit} />}
      <Card className="!py-2.5 text-[13.5px] text-slate-600">
        <b className="block text-slate-800">{t('كيف تقرون هذي الصفحة')}</b>
        {t('بعد ساعتين = نتيجة مبكرة: الإنسولين والأكل لسه شغّالين، فهي مو حكم على النسبة. النتيجة المتأخرة (٣–٥ ساعات) تنعرض لحالها. الملاحظات «النظيفة» بس هي اللي تنحسب؛ اللي فيها إنسولين سابق أو تريسيبا أو أكل دسم أو شك في الحساس تنعرض تحت لحالها.')}
      </Card>
      {error && <p className="px-1 text-sm text-over">{t('تعذّر تحميل البيانات: {e}', { e: error })}</p>}
      {!check && !error && <p className="px-1 py-6 text-center text-slate-500">{t('جاري التحميل…')}</p>}
      {check?.groups.map((s) => <GroupCard key={s.group} s={s} win={win} unit={unit} onOpen={() => setOpen(s)} />)}
      {check && <p className="px-2 pb-4 text-center text-xs text-slate-500">{t('من الجرعات والأكل المسجّل وقراءات الحساس. تقديرات للنقاش مع الطبيب: ما تقترح نسبة ولا جرعة، وما تغيّر الحاسبة.')}</p>}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? t(GROUP_NAME[open.group]) : ''}>
        {open && <ObsList s={open} unit={unit} />}
      </Sheet>
    </div>
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

function ConfChip({ c }: { c: Confidence }) {
  return <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold', CONF_TONE[c])}>{t(CONF_NAME[c])}</span>;
}

/** One dot per observation: clean filled, affected hollow and grey; the ±1.5 band is "near". */
function Dots({ obs, h }: { obs: Obs[]; h: 'early' | 'late' }) {
  const W = 320, Hh = 44, R = 108; // ±6 mmol/L across the width
  const rtl = dir() === 'rtl', X = (mg: number) => { const x = ((Math.max(-R, Math.min(R, mg)) + R) / (2 * R)) * (W - 16) + 8; return rtl ? W - x : x; };
  const stack = new Map<number, number>();
  const list = obs.filter((o) => o[h]).sort((a, b) => Number(a.clean) - Number(b.clean));
  if (!list.length) return null;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" height={Hh} aria-hidden className="mt-1">
      <rect x={Math.min(X(-DC.near), X(DC.near))} y={4} width={Math.abs(X(DC.near) - X(-DC.near))} height={Hh - 18} rx={4} fill="rgb(var(--st-in))" fillOpacity={0.14} />
      <line x1={X(0)} x2={X(0)} y1={2} y2={Hh - 14} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
      {list.map((o) => {
        const d = o[h]!.diff, k = Math.round(X(d) / 9), n = stack.get(k) ?? 0; stack.set(k, n + 1);
        const col = Math.abs(d) <= DC.near ? 'rgb(var(--st-in))' : d > 0 ? 'rgb(var(--st-high))' : 'rgb(var(--st-low))';
        return <circle key={o.key} cx={X(d)} cy={Hh - 22 - n * 8} r={4.2} fill={o.clean ? col : 'rgb(var(--surface))'} stroke={o.clean ? 'rgb(var(--surface))' : 'rgb(var(--text-3))'} strokeWidth={o.clean ? 1.2 : 1.4} />;
      })}
      {[-72, 0, 72].map((v) => <text key={v} x={X(v)} y={Hh - 2} fontSize={9} textAnchor="middle" fill="currentColor" fillOpacity={0.5}>{v === 0 ? '0' : v > 0 ? '+4' : '−4'}</text>)}
    </svg>
  );
}

function Split({ s }: { s: Stat }) {
  if (!s.n) return null;
  const seg = (k: number, c: string) => (k ? <i className={cx('block', c)} style={{ flex: k }} /> : null);
  return (
    <>
      <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full" dir="ltr">{seg(s.lower, 'bg-over-fill')}{seg(s.near, 'bg-ok-fill')}{seg(s.higher, 'bg-near-fill')}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-slate-600">
        <span>{t('{n} أقل', { n: s.lower })}</span><span>{t('{n} قريب (±1.5)', { n: s.near })}</span><span>{t('{n} أعلى', { n: s.higher })}</span>
      </div>
    </>
  );
}

function GroupCard({ s, win, unit, onOpen }: { s: GroupSummary; win: Window; unit: GlucoseUnit; onOpen: () => void }) {
  const w = s.win[win], corr = s.group === 'correction';
  const inWin = s.obs.filter((o) => o.t0 >= Date.now() - win * 86400000);
  const early = w.early, late = w.late;
  return (
    <Card className="space-y-2">
      <header className="flex items-center gap-2">
        <span aria-hidden className="text-lg">{GROUP_ICON[s.group]}</span>
        <h3 className="min-w-0 flex-1 text-[16.5px] font-bold">{t(GROUP_NAME[s.group])}</h3>
        <ConfChip c={early.conf} />
      </header>

      {/* early outcome: clean only */}
      <section>
        <div className="text-[12.5px] font-bold text-slate-500">{t('النتيجة المبكرة (بعد ساعتين) · مو حكم نهائي')}</div>
        {early.clean.n >= DC.minN ? (
          <p className="mt-0.5 text-[15.5px] font-medium">{direction(early.clean.median!, unit, corr)}</p>
        ) : (
          <p className="mt-0.5 text-[14.5px] text-slate-600">{corr ? t('{n} تصحيحات نظيفة بس. نحتاج {need} على الأقل قبل ما نقول شي.', { n: early.clean.n, need: DC.minN }) : t('{n} وجبات نظيفة بس. نحتاج {need} على الأقل قبل ما نقول شي.', { n: early.clean.n, need: DC.minN })}</p>
        )}
        <p className="text-xs text-slate-500">{t('{n} نظيفة', { n: early.clean.n })}{early.affected.n ? ` · ${t('{n} متأثرة (ما انحسبت)', { n: early.affected.n })}` : ''}</p>
        <Dots obs={inWin} h="early" />
        {early.clean.n >= DC.minN && <Split s={early.clean} />}
      </section>

      {/* trend over 7 / 14 / 30 days, clean early outcomes */}
      <section>
        <div className="mb-1 text-[12.5px] font-bold text-slate-500">{t('متوسط الفرق للنظيفة ({u})', { u: unitLabel(unit) })}</div>
        <div className="grid grid-cols-3 gap-1.5">
          {WINDOWS.map((x) => { const c = s.win[x].early.clean; const ok = c.n >= DC.minN; return (
            <div key={x} className={cx('rounded-xl bg-slate-50 px-2 py-1.5', x === win && 'ring-2 ring-brand')}>
              <div className="text-[11px] text-slate-500">{t('{n} يوم', { n: x })}</div>
              <div className="num text-[17px] font-bold" dir="ltr">{ok ? fmtDiff(c.median!, unit) : '—'}</div>
              <div className="text-[11px] text-slate-500">{ok ? t('{n} نظيفة', { n: c.n }) : t('{n} · قليلة', { n: c.n })}</div>
            </div>
          ); })}
        </div>
      </section>

      {/* later outcome, apart */}
      <section className="rounded-xl bg-slate-50 px-3 py-2">
        <div className="text-[12.5px] font-bold text-slate-500">{t('النتيجة المتأخرة (٣–٥ ساعات)')}</div>
        {late.clean.n >= DC.minN ? (
          <p className="text-[14.5px]">{direction(late.clean.median!, unit, corr)} <span className="text-xs text-slate-500">· {t('{n} نظيفة', { n: late.clean.n })}</span></p>
        ) : (
          <p className="text-[13.5px] text-slate-600">{t('{n} نظيفة بس (أغلب الوجبات يجي بعدها أكل أو جرعة قبل ٣ ساعات). نحتاج {need}.', { n: late.clean.n, need: DC.minN })}</p>
        )}
      </section>

      {/* affected observations, shown apart, never in the numbers above */}
      {early.affected.n + late.affected.n > 0 && (
        <section>
          <div className="text-[12.5px] font-bold text-slate-500">{t('متأثرة بأسباب ثانية (ما انحسبت فوق)')}</div>
          <ul>
            {FLAGS.filter((f) => s.flags[f] > 0).map((f) => (
              <li key={f} className="flex items-center gap-2 border-t border-slate-100 py-1.5 text-[13.5px] first:border-t-0">
                <span aria-hidden>{FLAG_ICON[f]}</span><span className="min-w-0 flex-1">{t(FLAG_NAME[f])}</span>
                <span className="shrink-0 text-xs text-slate-500">{t('{k} من {n}', { k: s.flags[f], n: s.obs.length })}</span>
              </li>
            ))}
          </ul>
          {early.affected.n >= DC.minN && <p className="text-xs text-slate-500">{t('المتأثرة لحالها: {d} بعد ساعتين ({n})', { d: fmtDiff(early.affected.median!, unit), n: early.affected.n })}</p>}
        </section>
      )}

      {corr && <p className="rounded-xl bg-brand-soft px-3 py-2 text-[13px] text-brand">{t('إذا نزل السكر أكثر أو أقل من المتوقع، هذا بروحه مو دليل إن رقم التصحيح غلط: النشاط، الإنسولين اللي قبله، تريسيبا، الحساس، ووقت القياس كلها تأثر. للنقاش مع الطبيب.')}</p>}

      {s.obs.length > 0 && <button onClick={onOpen} className="flex min-h-[44px] w-full items-center justify-end font-bold text-brand">{t('شوفي كل وحدة ({n})', { n: s.obs.length })} {isEn() ? '›' : '‹'}</button>}
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
