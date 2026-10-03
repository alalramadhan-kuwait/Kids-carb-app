// LAYAN_WIDGET v2
// The Layan iPhone widget (Scriptable). Served with the app and run by the small loader the family pasted into
// Scriptable, so changes reach the phone without pasting again. Run as an async function body with TOKEN, LANG,
// APP, SUPABASE and KEY from the loader. Read-only: it calls carb.share_view with the widget's own share link.
// Insulin and carbs on board use the same model and inputs as the app (src/engine/iob.ts); the tests check both agree.

const WORDS = {
  ar: {
    child: "ليان", old: "قراءة قديمة", urgent: "منخفض جدًا", low: "منخفض", high: "مرتفع", ok: "ضمن النطاق", now: "الآن",
    ago: "قبل {m} د", in15: "خلال 15 د", expired: "الرابط انتهى", noReading: "لا قراءة",
    revoked: "الرابط انتهى أو أُلغي. أنشئوا ويدجت جديدًا من التطبيق: المزيد ← ويدجت الآيفون.",
    offline: "لا اتصال الآن. سيحاول مرة أخرى.", none: "لا توجد قراءات في آخر 3 ساعات.", cached: "بلا اتصال: آخر نسخة",
  },
  en: {
    child: "Layan", old: "Old reading", urgent: "Very low", low: "Low", high: "High", ok: "In range", now: "now",
    ago: "{m} min ago", in15: "in 15 min", expired: "Link expired", noReading: "No reading",
    revoked: "The link expired or was revoked. Make a new widget in the app: More → iPhone widget.",
    offline: "No connection right now. It will try again.", none: "No readings in the last 3 hours.", cached: "Offline: last copy",
  },
};
const W = WORDS[LANG] || WORDS.ar;
const MIN = 60000;
const ARROW = { 1: "⇊", 2: "↘", 3: "→", 4: "↗", 5: "⇈" };
const GREY = "#8A8A8E";

async function load() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), "layan-widget.json");
  try {
    const r = new Request(SUPABASE + "/rest/v1/rpc/share_view");
    r.method = "POST";
    r.timeoutInterval = 15;
    r.headers = { apikey: KEY, "Content-Type": "application/json", "Content-Profile": "carb" };
    r.body = JSON.stringify({ p_token: TOKEN });
    const d = await r.loadJSON();
    if (d && !d.error) fm.writeString(cache, JSON.stringify(d));
    return d || { error: "offline" };
  } catch (e) {
    if (fm.fileExists(cache)) { const d = JSON.parse(fm.readString(cache)); d.offline = true; return d; }
    return { error: "offline" };
  }
}

