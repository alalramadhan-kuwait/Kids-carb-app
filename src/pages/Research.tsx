import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { runLabNow, slotOf, useLab, type ModelRow, type RunRow, type UnexplainedRow } from '../lib/lab';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import type { ModelScore } from '../engine/lab';
import { answerText } from '../components/ResearchQuestion';
import { Alert, Btn, Card, Chip, Page, cx, toast } from '../components/ui';
import { isEn, locale, t, tr } from '../i18n';

const HOUR = 3600000;
const when = (iso: string | number) => new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const NAME: Record<string, string> = tr({ // i18n-ok: values translated when read
  none: 'بدون تغيير', libre: 'سهم Libre (المعروض)', trend: 'اتجاه التطبيق', context: 'السياق v1 (أكل + إنسولين)', context_fit: 'السياق، يُعاد ضبطه يوميًا', damped: 'اتجاه مخفَّف', fat_bump: 'السياق + أثر الدهون المتأخر', drift_fat: 'السياق + ميل الإنسولين الطويل + أثر الدهون', // i18n-ok
});
const STATUS: Record<string, string> = tr({ // i18n-ok: values translated when read
  production: 'المستخدم الآن', reference: 'للمقارنة', collecting: 'يجمع بيانات', not_better: 'ليس أفضل بوضوح', ready: 'أفضل بوضوح', rejected: 'مرفوض', retired: 'متقاعد', // i18n-ok
});
const WHY: Record<string, string> = tr({ // i18n-ok: values translated when read
  not_enough_unseen: 'بيانات جديدة غير كافية بعد', promising_needs_more: 'واعد، يحتاج أيامًا أكثر', worse_than_no_change: 'أسوأ من «بدون تغيير»', // i18n-ok
  false_fall_alarms: 'إنذارات نزول خاطئة كثيرة', not_10pct_better: 'ليس أفضل بـ 10% على الأقل', worse_at_30: 'أسوأ بعد 30 دقيقة', misses_falls: 'يفوّت نزولات سريعة', materially_better: 'أفضل بوضوح على بيانات لم يرها', // i18n-ok
});
const CAUSE: Record<string, string> = tr({ // i18n-ok: values translated when read
  model_error: 'خطأ النموذج', missing_event: 'حدث غير مسجَّل', cgm: 'الحساس', bad_input: 'تسجيل غير مؤكد', // i18n-ok
});
const EVIDENCE: Record<string, string> = tr({ // i18n-ok: values translated when read
  uncertain_entry: 'قريب من سطر مستورد غير مؤكد', compression_shape: 'نزول ليلي ثم رجوع سريع (ضغط على الحساس)', sensor_new: 'أول يوم للحساس', // i18n-ok
  jump: 'قفزة مفاجئة بين قراءتين', fingerprick_disagrees: 'وخز قريب يخالف الحساس', carbs_logged: 'أكل مسجّل: التوقيت أو الكمية أو سرعة الامتصاص', // i18n-ok
  exercise_logged: 'نشاط مسجّل (النموذج لا يحسبه)', insulin_logged: 'إنسولين مسجّل', no_carbs_logged: 'لا أكل مسجّل قبله', no_insulin_logged: 'لا إنسولين ولا نشاط مسجّل', // i18n-ok
  night: 'ليلًا', parent_answer: 'جواب الأهل', // i18n-ok
});
const EXCL: Record<string, string> = tr({ // i18n-ok: values translated when read
  uncertain_entry: 'قرب سطور مستوردة غير مؤكدة', sensor_warmup: 'أول ساعة للحساس', questionable_cgm: 'فترات حساس مشكوك فيها', bad_input: 'تسجيل غير مؤكد', // i18n-ok
});
const SIT: Record<string, string> = tr({ night: 'الليل', after_food: 'بعد الأكل', after_insulin: 'بعد الإنسولين', other: 'غير ذلك' }); // i18n-ok
const sep = () => (isEn() ? ', ' : '، '); // i18n-ok: punctuation
const ORDER = ['libre', 'none', 'trend', 'context', 'context_fit', 'damped', 'fat_bump', 'drift_fat'];

/**
 * البحث: what the app learns on its own. Every 12 hours it scores the arrow it shows, "no change" and the
 * candidate methods on data none of them was tuned on, sorts out unexplained movements, and keeps every run.
 * Nothing here changes a dose, a reading on screen or an alert.
 */
