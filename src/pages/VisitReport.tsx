// The visit report: one button, one PDF for a clinic visit with the doctor and the dietitian. The clinical sections
// are the doctor reports, drawn in English (visitPdf.ts). The family's sections — cover, meal plans, growth and
// nutrition, the dietitian's daily sheets, notes — are laid out here, hidden, in the language chosen for them, then
// pictured onto the same PDF. Nothing here calculates or suggests a dose.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Btn, Card, Chip, Page, cx, toast } from '../components/ui';
import { useData } from '../lib/data';
import { usePortions } from '../lib/mom';
import { loadReportData, type ReportData } from '../lib/reportData';
import { usePatient } from '../lib/useReport';
import { addHtmlPages, sharePdf } from '../lib/pdfShare';
import { VISIT_PERIODS, buildVisitModels, drawVisitDoctor, visitFacts, type VisitDays, type VisitModels } from '../lib/visitPdf';
import { ageText } from '../lib/reportPdf';
import { dayStartOf } from '../engine/day';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { DEFAULT_STARTS, SLOT_KEYS, type DaySheet, type SlotStarts } from '../lib/dietSheet';
import { EventsPages, STARTS_KEY, SheetPage, loadDaySheets, type Ctx } from './DietSheet';
import { DailyAverage, GrowthSection, MealPatterns, Summary } from './Growth';
import { PlanReport } from './PlanReport';
import { ObservationsSection } from './visit/Observations';
import { DoctorCheckSection } from './visit/DoctorCheckSection';
import { useDoctorCheck } from '../lib/doctorCheck';
import { useGlucose } from '../hooks/useGlucose';
import { buildObservations, type NutritionIn } from '../engine/report/observations';
import { nightOf } from '../lib/schedule';
import { useGrowthNutrition } from '../lib/growth';
import { kwDate, reportPeriod, VALIDATION_NOTE } from '../engine/report/agpReport';
import { isEn, lang, swapLang, t, type Lang } from '../i18n';

const DAY = 86400000;
type FoodDays = 7 | 14;
interface Job { models: VisitModels; data: ReportData; sheets: DaySheet[]; lang: Lang; done: () => void }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(ok: () => boolean, ms = 25000) {
  const t0 = Date.now();
  while (!ok()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(150); }
}
function loadStarts(): SlotStarts {
  try { const j = JSON.parse(localStorage.getItem(STARTS_KEY) ?? 'null'); if (j && SLOT_KEYS.every((k) => typeof j[k] === 'number')) return j; } catch { /* default */ }
  return DEFAULT_STARTS;
}