// insulin on board: the exponential activity model (Loop), duration and peak from the care team (engine/iob.ts)
function iobFraction(t, dia, peak) {
  if (t <= 0) return 1;
  if (t >= dia) return 0;
  const tau = (peak * (1 - peak / dia)) / (1 - (2 * peak) / dia);
  const a = (2 * tau) / dia;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-dia / tau));
  const f = 1 - S * (1 - a) * ((t * t / (tau * dia * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
  return Math.min(1, Math.max(0, f));
}

// worked out now, not when the data was read, so an offline copy still counts down
function onboard(ob, now) {
  if (!ob) return null;
  let iob = null, cob = null;
  if (ob.dia > 0 && ob.peak > 0 && ob.peak < ob.dia / 2) {
    iob = 0;
    for (const d of ob.doses || []) {
      const t = Date.parse(d.t);
      if (t <= now && now - t < ob.dia * MIN) iob += Number(d.u) * iobFraction((now - t) / MIN, ob.dia, ob.peak);
    }
  }
  if (ob.absorb > 0) {
    cob = 0;
    for (const c of ob.carbs || []) {
      const t = Date.parse(c.t);
      if (t <= now && now - t < ob.absorb * MIN) cob += Number(c.g) * (1 - (now - t) / (ob.absorb * MIN));
    }
  }
  if (iob === null && cob === null) return null;
  return [iob === null ? null : "IOB " + iob.toFixed(1) + "u", cob === null ? null : "COB " + Math.round(cob) + "g"].filter(Boolean).join("  ");
}

function view(d) {
  const rs = (d.readings || []).map((r) => ({ t: Date.parse(r.t), v: r.v, trend: r.trend }));
  const last = rs[rs.length - 1] || null;
  if (!last) return null;
  const mmol = d.unit !== "mgdl";
  const fmt = (mg) => (mmol ? (mg / 18).toFixed(1) : String(Math.round(mg)));
  const mins = Math.max(0, Math.round((Date.now() - last.t) / MIN));
  const stale = mins > 15;
  const before = rs.filter((r) => r.t <= last.t - 13 * MIN).pop();
  const delta = before && last.t - before.t <= 20 * MIN ? last.v - before.v : null;
  const level = last.v < 54 ? "urgent" : last.v < d.low ? "low" : last.v > d.high ? "high" : "ok";
  const color = stale ? GREY : { urgent: "#B42318", low: "#D92D20", high: "#B54708", ok: "#067647" }[level];
  return {
    rs, last, value: fmt(last.v), arrow: stale ? "" : ARROW[last.trend] || "", unit: mmol ? "mmol/L" : "mg/dL",
    age: mins < 1 ? W.now : W.ago.replace("{m}", mins), stale, color, word: stale ? W.old : W[level],
    delta: delta === null || stale ? "" : (delta >= 0 ? "+" : "−") + fmt(Math.abs(delta)) + " " + W.in15,
    onboard: onboard(d.onboard, Date.now()),
  };
}

function chart(d, v, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const lo = Math.min(54, ...v.rs.map((r) => r.v)), hi = Math.max(220, ...v.rs.map((r) => r.v));
  const y = (mg) => h - 4 - ((mg - lo) / (hi - lo)) * (h - 8);
  const t0 = Date.now() - 3 * 60 * MIN, x = (t) => Math.max(0, Math.min(w, ((t - t0) / (3 * 60 * MIN)) * w));
  ctx.setFillColor(new Color("#067647", 0.12));
  ctx.fillRect(new Rect(0, y(d.high), w, y(d.low) - y(d.high)));
  for (const r of v.rs) {
    ctx.setFillColor(new Color(r.v < d.low ? "#D92D20" : r.v > d.high ? "#B54708" : "#067647"));
    ctx.fillEllipse(new Rect(x(r.t) - 1.5, y(r.v) - 1.5, 3, 3));
  }
  ctx.setFillColor(new Color(v.color));
  ctx.fillEllipse(new Rect(x(v.last.t) - 3.5, y(v.last.v) - 3.5, 7, 7));
  return ctx.getImage();
}

function text(stack, s, size, opts) {
  const o = opts || {};
  const t = stack.addText(s);
  t.font = o.bold ? Font.boldRoundedSystemFont(size) : o.medium ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = o.color ? new Color(o.color) : Color.dynamic(new Color("#1C1B4D"), new Color("#F2F2F7"));
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function message(w, s) {
  text(w, W.child, 14, { bold: true });
  w.addSpacer(6);
  text(w, s, 12, { color: GREY }).lineLimit = 3;
}

const d = await load();
const fam = config.widgetFamily || "medium";
const w = new ListWidget();
w.url = APP;
w.refreshAfterDate = new Date(Date.now() + 5 * MIN);
const v = d && !d.error ? view(d) : null;
const name = (d && d.child) || W.child;

if (fam === "accessoryInline") {
  text(w, v ? name + " " + v.value + " " + v.arrow + " · " + v.age : name + " —", 12);
} else if (fam === "accessoryCircular") {
  w.addAccessoryWidgetBackground = true;
  text(w, v ? v.value : "—", 18, { bold: true }).centerAlignText();
  text(w, v ? v.arrow || v.age : "", 11).centerAlignText();
} else if (fam === "accessoryRectangular") {
  text(w, v ? v.value + " " + v.arrow : name + " —", 22, { bold: true });
  text(w, v ? v.age + (v.stale ? "" : " · " + v.word) : d && d.error === "invalid" ? W.expired : W.noReading, 11);
  if (v && v.onboard) text(w, v.onboard, 11, { medium: true });
} else {
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"));
  w.setPadding(12, 14, 12, 14);
  if (!d || d.error === "invalid") message(w, W.revoked);
  else if (d.error) message(w, W.offline);
  else if (!v) message(w, W.none);
  else {
    const row = w.addStack();
    row.centerAlignContent();
    const left = row.addStack();
    left.layoutVertically();
    text(left, name + " · " + v.word, 12, { bold: true, color: v.color });
    left.addSpacer(2);
    const big = left.addStack();
    big.centerAlignContent();
    text(big, v.value, fam === "small" ? 38 : 44, { bold: true, color: v.stale ? GREY : null });
    big.addSpacer(4);
    text(big, v.arrow, 26, { bold: true, color: v.color });
    text(left, v.unit, 10, { color: GREY });
    left.addSpacer(3);
    text(left, v.age + (v.delta && fam !== "small" ? " · " + v.delta : ""), 11, { color: GREY });
    if (v.onboard) text(left, v.onboard, 12, { medium: true });
    if (d.offline) text(left, W.cached, 10, { color: "#B54708" });
    if (fam !== "small" && v.rs.length > 1) {
      row.addSpacer(10);
      const img = row.addImage(chart(d, v, 150, 90));
      img.imageSize = new Size(150, 90);
    }
  }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