export default function Research() {
  const nav = useNavigate();
  const { settings, events, history } = useData();
  const unit = settings.glucose_unit;
  const { runs, models, events: moves, reload } = useLab();
  const [busy, setBusy] = useState(false);
  const [sit, setSit] = useState<string>('all');
  const last = runs?.find((r) => r.status === 'done' && r.trigger !== 'baseline') ?? null;
  const baseline = runs?.find((r) => r.trigger === 'baseline') ?? null;
  const ready = models.filter((m) => m.status === 'ready');
  const now = async () => {
    setBusy(true);
    try { await runLabNow({ settings, events, history }); await reload(); toast(t('اكتمل التشغيل ✓')); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const scores = last?.metrics ? (sit === 'all' ? last.metrics.all : last.metrics.bySituation?.[sit as 'night'] ?? null) : null;

  return (
    <Page title={t('البحث')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-2">
          <p className="text-sm text-slate-600">{t('كل 12 ساعة يقارن التطبيق وحده طرق التوقع على بيانات جديدة لم تُضبط عليها، ويرفض الضعيف منها، ويصنّف التغيرات غير المفسَّرة. لا يغيّر الجرعات ولا القراءات المعروضة ولا التنبيهات.')}</p>
          <p className="text-xs text-slate-500">
            {last ? t('آخر تشغيل {when}', { when: when(last.finished_at ?? last.started_at) }) : t('لم يكتمل تشغيل بعد')}
            {' · '}{t('التالي بعد {when}', { when: when(slotOf(Date.now()) + 12 * HOUR) })}
          </p>
          <Btn kind="ghost" block disabled={busy} onClick={now}>{busy ? t('جارٍ التشغيل…') : t('تشغيل الآن')}</Btn>
        </Card>

        {ready.length > 0 && <Alert tone="info">{t('طريقة جديدة أفضل بوضوح من السهم المعروض على بيانات لم ترها: {names}. لن يتغير شيء حتى تقرروا.', { names: ready.map((m) => NAME[m.key] ?? m.name).join(sep()) })}</Alert>}

        <Card className="space-y-3">
          <h2 className="font-bold">{t('المقارنة على بيانات جديدة')}</h2>
          {last?.data ? (
            <p className="text-xs text-slate-500">{t('منذ نهاية Baseline v1: {n} لحظة خلال {d} يوم، كل الطرق على نفس اللحظات. الخطأ بـ {unit}.', { n: last.data.unseen, d: last.data.unseenDays, unit: unitLabel(unit) })}</p>
          ) : <p className="text-sm text-slate-500">{t('ستظهر النتائج بعد أول تشغيل.')}</p>}
          {last?.metrics && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
              {['all', 'night', 'after_food', 'after_insulin', 'other'].map((s) => <Chip key={s} active={sit === s} onClick={() => setSit(s)}>{s === 'all' ? t('الكل') : SIT[s]}</Chip>)}
            </div>
          )}
          {scores && <ScoreList scores={scores} models={models} verdicts={last?.verdicts ?? null} unit={unit} />}
          {last?.metrics && !scores && <p className="text-sm text-slate-500">{t('لا لحظات في هذه الحالة بعد.')}</p>}
        </Card>

        {baseline?.metrics && (
          <Card className="space-y-2">
            <h2 className="font-bold">{t('Baseline v1 (ثابت)')}</h2>
            <p className="text-xs text-slate-500">{t('{from} – {to} · {n} لحظة. للمرجع فقط: لا يُضبط أي نموذج على هذه الأيام وحدها.', { from: when(baseline.window_from!), to: when(baseline.window_to!), n: baseline.data?.shared ?? 0 })}</p>
            <ScoreList scores={baseline.metrics.all} models={[]} verdicts={null} unit={unit} />
          </Card>
        )}

        {last?.data && <DataCard run={last} />}

        <Moves list={moves} unit={unit} />

        <History models={models} runs={runs ?? []} />
      </div>
    </Page>
  );
}

function ScoreList({ scores, models, verdicts, unit }: { scores: Record<string, ModelScore>; models: ModelRow[]; verdicts: RunRow['verdicts']; unit: GlucoseUnit }) {
  const keys = ORDER.filter((k) => scores[k]);
  const best = Math.min(...keys.map((k) => scores[k].mae15));
  return (
    <ul className="divide-y divide-slate-100">
      {keys.map((k) => {
        const s = scores[k], m = models.find((x) => x.key === k), v = verdicts?.[k];
        const status = v?.verdict ?? m?.status;
        return (
          <li key={k} className="space-y-1 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className={cx('font-medium', s.mae15 === best && 'text-brand')}>{NAME[k] ?? k}</span>
              {status && <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs', status === 'ready' ? 'bg-ok-soft text-ok' : status === 'rejected' ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600')}>{STATUS[status]}</span>}
            </div>
            <div className="grid grid-cols-4 gap-1 text-center text-xs">
              <Cell l={t('خطأ 15 د')} v={`±${formatGlucose(s.mae15, unit)}`} />
              <Cell l={t('خطأ 30 د')} v={`±${formatGlucose(s.mae30, unit)}`} />
              <Cell l={t('الاتجاه')} v={`${Math.round(s.direction * 100)}%`} />
              <Cell l={t('نزول سريع')} v={`${s.fall.caught}/${s.fall.truth}`} sub={t('{n} خاطئ', { n: s.fall.falseAlarms })} />
            </div>
            {v && v.why && <p className="text-xs text-slate-500">{WHY[v.why] ?? v.why}</p>}
          </li>
        );
      })}
    </ul>
  );
}
const Cell = ({ l, v, sub }: { l: string; v: string; sub?: string }) => (
  <span className="rounded-lg bg-slate-50 py-1"><span className="block text-[11px] text-slate-500">{l}</span><span className="num font-medium">{v}</span>{sub && <span className="block text-[11px] text-slate-500">{sub}</span>}</span>
);

