import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { buildCsv } from '../lib/export';
import { sinceText } from '../lib/now';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Alert, Btn, Card, Chip, Field, Page, cx, inputCls, toast } from '../components/ui';
import { isEn, locale, t } from '../i18n';

type LinkRow = { id: string; scope: 'school' | 'viewer'; label: string; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null };
const appUrl = () => location.href.split('#')[0];

/** المشاركة والتقارير: read-only links (school, family), CSV export, and the clinic report. */
export default function SharePage() {
  const nav = useNavigate();
  const { nameOf } = useData();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [scope, setScope] = useState<'school' | 'viewer'>('school');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(30);
  const [fresh, setFresh] = useState<string | null>(null);
  const [exportDays, setExportDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const load = async () => { const { data } = await supabase.from('share_links').select('*').order('created_at', { ascending: false }); setLinks((data ?? []) as LinkRow[]); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const { data, error } = await supabase.rpc('create_share_link', { p_scope: scope, p_label: label.trim() || (scope === 'school' ? t('المدرسة') : t('العائلة')), p_days: days });
    if (error) return toast(error.message);
    const url = `${appUrl()}#/s/${data}`;
    setFresh(url); setLabel(''); load();
    try { await navigator.clipboard.writeText(url); toast(t('نُسخ الرابط ✓')); } catch { /* shown below to copy by hand */ }
  };
  const revoke = async (id: string) => { if (!confirm(t('إيقاف هذا الرابط؟ يتوقف فورًا.'))) return; await supabase.rpc('revoke_share_link', { p_id: id }); load(); };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const to = new Date(), from = new Date(to.getTime() - exportDays * 86400000);
      const [g, e, h] = await Promise.all([
        supabase.rpc('glucose_series', { p_from: from.toISOString(), p_to: to.toISOString() }),
        supabase.from('events').select('*').gte('occurred_at', from.toISOString()).order('occurred_at').limit(5000),
        supabase.from('meal_history').select('*').gte('eaten_at', from.toISOString()).order('eaten_at').limit(5000),
      ]);
      const ser = g.data as { t: number[]; v: number[] };
      const csv = buildCsv(ser.t.map((t, k) => ({ t: t * 1000, v: ser.v[k] })), (e.data ?? []) as EventRow[], (h.data ?? []) as HistoryEntry[], nameOf);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `layan-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { toast(t('تعذّر التصدير: {msg}', { msg: (err as Error).message })); } finally { setBusy(false); }
  };

  const active = links.filter((l) => !l.revoked_at && Date.parse(l.expires_at) > Date.now());
  return (
    <Page title={t('المشاركة والتقارير')} back={() => nav(-1)}>
      <div className="space-y-3">
        <Card className="space-y-3">
          <h2 className="font-bold">{t('رابط للعرض فقط')}</h2>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {([['school', t('المدرسة'), t('القراءة + خطة الطبيب')], ['viewer', t('العائلة'), t('القراءة فقط')]] as const).map(([v, l, hint]) => (
              <button key={v} role="radio" aria-checked={scope === v} onClick={() => setScope(v)}
                className={cx('min-h-[56px] rounded-2xl px-3 text-start', scope === v ? 'bg-brand text-white' : 'bg-slate-50')}>
                <div className="font-bold">{l}</div><div className={cx('text-xs', scope === v ? 'text-white/80' : 'text-slate-500')}>{hint}</div>
              </button>
            ))}
          </div>
          <Field label={t('اسم للرابط')}><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={scope === 'school' ? t('ممرضة المدرسة') : t('الجدة')} /></Field>
          <div className="flex gap-1.5">{[1, 7, 30, 90].map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d === 1 ? t('يوم') : t('{n} يوم', { n: d })}</Chip>)}</div>
          <Btn kind="primary" block onClick={create}>{t('أنشئ الرابط')}</Btn>
          {fresh && <Alert tone="info"><div className="space-y-1"><div>{t('انسخ الرابط الآن، لن يظهر مرة أخرى:')}</div><div dir="ltr" className="break-all text-xs">{fresh}</div></div></Alert>}
          <p className="text-xs text-slate-500">{t('من معه الرابط يرى القراءة بدون حساب. لا يستطيع التسجيل أو التعديل. أوقفه متى شئتم.')}</p>
        </Card>

        {active.length > 0 && (
          <Card className="!p-0 overflow-hidden">
            <ul className="divide-y divide-slate-100 text-sm">
              {active.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <div className="font-medium">{l.label} <span className="text-xs text-slate-500">· {l.scope === 'school' ? t('مدرسة') : t('عائلة')}</span></div>
                    <div className="text-xs text-slate-500">{t('ينتهي {date}', { date: new Date(l.expires_at).toLocaleDateString(locale(), { timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions) })} · {l.last_used_at ? t('فُتح {when}', { when: sinceText(l.last_used_at) }) : t('لم يُفتح بعد')}</div>
                  </div>
                  <Btn kind="danger" className="!min-h-[40px] !px-3" onClick={() => revoke(l.id)}>{t('إيقاف')}</Btn>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="space-y-3">
          <h2 className="font-bold">{t('تصدير البيانات (CSV)')}</h2>
          <p className="text-sm text-slate-600">{t('القراءات وكل ما سُجّل، بتوقيت الكويت وبالوحدتين. يفتح في Excel أو Numbers.')}</p>
          <div className="flex gap-1.5">{[14, 30, 90].map((d) => <Chip key={d} active={exportDays === d} onClick={() => setExportDays(d)}>{t('{n} يوم', { n: d })}</Chip>)}</div>
          <Btn block disabled={busy} onClick={exportCsv}>{busy ? '…' : t('تنزيل الملف')}</Btn>
        </Card>

        <Link to="/report"><Card className="flex items-center gap-3 !p-4"><div className="flex-1"><div className="font-bold">{t('تقرير للعيادة')}</div><div className="text-sm text-slate-500">{t('صفحة جاهزة للطباعة أو الحفظ PDF')}</div></div><span className="text-slate-400">{isEn() ? '›' : '‹'}</span></Card></Link>
      </div>
    </Page>
  );
}
