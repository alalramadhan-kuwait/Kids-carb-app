// The iPhone widget: Scriptable (a free App Store app that runs scripts as widgets). The family pastes a small
// loader, made here with the widget's own read-only share link inside. The loader fetches the widget itself from
// the app (public/widget/layan-widget.js) each time it runs, keeping the last copy for when the phone is offline,
// so a change to the widget reaches the phone without pasting again. The link can be revoked from Share.

export interface LoaderConfig { url: string; key: string; token: string; app: string; lang: 'ar' | 'en' }

export const WIDGET_MARK = '// LAYAN_WIDGET';

export function widgetLoader(c: LoaderConfig): string {
  const J = (v: string) => JSON.stringify(v);
  const fail = c.lang === 'ar' ? 'تعذّر تحميل الويدجت. تأكدوا من الاتصال بالإنترنت.' : 'Could not load the widget. Check the internet connection.'; // i18n-ok: data, shown inside Scriptable
  return `// Layan · glucose widget (loader). It fetches the widget from the Layan app each time, so updates arrive by
// themselves. Read-only; the link inside can be revoked in the app under "Sharing and reports".
const TOKEN = (args.widgetParameter || "").trim() || ${J(c.token)};
const LANG = ${J(c.lang)};
const APP = ${J(c.app)};
const SUPABASE = ${J(c.url)};
const KEY = ${J(c.key)};
const fm = FileManager.local();
const saved = fm.joinPath(fm.cacheDirectory(), "layan-widget-code.js");
let code = null;
try {
  const r = new Request(APP + "widget/layan-widget.js");
  r.timeoutInterval = 15;
  const s = await r.loadString();
  if (r.response && r.response.statusCode === 200 && s.startsWith(${J(WIDGET_MARK)})) { code = s; fm.writeString(saved, s); }
} catch (e) {}
if (!code && fm.fileExists(saved)) code = fm.readString(saved);
if (code) {
  const run = new (Object.getPrototypeOf(async function () {}).constructor)("TOKEN", "LANG", "APP", "SUPABASE", "KEY", code);
  await run(TOKEN, LANG, APP, SUPABASE, KEY);
} else {
  const w = new ListWidget();
  w.addText(${J(fail)});
  if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
  Script.complete();
}
`;
}