function DataCard({ run }: { run: RunRow }) {
  const d = run.data!;
  return (
    <Card className="space-y-1.5">
      <h2 className="font-bold">{t('جودة البيانات (آخر 60 يومًا)')}</h2>
      <Fact label={t('قراءات')} value={String(d.readings)} />
      <Fact label={t('لحظات قابلة للتقييم')} value={String(d.moments)} />
      <Fact label={t('مستبعدة من البحث (محفوظة كما هي)')} value={String(d.excluded)} />
      {Object.keys(d.excludedBy ?? {}).map((k) => <Fact key={k} label={`· ${EXCL[k] ?? k}`} value={String(d.excludedBy[k])} />)}
      <p className="pt-1 text-xs text-slate-500">{t('لا يُحذف شيء: الاستبعاد يُعاد حسابه في كل تشغيل، ويرجع ما استُبعد إذا اتضح.')}</p>
    </Card>
  );
}

function Moves({ list, unit }: { list: UnexplainedRow[]; unit: GlucoseUnit }) {
  const [all, setAll] = useState(false);
  const week = useMemo(() => list.filter((e) => Date.now() - Date.parse(e.start_at) < 7 * 24 * HOUR), [list]);
  const count = (c: string) => week.filter((e) => e.cause === c).length;
  const shown = all ? list : list.slice(0, 8);
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">{t('تغيرات غير مفسَّرة')}</h2>
      <p className="text-xs text-slate-500">{t('تغيّر خلال 30 دقيقة يختلف بـ 2 مليمول/ل أو أكثر عمّا يفسّره الأكل والإنسولين المسجّلان. يُصنَّف السبب تلقائيًا، ويُسأل الأهل فقط عمّا لا تعرفه البيانات.')}</p>
      <div className="grid grid-cols-4 gap-1 text-center text-xs">
        {['model_error', 'missing_event', 'cgm', 'bad_input'].map((c) => <Cell key={c} l={CAUSE[c]} v={String(count(c))} />)}
      </div>
      <p className="text-[11px] text-slate-500">{t('آخر 7 أيام')}</p>
      <ul className="divide-y divide-slate-100">
        {shown.map((e) => (
          <li key={e.key} className="space-y-0.5 py-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{when(e.start_at)} · {e.direction === 'rise' ? '↑' : '↓'} <span className="num">{formatGlucose(e.g_from, unit)} → {formatGlucose(e.g_to, unit)}</span></span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{CAUSE[e.cause]}</span>
            </div>
            <p className="text-xs text-slate-500">{t('غير مفسَّر: {x}', { x: (e.resid_mgdl >= 0 ? '+' : '−') + formatGlucose(Math.abs(e.resid_mgdl), unit) })} · {(e.evidence ?? []).map((x) => EVIDENCE[x] ?? x).join(' · ')}</p>
            {e.answer && <p className="text-xs font-medium">{t('الجواب: {a}', { a: e.answer.choice === 'other' && e.answer.note ? e.answer.note : answerText(e.answer.choice, e.direction) })}</p>}
          </li>
        ))}
      </ul>
      {list.length > 8 && !all && <button className="min-h-[44px] text-sm font-bold text-brand" onClick={() => setAll(true)}>{t('عرض الكل ({n})', { n: list.length })}</button>}
    </Card>
  );
}

function History({ models, runs }: { models: ModelRow[]; runs: RunRow[] }) {
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">{t('سجل النماذج والتشغيلات')}</h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {models.map((m) => (
          <li key={`${m.key}@${m.version}`} className="py-2">
            <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{NAME[m.key] ?? m.name} <span className="text-xs text-slate-500" dir="ltr">v{m.version}</span></span><span className="text-xs">{STATUS[m.status]}</span></div>
            <p className="text-xs text-slate-500">{m.status_reason ? `${WHY[m.status_reason] ?? m.status_reason} · ` : ''}{t('منذ {when}', { when: when(m.status_at) })}</p>
          </li>
        ))}
      </ul>
      <h3 className="text-sm font-bold">{t('التشغيلات')}</h3>
      <ul className="divide-y divide-slate-100 text-xs">
        {runs.slice(0, 12).map((r) => (
          <li key={r.id} className="flex justify-between gap-2 py-1.5">
            <span>{when(r.started_at)}{r.trigger === 'manual' ? ` · ${t('يدوي')}` : r.trigger === 'baseline' ? ' · Baseline v1' : ''}</span>
            <span className={cx(r.status === 'failed' && 'text-over')}>{r.status === 'done' ? t('{n} لحظة جديدة', { n: r.data?.unseen ?? r.data?.shared ?? 0 }) : r.status === 'running' ? t('يعمل…') : t('فشل')}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">{label}</span><b className="num">{value}</b></div>
);
