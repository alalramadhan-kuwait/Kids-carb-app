// The visit report: one button, one PDF for a clinic visit with the doctor and the dietitian. The clinical sections
// are the doctor reports, drawn in English (visitPdf.ts). The family's sections — cover, meal plans, growth and
// nutrition, the dietitian's daily sheets, notes — are laid out here, hidden, in the language chosen for them, then
// pictured onto the same PDF. Nothing here calculates or suggests a dose.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Btn, Card, Chip, Page, cx, toast } from '../components/ui';
import { useData } from '../lib/data';
import { usePortions } from '../lib/mom';
import { loadReportData } from '../lib/reportData';
import { usePatient } from '../lib/useReport';
import { addHtmlPages, sharePdf } from '../lib/pdfShare';
import { VISIT_PERIODS, buildVisitModels, drawVisitDoctor, visitFacts, type VisitDays, type VisitModels } from '../lib/visitPdf';
import { ageText } from '../lib/reportPdf';
import { dayStartOf } from '../engine/day';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { DEFAULT_STARTS, SLOT_KEYS, type DaySheet, type SlotStarts } from '../lib/dietSheet';
import { EventsPages, SheetPage, loadDaySheets, type Ctx } from './DietSheet';
import { DailyAverage, GrowthSection, MealPatterns, Summary } from './Growth';
import { PlanReport } from './PlanReport';
import { useGrowthNutrition } from '../lib/growth';
import { kwDate, reportPeriod, VALIDATION_NOTE } from '../engine/report/agpReport';
import { isEn, lang, swapLang, t, type Lang } from '../i18n';

const DAY = 86400000;
type FoodDays = 7 | 14;
interface Job { models: VisitModels; sheets: DaySheet[]; lang: Lang; done: () => void }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(ok: () => boolean, ms = 25000) {
  const t0 = Date.now();
  while (!ok()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(150); }
}
function loadStarts(): SlotStarts {
  try { const j = JSON.parse(localStorage.getItem('diet-sheet-starts') ?? 'null'); if (j && SLOT_KEYS.every((k) => typeof j[k] === 'number')) return j; } catch { /* default */ }
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
      await new Promise<void>((done) => setJob({ models, sheets, lang: pageLang, done }));
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
      await addHtmlPages(doc, part('notes'), { orientation: 'portrait', fit: 'flow' });
      restore?.(); restore = null;
      setJob(null); setStep(null);
      await share(doc.output('blob'));
    } catch (e) {
      toast(t('تعذّر إنشاء PDF: {e}', { e: (e as Error).message }));
    } finally { restore?.(); setJob(null); setStep(null); }
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
            <li>{t('ملاحظات الزيارة: ما تُظهره البيانات، وأسطر لأسئلتكم')}</li>
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
  const { settings, products } = useData();
  const { portions } = usePortions();
  const g = useGrowthNutrition();
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
      <div data-part="notes" data-ready="1" className="space-y-3 p-4"><Notes m={job.models} /></div>
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
          <li>{t('ملاحظات الزيارة: ما تُظهره البيانات، وأسطر لأسئلتكم')}</li>
        </ol>
      </section>
      <p className="text-xs text-slate-500" dir="ltr">{VALIDATION_NOTE}</p>
      <p className="text-xs text-slate-500">{t('ملاحظات من بياناتها، وليست توصية بجرعة.')}</p>
    </>
  );
}

const SLOT_WORD: Record<string, string> = { breakfast: 'الإفطار', lunch: 'الغداء', dinner: 'العشاء', snack: 'السناكات' }; // i18n-ok: shown through t()

function Notes({ m }: { m: VisitModels }) {
  const f = visitFacts(m);
  const g1 = (x: number | null) => (x == null ? '–' : x.toFixed(1));
  const lines = (n: number) => Array.from({ length: n }, (_, i) => <div key={i} className="h-8 border-b border-slate-300" />);
  return (
    <>
      <h1 className="text-xl font-bold">{t('ملاحظات الزيارة')}</h1>
      <section className="rounded-xl border border-slate-200 p-3 text-sm">
        <h2 className="mb-1 font-bold">{t('ما تُظهره البيانات')}</h2>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t('الوقت في النطاق {a}، تحت النطاق {b}، فوق النطاق {c}', { a: pct(f.tir), b: pct(f.tbr), c: pct(f.tar) })}</li>
          <li>{t('{n} انخفاض، منها {k} في الليل · {h} ارتفاع شديد', { n: f.lows, k: f.nightLows, h: f.veryHighs })}</li>
          {f.meals.map((x) => <li key={x.slot}>{t(SLOT_WORD[x.slot])}: {t('قبل الأكل {a}، بعد ساعتين {b} mmol/L ({n} مرة)', { a: g1(x.pre), b: g1(x.at2h), n: x.sittings })}{x.lowsAfter ? ` · ${t('انخفاض بعدها {n} مرة', { n: x.lowsAfter })}` : ''}</li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500">{t('ملاحظات من بياناتها، وليست توصية بجرعة.')}</p>
      </section>
      <section className="rounded-xl border border-slate-200 p-3"><h2 className="font-bold">{t('أسئلة للطبيب')}</h2>{lines(6)}</section>
      <section className="rounded-xl border border-slate-200 p-3"><h2 className="font-bold">{t('أسئلة لأخصائية التغذية')}</h2>{lines(6)}</section>
    </>
  );
}
