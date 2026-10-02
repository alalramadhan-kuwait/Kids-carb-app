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
import { fetchSeries } from '../engine/useSeries';
import { nightRows, type NightRow } from '../engine/nights';
import { locale, t } from '../i18n';

/** A one-page summary for the clinic visit: AGP, time in ranges, the standard numbers, and what was logged. */
export default function Report() {
  const nav = useNavigate();
  const { settings, history, events } = useData();
  const [days, setDays] = useState(14);
  const [bins, setBins] = useState<Bin[] | null>(null);
  const [st, setSt] = useState<GlucoseStats | null>(null);
  const [nights, setNights] = useState<NightRow[] | null>(null);
  const unit = settings.glucose_unit;
  const to = dayStartOf(Date.now()) + 86400000, from = to - days * 86400000;
  useEffect(() => {
    supabase.rpc('glucose_profile', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(), p_dows: null, p_bin_min: 15 })
      .then(({ data }) => setBins(((data ?? []) as Bin[]).map((b) => ({ ...b, p10: +b.p10, p25: +b.p25, p50: +b.p50, p75: +b.p75, p90: +b.p90 }))));
    glucoseStats(new Date(from), new Date(Math.min(to, Date.now())), settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setSt);
    const treat = events.filter((e) => !e.deleted_at && e.kind === 'treatment').map((e) => Date.parse(e.occurred_at));
    fetchSeries(from, Math.min(to, Date.now())).then((s) => setNights(nightRows(s.t, s.v, treat, from, Math.min(to, Date.now()), settings.night_start, settings.night_end).filter((n) => n.coverage >= 0.5)))
      .catch(() => setNights([]));
  }, [days]);
  const tot = dayTotals(history, events, from, to);
  const d = (t: number) => new Date(t).toLocaleDateString(locale(), { timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  const basal = events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type === 'long' && e.insulin_units && Date.parse(e.occurred_at) >= from && Date.parse(e.occurred_at) < to);
  const basalDays = new Set(basal.map((e) => dayStartOf(Date.parse(e.occurred_at)))).size;
  const basalAvg = basalDays ? basal.reduce((s, e) => s + e.insulin_units!, 0) / basalDays : null;
  const lowNights = nights ? nights.filter((n) => n.min !== null && n.min < 70).length : 0;
  const cv = st?.mean && st.sd !== null ? (st.sd / st.mean) * 100 : null;
  const g = (mg: number) => formatGlucose(mg, unit);
  const bands: [string, number | undefined, string][] = [
    [t('مرتفع جدًا · فوق {x}', { x: g(250) }), st?.pct_vhigh, 'bg-near'], [t('مرتفع · {a} إلى {b}', { a: g(181), b: g(250) }), st?.pct_high, 'bg-near-fill'],
    [t('ضمن النطاق · {a} إلى {b}', { a: g(70), b: g(180) }), st?.pct_in, 'bg-ok-fill'],
    [t('منخفض · {a} إلى {b}', { a: g(54), b: g(69) }), st?.pct_low, 'bg-over-fill'], [t('منخفض جدًا · تحت {x}', { x: g(54) }), st?.pct_vlow, 'bg-over'],
  ];
  return (
    <main className="report mx-auto max-w-3xl space-y-4 bg-white p-5 text-[rgb(38,30,92)] print:p-0">
      <div className="space-y-2 print:hidden">
        <div className="flex items-center gap-2">
          <Btn kind="ghost" onClick={() => nav(-1)}>{t('رجوع')}</Btn>
          <Btn kind="primary" className="flex-1" onClick={() => window.print()}>{t('طباعة أو حفظ PDF')}</Btn>
        </div>
        <div className="flex gap-1.5">{[14, 30, 90].map((x) => <Chip key={x} active={days === x} onClick={() => setDays(x)}>{t('{n} يوم', { n: x })}</Chip>)}</div>
      </div>
      <header className="border-b border-slate-200 pb-2">
        <h1 className="text-2xl font-bold">{t('تقرير السكر · {name}', { name: settings.child_name })}</h1>
        <p className="text-sm text-slate-600">{d(from)} – {d(to - 1)} · {t('{n} يومًا', { n: days })} · {unitLabel(unit)} · {t('من حساس Libre عبر LibreLinkUp')}</p>
      </header>
      <section className="grid grid-cols-4 gap-2 text-center">
        {[[t('المتوسط'), st?.mean != null ? formatGlucose(st.mean, unit) : '—'], ['GMI', st?.mean != null && st.coverage >= 70 && days >= 14 ? `${gmi(st.mean).toFixed(1)}%` : '—'],
          [t('التذبذب CV'), cv !== null ? `${cv.toFixed(1)}%` : '—'], [t('تغطية البيانات'), st ? `${Math.round(st.coverage)}%` : '—']].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 p-2"><div className="num text-xl font-bold">{v}</div><div className="text-xs text-slate-600">{l}</div></div>
        ))}
      </section>
      <section className="flex gap-4">
        <div className="flex h-44 w-6 flex-col-reverse overflow-hidden rounded" aria-hidden>
          {[...bands].reverse().map(([l, v, c]) => <i key={l} className={c} style={{ height: `${v ?? 0}%` }} />)}
        </div>
        <ul className="flex-1 space-y-1.5 text-sm">
          {bands.map(([l, v, c]) => <li key={l} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-sm ${c}`} /><span className="flex-1">{l}</span><b className="num">{v != null ? `${v.toFixed(1)}%` : '—'}</b></li>)}
          <li className="pt-1 text-xs text-slate-500">{t('الأهداف المرجعية الدولية: ضمن النطاق أكثر من 70%، تحت {a} أقل من 4%، تحت {b} أقل من 1%، والتذبذب 36% أو أقل.', { a: g(70), b: g(54) })}</li>
        </ul>
      </section>
      <section>
        <h2 className="mb-1 font-bold">{t('ملف السكر اليومي (AGP)')}</h2>
        {bins ? <ProfileChart bins={bins} unit={unit} range={effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl)} /> : <p>…</p>}
        <p className="text-xs text-slate-500">{t('الوسيط، و25–75%، و10–90% على مدار 24 ساعة. الفترات التي فيها أقل من 5 أيام مرسومة متقطعة.')}</p>
      </section>
      <section className="grid grid-cols-4 gap-2 text-center text-sm">
        {[[t('وجبات مسجّلة'), String(tot.meals)], [t('متوسط الكارب يوميًا'), t('{x} غ', { x: fmt(tot.carbs / days) })], [t('إنسولين سريع يوميًا'), t('{x} و', { x: fmt(tot.rapid / days) })], [t('علاج انخفاض'), t('{x} غ', { x: fmt(tot.treatment) })]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 p-2"><div className="num font-bold">{v}</div><div className="text-xs text-slate-600">{l}</div></div>
        ))}
      </section>
      <section className="space-y-1 text-sm">
        <h2 className="font-bold">{t('العلاج المسجّل في التطبيق')}</h2>
        <p>{t('السريع')}: <b dir="auto">{settings.rapid_insulin ?? '—'}</b>{settings.iob_dia_min ? <> · {t('مدة العمل {h} س، الذروة {m} د', { h: Math.round(settings.iob_dia_min / 6) / 10, m: settings.iob_peak_min ?? '—' })}</> : null}</p>
        <p>{t('الطويل')}: <b dir="auto">{settings.basal_insulin ?? '—'}</b>{basalAvg !== null ? <> · {t('متوسط {u} وحدة يوميًا ({n} يوم مسجّل)', { u: fmt(basalAvg), n: basalDays })}</> : null}</p>
        {(settings.ratios ?? []).map((r) => <p key={r.from}>{t('من {from}: كارب {cr} غ لكل وحدة · تصحيح {isf} {unit} لكل وحدة', { from: r.from, cr: fmt(r.cr), isf: formatGlucose(r.isf, unit), unit: unitLabel(unit) })}</p>)}
        {settings.target_mgdl !== null && settings.target_high_mgdl !== null && <p>{t('هدف التصحيح {a} إلى {b}', { a: g(settings.target_mgdl), b: g(settings.target_high_mgdl) })}</p>}
      </section>
      {nights && nights.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-bold">{t('الليالي')}</h2>
          <p className="text-sm">{t('{k} من {n} ليلة نزل فيها السكر تحت {x}.', { k: lowNights, n: nights.length, x: g(70) })}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="py-1 text-start font-medium">{t('الليلة')}</th><th className="text-center font-medium">{t('أدنى قراءة')}</th><th className="text-center font-medium">{t('تحت {x}', { x: g(70) })}</th><th className="text-center font-medium">{t('علاج انخفاض')}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {nights.slice(-14).reverse().map((n) => (
                <tr key={n.start} className={n.min !== null && n.min < 70 ? 'font-bold' : ''}>
                  <td className="py-1">{d(n.start)}</td>
                  <td className="text-center"><span className="num">{n.min !== null ? g(n.min) : '—'}</span></td>
                  <td className="text-center">{n.minutesBelow ? t('{m} د', { m: n.minutesBelow }) : '—'}</td>
                  <td className="text-center"><span className="num">{n.treatments || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500">{t('ساعات الليل من الإعدادات ({a}–{b}). القراءات من الحساس؛ الانخفاض الليلي قد يكون أحيانًا من الضغط على الحساس أثناء النوم.', { a: (settings.night_start ?? '22:00').slice(0, 5), b: (settings.night_end ?? '06:00').slice(0, 5) })}</p>
        </section>
      )}
      <p className="text-[11px] text-slate-500">{t('مما سجّله الأهل في التطبيق؛ قد لا يشمل كل شيء. الأرقام للنقاش مع الفريق الطبي.')}</p>
    </main>
  );
}