export default function VisitReport() {
  const nav = useNavigate();
  const { settings, products, recipes } = useData();
  const patient = usePatient();
  const [days, setDays] = useState<VisitDays>(14);
  const [foodDays, setFoodDays] = useState<FoodDays>(7);
  const [pageLang, setPageLang] = useState<Lang>(lang());
  const [job, setJob] = useState<Job | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const low = rng.low ?? 70, high = rng.high ?? 180;
  const filename = `Layan-visit-report-${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}.pdf`;
  // the progress words, fixed in the app's language before the family pages switch theirs
  const W = { load: t('جارٍ قراءة البيانات…'), pages: t('جارٍ تجهيز الصفحات…'), pdf: t('جارٍ إنشاء PDF…') };

  const share = async (b: Blob) => {
    try { const r = await sharePdf(b, filename, t('تقرير الزيارة')); if (r === 'downloaded') toast(t('حُفظ الملف ✓')); setBlob(null); }
    catch (e) { if ((e as Error).name === 'NotAllowedError') setBlob(b); else toast(t('تعذّرت المشاركة: {e}', { e: (e as Error).message })); }
  };

  const make = async () => {
    if (blob) return share(blob);
    let restore: (() => void) | null = null;
    // paper is always in day colours: at night the night theme would otherwise put light text on the white pages
    const root0 = document.documentElement, theme0 = root0.dataset.theme;
    root0.dataset.printing = '1'; root0.dataset.theme = 'day';
    const unprint = () => { delete root0.dataset.printing; if (theme0) root0.dataset.theme = theme0; else delete root0.dataset.theme; };
    try {
      const now = Date.now();
      setStep(W.load);
      const { from, to } = reportPeriod(days, now);
      const data = await loadReportData(from, to);
      const models = buildVisitModels(data, days, now);
      if (pageLang !== lang()) restore = swapLang(pageLang);
      const today = dayStartOf(now);
      const sheets = await loadDaySheets(today - (foodDays - 1) * DAY, today, loadStarts(), { products, recipes, low, high });
      setStep(W.pages);
      await new Promise<void>((done) => setJob({ models, data, sheets, lang: pageLang, done }));
      const root = holder.current!;
      await waitFor(() => Array.from(root.querySelectorAll<HTMLElement>('[data-part]')).every((el) => el.dataset.ready === '1') && !!root.querySelector('[data-part="plans"] main[data-ready="1"]'));
      root.querySelectorAll<HTMLDetailsElement>('[data-part="growth"] details').forEach((d) => { d.open = true; }); // growth's sections open on paper (the meal plans open their own)
      await wait(800); // the daily sheets shrink busy days to fit their page
      setStep(W.pdf);
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      doc.setProperties({ title: `Visit report ${models.agp.label}`, subject: 'Clinic visit: doctor and dietitian', creator: "Layan's carb & insulin app" });
      const part = (k: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-part="${k}"] > *`));
      await addHtmlPages(doc, part('cover'), { orientation: 'portrait', fit: 'flow', firstOnCurrent: true });
      drawVisitDoctor(doc, models, patient, __APP_VERSION__);
      await addHtmlPages(doc, Array.from(root.querySelectorAll<HTMLElement>('[data-part="plans"] main > *')), { orientation: 'portrait', fit: 'flow' });
      await addHtmlPages(doc, part('growth'), { orientation: 'portrait', fit: 'flow' });
      const dietPages = Array.from(root.querySelectorAll<HTMLElement>('[data-part="diet"] .diet-page'));
      if (dietPages.length) await addHtmlPages(doc, dietPages, { orientation: 'landscape', fit: 'page' });
      await addHtmlPages(doc, part('doctorcheck'), { orientation: 'portrait', fit: 'flow' });
      await addHtmlPages(doc, part('notes'), { orientation: 'portrait', fit: 'flow' });
      restore?.(); restore = null;
      setJob(null); setStep(null);
      await share(doc.output('blob'));
    } catch (e) {
      toast(t('تعذّر إنشاء PDF: {e}', { e: (e as Error).message }));
    } finally { restore?.(); unprint(); setJob(null); setStep(null); }
  };

  const seg = (on: boolean) => cx('min-h-[40px] rounded-full px-3 text-sm font-bold', on ? 'bg-brand text-white' : 'text-slate-600');
  return (
    <Page title={t('تقرير الزيارة')} back={() => nav(-1)}>
      <div className="space-y-3">
        <Card className="space-y-3">
          <p className="text-sm text-slate-600">{t('ملف PDF واحد للطبيب وأخصائية التغذية: شاركوه أو اطبعوه.')}</p>
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-slate-600">{t('الفترة')}</div>
            <div className="flex gap-1.5">{VISIT_PERIODS.map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{t('{n} يوم', { n: d })}</Chip>)}</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-slate-600">{t('لغة صفحات العائلة والتغذية')}</div>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-50 p-1" role="radiogroup">
              <button role="radio" aria-checked={pageLang === 'ar'} onClick={() => setPageLang('ar')} className={seg(pageLang === 'ar')}>العربية</button>{/* i18n-ok: the language's own name */}
              <button role="radio" aria-checked={pageLang === 'en'} onClick={() => setPageLang('en')} className={seg(pageLang === 'en')}>English</button>
            </div>
            <p className="text-xs text-slate-500">{t('تقارير الطبيب تبقى بالإنجليزي كما تتوقعها العيادة.')}</p>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-slate-600">{t('جدول التغذية اليومي')}</div>
            <div className="flex gap-1.5">{([7, 14] as const).map((d) => <Chip key={d} active={foodDays === d} onClick={() => setFoodDays(d)}>{t('آخر {n} أيام', { n: d })}</Chip>)}</div>
          </div>
          <Btn kind="primary" block disabled={!!step} onClick={make}>{step ?? (blob ? t('PDF جاهز · اضغطوا للمشاركة') : t('أنشئ تقرير الزيارة'))}</Btn>
        </Card>
        <Card className="space-y-1.5 text-sm">
          <div className="font-bold">{t('ما في التقرير')}</div>
          <ol className="list-decimal space-y-0.5 ps-5 text-slate-600">
            <li>{t('الغلاف: الفترة، بيانات الحساس، أرقام الطبيب المستخدمة، وملخص سريع')}</li>
            <li>{t('للطبيب (بالإنجليزي): تقرير AGP، الملخص، الأسابيع أو الشهر، أنماط الوجبات، الانخفاضات والارتفاعات')}</li>
            <li>{t('الوجبات المخططة: الجرعة المحسوبة والمعطاة')}</li>
            <li>{t('النمو والتغذية: الوزن والطول، الطاقة، التوازن')}</li>
            <li>{t('جدول التغذية: صفحة لكل يوم')}</li>
            <li>{t('أرقام الطبيب والسكر الفعلي: هل انتهت الوجبات والتصحيح حيث توقعت الأرقام المحفوظة، مع الأسئلة')}</li>
            <li>{t('ملاحظات وأسئلة لفريق الرعاية: ما وجده التطبيق في بياناتها، بالدليل، مع سؤال لكل ملاحظة ومكان لملاحظات الطبيب')}</li>
          </ol>
          <p className="text-xs text-slate-500">{t('ملاحظات من بياناتها، وليست توصية بجرعة.')}</p>
        </Card>
      </div>
      {job && createPortal(
        <div ref={holder} className="visit-capture" dir={job.lang === 'en' ? 'ltr' : 'rtl'} lang={job.lang} aria-hidden
          style={{ position: 'fixed', left: -12000, top: 0, width: 760, background: '#fff', zIndex: -1 }}>
          <VisitPages job={job} low={low} high={high} days={days} />
        </div>, document.body)}
    </Page>
  );
}

/** Everything pictured into the PDF, in the chosen language. Each part says when it is ready. */
function VisitPages({ job, low, high, days }: { job: Job; low: number; high: number; days: VisitDays }) {
  const { settings, products, history, events } = useData();
  const { portions } = usePortions();
  const g = useGrowthNutrition();
  const { g: live } = useGlucose();
  const dc = useDoctorCheck(live?.sensor?.started_at ? Date.parse(live.sensor.started_at) : null);
  // the observations, once the nutrition model is ready (it feeds the dietitian's findings)
  const obs = useMemo(() => {
    if (!g.ready) return null;
    const per = days > 14 ? 'd30' as const : 'd7' as const, a = g.avg[per], E = a.energy.est;
    const share = (k: 'carbs' | 'fat' | 'protein', kcalPerG: number) => { const v = a.nutrients[k]?.est; return v != null && E ? (v * kcalPerG * 100) / E : null; };
    const pc = (z: number | null | undefined) => (z == null ? null : Math.round(100 * pnorm(z)));
    // the latest weight, height and BMI, each from the last measurement that has it
    const lastWith = (k: 'weight_kg' | 'height_cm' | 'bmi') => [...g.points].reverse().find((p) => p[k] != null) ?? null;
    const Lw = lastWith('weight_kg'), Lh = lastWith('height_cm'), Lb = lastWith('bmi');
    const L = g.growth.latest ?? Lw;
    const nutrition: NutritionIn = {
      days: a.days, enough: a.enough, kcal: a.totalKcal, ref: g.energyRef, energyState: g.energy[per], coverage: a.energy.coverage,
      pct: { carbs: share('carbs', 4), fat: share('fat', 9), protein: share('protein', 4) },
      balanceState: g.bal[per].state, issues: g.bal[per].issues,
      growth: { state: g.growth.state, measurements: g.measurements.length, change90: g.growth.change.d90, reasons: g.growth.reasons,
        latest: L ? { on: L.on, weight: Lw?.weight_kg ?? null, height: Lh?.height_cm ?? null, pW: pc(Lw?.z.wfa), pH: pc(Lh?.z.hfa), pBmi: pc(Lb?.z.bmi) } : null },
    };
    const night = nightOf(settings);
    return buildObservations({
      readings: job.data.readings, from: job.models.from, to: job.models.to, now: job.models.now, insulin: job.data.insulin, meals: job.data.meals, treatments: job.data.treatments,
      mealtime: job.models.mealtime,
      makeup: history.map((h) => ({ at: Date.parse(h.eaten_at), fat: h.total_fat == null ? null : Number(h.total_fat), protein: h.total_protein == null ? null : Number(h.total_protein), name: h.name ?? null })),
      activities: events.filter((e) => e.kind === 'exercise' && !e.deleted_at).map((e) => Date.parse(e.occurred_at)),
      lowMg: low, highMg: high, night: { start: night?.start ?? '21:00', end: night?.end ?? '07:00' }, ratios: settings.ratios ?? [], nutrition,
    });
  }, [g, job, days, history, events, settings, low, high]);
  const ctx: Ctx = { g: (mg: number) => formatGlucose(mg, settings.glucose_unit), low, high, products, portions };
  const patient = usePatient();
  const child = (isEn() && patient.name) || settings.child_name || t('ليان');
  useEffect(() => { job.done(); }, [job]);
  const period = days > 14 ? 'd30' as const : 'd7' as const;
  return (
    <>
      <div data-part="cover" data-ready="1" className="space-y-3 p-4"><Cover m={job.models} /></div>
      <div data-part="plans" className="p-4" data-ready="1"><PlanReport print fixedDays={days} /></div>
      <div data-part="growth" data-ready={g.ready ? '1' : '0'} className="space-y-3 p-4">
        <h1 className="text-xl font-bold">{t('النمو والتغذية')}</h1>
        {g.ready && <><Summary g={g} period={period} /><DailyAverage g={g} period={period} /><GrowthSection g={g} onAdd={() => {}} onEdit={() => {}} /><MealPatterns g={g} period={period} /></>}
      </div>
      <div data-part="diet" data-ready="1" style={{ width: '281mm' }}>
        {job.sheets.map((s) => <div key={s.start}>
          <SheetPage s={s} unit={settings.glucose_unit} low={low} high={high} child={child} rapidName={settings.rapid_insulin} basalName={settings.basal_insulin} ratios={settings.ratios} ctx={ctx} />
          <EventsPages s={s} unit={settings.glucose_unit} low={low} high={high} child={child} ctx={ctx} />
        </div>)}
      </div>
      <div data-part="doctorcheck" data-ready={dc.check || dc.error ? '1' : '0'} className="p-4">{dc.check && <DoctorCheckSection check={dc.check} unit={settings.glucose_unit} />}</div>
      <div data-part="notes" data-ready={obs ? '1' : '0'} className="space-y-3 p-4">{obs && <ObservationsSection obs={obs} unit={settings.glucose_unit} />}</div>
    </>
  );
}

const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x)}%`);
const Row = ({ k, v, goal }: { k: string; v: string; goal?: string }) => (
  <tr className="border-b border-slate-100"><td className="py-1 pe-3 text-slate-600">{k}</td><td className="num py-1 pe-3 font-bold" dir="ltr">{v}</td><td className="py-1 text-xs text-slate-500">{goal}</td></tr>
);

function Cover({ m }: { m: VisitModels }) {
  const { settings: s } = useData();
  const patient = usePatient();
  const f = visitFacts(m);
  const u = unitLabel(s.glucose_unit), gl = (mg: number) => formatGlucose(mg, s.glucose_unit);
  const longs = (m.snapshot.insulin.long ?? null);
  const age = ageText(patient.birthDate, m.now);
  return (
    <>
      <header className="border-b-2 border-brand pb-2">
        <div className="text-2xl font-bold text-brand">{t('تقرير الزيارة')} · <bdi>{(isEn() && patient.name) || s.child_name || t('ليان')}</bdi></div>
        <div className="text-sm text-slate-600">{t('للطبيب وأخصائية التغذية')}{patient.clinic ? ` · ${patient.clinic}` : ''}</div>
        <div className="mt-1 text-sm"><bdi dir="ltr">{kwDate(m.from)} – {kwDate(m.to - DAY)}</bdi> · {t('{n} يوم', { n: m.days })}{age ? <> · {t('العمر')} <bdi dir="ltr">{age}</bdi>{patient.birthApprox ? ` (${t('تقريبي')})` : ''}</> : null}</div>
      </header>
      <section className="rounded-xl border border-slate-200 p-3">
        <h2 className="mb-1 font-bold">{t('السكر بنظرة')}</h2>
        <table className="w-full text-sm"><tbody>
          <Row k={t('الوقت في النطاق 3.9–10')} v={pct(f.tir)} goal={t('الهدف أكثر من 70%')} />
          <Row k={t('الوقت تحت النطاق')} v={pct(f.tbr)} goal={t('الهدف أقل من 4%')} />
          <Row k={t('الوقت فوق النطاق')} v={pct(f.tar)} goal={t('الهدف أقل من 25%')} />
          <Row k={t('مؤشر السكر التراكمي المقدّر (GMI)')} v={f.gmi == null ? '–' : `${f.gmi.toFixed(1)}%`} goal={t('الهدف 6.5% أو أقل')} />
          <Row k={t('التذبذب (CV)')} v={pct(f.cv)} goal={t('الهدف 36% أو أقل')} />
          <Row k={t('بيانات الحساس')} v={pct(f.active)} goal={t('يكفي 70% أو أكثر')} />
          <Row k={t('الانخفاضات')} v={`${f.lows}`} goal={t('منها {n} في الليل', { n: f.nightLows })} />
        </tbody></table>
      </section>
      <section className="rounded-xl border border-slate-200 p-3">
        <h2 className="mb-1 font-bold">{t('أرقام الطبيب المستخدمة الآن')}</h2>
        <div className="grid grid-cols-3 gap-x-3 text-sm">
          <div className="py-1 text-xs text-slate-500">{t('من الساعة')}</div><div className="py-1 text-xs text-slate-500">{t('غ لكل وحدة')}</div><div className="py-1 text-xs text-slate-500">{t('التصحيح ({u} لكل وحدة)', { u })}</div>
          {(s.ratios ?? []).map((r) => [
            <div key={r.from + 'a'} className="num border-t border-slate-100 py-1 font-bold" dir="ltr">{r.from}</div>,
            <div key={r.from + 'b'} className="num border-t border-slate-100 py-1 font-bold">{r.cr}</div>,
            <div key={r.from + 'c'} className="num border-t border-slate-100 py-1 font-bold">{gl(r.isf)}</div>,
          ])}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
          {s.target_mgdl != null && s.target_high_mgdl != null && <div>{t('هدف الجرعة')}: <bdi className="num" dir="ltr">{gl(s.target_mgdl)}–{gl(s.target_high_mgdl)}</bdi> {u}</div>}
          {s.pen_step != null && <div>{t('خطوة القلم')}: <span className="num">{s.pen_step}</span></div>}
          {s.rapid_insulin && <div>{t('الإنسولين السريع')}: <bdi>{s.rapid_insulin}</bdi></div>}
          {s.basal_insulin && <div>{t('الإنسولين الطويل')}: <bdi>{s.basal_insulin}</bdi>{longs != null ? <> · {t('المتوسط {v} وحدة يوميًا', { v: longs.toFixed(1) })}</> : null}</div>}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 p-3 text-sm">
        <h2 className="mb-1 font-bold">{t('محتويات التقرير')}</h2>
        <ol className="list-decimal space-y-0.5 ps-5">
          <li>{t('للطبيب (بالإنجليزي): تقرير AGP، الملخص، الأسابيع أو الشهر، أنماط الوجبات، الانخفاضات والارتفاعات')}</li>
          <li>{t('الوجبات المخططة: الجرعة المحسوبة والمعطاة')}</li>
          <li>{t('النمو والتغذية: الوزن والطول، الطاقة، التوازن')}</li>
          <li>{t('جدول التغذية: صفحة لكل يوم')}</li>
          <li>{t('ملاحظات وأسئلة لفريق الرعاية: ما وجده التطبيق في بياناتها، بالدليل، مع سؤال لكل ملاحظة ومكان لملاحظات الطبيب')}</li>
        </ol>
      </section>
      <p className="text-xs text-slate-500" dir="ltr">{VALIDATION_NOTE}</p>
      <p className="text-xs text-slate-500">{t('ملاحظات من بياناتها، وليست توصية بجرعة.')}</p>
    </>
  );
}

/** Standard normal CDF (growth z-score → percentile). Abramowitz–Stegun 7.1.26. */
function pnorm(z: number) {
  const x = Math.abs(z) / Math.SQRT2, k = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
