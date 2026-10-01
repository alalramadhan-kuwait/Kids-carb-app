import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { gmi } from '../lib/now';
import { fmt } from '../lib/carbs';
import { Btn, Chip } from '../components/ui';
import { ProfileChart } from './Patterns';
import { dayStartOf, dayTotals } from '../engine/day';
import type { Bin } from '../engine/profile';

/** A one-page summary for the clinic visit: AGP, time in ranges, the standard numbers, and what was logged. */
export default function Report() {
  const nav = useNavigate();
  const { settings, history, events } = useData();
  const [days, setDays] = useState(14);
  const [bins, setBins] = useState<Bin[] | null>(null);
  const [st, setSt] = useState<GlucoseStats | null>(null);
  const unit = settings.glucose_unit;
  const to = dayStartOf(Date.now()) + 86400000, from = to - days * 86400000;
  useEffect(() => {
    supabase.rpc('glucose_profile', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(), p_dows: null, p_bin_min: 15 })
      .then(({ data }) => setBins(((data ?? []) as Bin[]).map((b) => ({ ...b, p10: +b.p10, p25: +b.p25, p50: +b.p50, p75: +b.p75, p90: +b.p90 }))));
    glucoseStats(new Date(from), new Date(Math.min(to, Date.now())), settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setSt);
  }, [days]);
  const tot = dayTotals(history, events, from, to);
  const d = (t: number) => new Date(t).toLocaleDateString('ar-KW-u-nu-latn', { timeZone: 'Asia/Kuwait' });
  const cv = st?.mean && st.sd !== null ? (st.sd / st.mean) * 100 : null;
  const g = (mg: number) => formatGlucose(mg, unit);
  const bands: [string, number | undefined, string][] = [
    [`مرتفع جدًا · فوق ${g(250)}`, st?.pct_vhigh, 'bg-near'], [`مرتفع · ${g(181)} إلى ${g(250)}`, st?.pct_high, 'bg-near-fill'], [`ضمن النطاق · ${g(70)} إلى ${g(180)}`, st?.pct_in, 'bg-ok-fill'],
    [`منخفض · ${g(54)} إلى ${g(69)}`, st?.pct_low, 'bg-over-fill'], [`منخفض جدًا · تحت ${g(54)}`, st?.pct_vlow, 'bg-over'],
  ];
  return (
    <main className="report mx-auto max-w-3xl space-y-4 bg-white p-5 text-[rgb(38,30,92)] print:p-0">
      <div className="space-y-2 print:hidden">
        <div className="flex items-center gap-2">
          <Btn kind="ghost" onClick={() => nav(-1)}>رجوع</Btn>
          <Btn kind="primary" className="flex-1" onClick={() => window.print()}>طباعة أو حفظ PDF</Btn>
        </div>
        <div className="flex gap-1.5">{[14, 30, 90].map((x) => <Chip key={x} active={days === x} onClick={() => setDays(x)}>{x} يوم</Chip>)}</div>
      </div>
      <header className="border-b border-slate-200 pb-2">
        <h1 className="text-2xl font-bold">تقرير السكر · {settings.child_name}</h1>
        <p className="text-sm text-slate-600">{d(from)} – {d(to - 1)} · {days} يومًا · {unitLabel(unit)} · من حساس Libre عبر LibreLinkUp</p>
      </header>
      <section className="grid grid-cols-4 gap-2 text-center">
        {[['المتوسط', st?.mean != null ? formatGlucose(st.mean, unit) : '—'], ['GMI', st?.mean != null && st.coverage >= 70 && days >= 14 ? `${gmi(st.mean).toFixed(1)}%` : '—'],
          ['التذبذب CV', cv !== null ? `${cv.toFixed(1)}%` : '—'], ['تغطية البيانات', st ? `${Math.round(st.coverage)}%` : '—']].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 p-2"><div className="num text-xl font-bold">{v}</div><div className="text-xs text-slate-600">{l}</div></div>
        ))}
      </section>
      <section className="flex gap-4">
        <div className="flex h-44 w-6 flex-col-reverse overflow-hidden rounded" aria-hidden>
          {[...bands].reverse().map(([l, v, c]) => <i key={l} className={c} style={{ height: `${v ?? 0}%` }} />)}
        </div>
        <ul className="flex-1 space-y-1.5 text-sm">
          {bands.map(([l, v, c]) => <li key={l} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-sm ${c}`} /><span className="flex-1">{l}</span><b className="num">{v != null ? `${v.toFixed(1)}%` : '—'}</b></li>)}
          <li className="pt-1 text-xs text-slate-500">الأهداف المرجعية الدولية: ضمن النطاق أكثر من 70%، تحت {g(70)} أقل من 4%، تحت {g(54)} أقل من 1%، والتذبذب 36% أو أقل.</li>
        </ul>
      </section>
      <section>
        <h2 className="mb-1 font-bold">ملف السكر اليومي (AGP)</h2>
        {bins ? <ProfileChart bins={bins} unit={unit} range={effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl)} /> : <p>…</p>}
        <p className="text-xs text-slate-500">الوسيط، و25–75%، و10–90% على مدار 24 ساعة. الفترات التي فيها أقل من 5 أيام مرسومة متقطعة.</p>
      </section>
      <section className="grid grid-cols-4 gap-2 text-center text-sm">
        {[['وجبات مسجّلة', String(tot.meals)], ['متوسط الكارب يوميًا', `${fmt(tot.carbs / days)} غ`], ['إنسولين سريع يوميًا', `${fmt(tot.rapid / days)} و`], ['علاج انخفاض', `${fmt(tot.treatment)} غ`]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 p-2"><div className="num font-bold">{v}</div><div className="text-xs text-slate-600">{l}</div></div>
        ))}
      </section>
      <p className="text-[11px] text-slate-500">مما سجّله الأهل في التطبيق؛ قد لا يشمل كل شيء. التطبيق لا يحسب ولا يقترح جرعات. الأرقام للنقاش مع الفريق الطبي.</p>
    </main>
  );
}
