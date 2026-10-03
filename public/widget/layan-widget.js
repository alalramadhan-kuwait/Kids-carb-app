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
// the app's day colours (src/index.css)
const C = {
  bg: "#FCF7F8", panel: "#F4EFFD", border: "#E4DCF9", ink: "#261E5C", text2: "#625A87", text3: "#9084A9", brand: "#5B48D6",
  band: "#E3F5EC", ins: "#2E7CD6", carb: "#C2408F",
  dot: { ok: "#46B98A", high: "#F2A541", low: "#E95F68", urgent: "#E95F68" },
  text: { ok: "#1F7A55", high: "#8F5A00", low: "#B83A44", urgent: "#B83A44" },
};
const GREY = C.text3;
const hhmm = (t) => { const x = new Date(t); return String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0"); };

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
  return {
    iob: iob === null ? null : iob.toFixed(1) + "u", cob: cob === null ? null : Math.round(cob) + "g",
    line: [iob === null ? null : "IOB " + iob.toFixed(1) + "u", cob === null ? null : "COB " + Math.round(cob) + "g"].filter(Boolean).join("  "),
  };
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
  const color = stale ? C.text3 : C.text[level];
  return {
    rs, last, level, value: fmt(last.v), clock: hhmm(last.t), arrow: stale ? "" : ARROW[last.trend] || "", unit: mmol ? "mmol/L" : "mg/dL",
    age: mins < 1 ? W.now : W.ago.replace("{m}", mins), stale, color, word: stale ? W.old : W[level],
    delta: delta === null || stale ? "" : (delta >= 0 ? "+" : "−") + fmt(Math.abs(delta)) + " " + W.in15,
    onboard: onboard(d.onboard, Date.now()),
  };
}

// the widget's size in points for this iPhone (Apple's widget sizes by screen width), so the drawing fills it
function widgetSize(fam) {
  const w = Device.screenSize().width;
  const m = w >= 428 ? [364, 170, 382] : w >= 414 ? [360, 169, 379] : w >= 390 ? [338, 158, 354] : w >= 375 ? [329, 155, 345] : [292, 141, 311];
  return fam === "small" ? new Size(m[1], m[1]) : fam === "large" ? new Size(m[0], m[2]) : new Size(m[0], m[1]);
}

const levelOf = (d, mg) => (mg < 54 ? "urgent" : mg < d.low ? "low" : mg > d.high ? "high" : "ok");

// the background: side panel, her range, hour lines and labels, the readings as dots, meals and doses as markers
function background(d, v, size, panelW, chartTop) {
  const ctx = new DrawContext();
  ctx.size = size;
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  const W = size.width, H = size.height, x0 = panelW + 8, x1 = W - 10, y0 = chartTop, y1 = H - 20;
  ctx.setFillColor(new Color(C.bg));
  ctx.fillRect(new Rect(0, 0, W, H));
  if (panelW) { ctx.setFillColor(new Color(C.panel)); ctx.fillRect(new Rect(0, 0, panelW, H)); }
  const vals = v.rs.map((r) => r.v);
  const lo = Math.min(54, ...vals), hi = Math.max(200, ...vals);
  const y = (mg) => y1 - ((mg - lo) / (hi - lo)) * (y1 - y0);
  const t1 = Date.now(), t0 = t1 - 3 * 60 * MIN;
  const x = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  // her range
  ctx.setFillColor(new Color(C.band));
  ctx.fillRect(new Rect(x0, y(d.high), x1 - x0, y(d.low) - y(d.high)));
  // hour lines and labels
  ctx.setFont(Font.mediumSystemFont(10));
  ctx.setTextColor(new Color(C.text3));
  ctx.setTextAlignedCenter();
  for (let h = new Date(t0).setMinutes(0, 0, 0) + 60 * MIN; h < t1; h += 60 * MIN) {
    const px = x(h);
    ctx.setFillColor(new Color(C.border));
    ctx.fillRect(new Rect(px - 0.5, y0 - 4, 1, y1 - y0 + 4));
    const hr = new Date(h).getHours();
    ctx.drawTextInRect(String(hr).padStart(2, "0") + ":00", new Rect(px - 20, y1 + 4, 40, 14));
  }
  // meals and doses (widget links carry them), as small marks on the bottom edge
  const ob = d.onboard;
  if (ob) {
    for (const c of ob.carbs || []) { const t = Date.parse(c.t); if (t >= t0) { ctx.setFillColor(new Color(C.carb)); ctx.fillEllipse(new Rect(x(t) - 3.5, y1 - 8, 7, 7)); } }
    for (const q of ob.doses || []) { const t = Date.parse(q.t); if (t >= t0) { ctx.setFillColor(new Color(C.ins)); ctx.fillRect(new Rect(x(t) - 1.5, y1 - 14, 3, 12)); } }
  }
  // the readings
  for (const r of v.rs) {
    if (r.t < t0) continue;
    ctx.setFillColor(new Color(C.dot[levelOf(d, r.v)]));
    ctx.fillEllipse(new Rect(x(r.t) - 2.5, y(r.v) - 2.5, 5, 5));
  }
  ctx.setFillColor(new Color(v.stale ? C.text3 : C.dot[v.level]));
  ctx.fillEllipse(new Rect(x(v.last.t) - 5, y(v.last.v) - 5, 10, 10));
  return ctx.getImage();
}

async function logo() {
  const fm = FileManager.local();
  const p = fm.joinPath(fm.cacheDirectory(), "layan-logo.png");
  if (fm.fileExists(p)) return fm.readImage(p);
  try { const img = await new Request(APP + "icons/apple-touch-icon.png").loadImage(); fm.writeImage(p, img); return img; } catch (e) { return null; }
}

function text(stack, s, size, opts) {
  const o = opts || {};
  const t = stack.addText(s);
  t.font = o.bold ? Font.boldRoundedSystemFont(size) : o.medium ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = new Color(o.color || C.ink);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function symbol(stack, name, color, size) {
  const s = SFSymbol.named(name);
  if (!s) return;
  const img = stack.addImage(s.image);
  img.tintColor = new Color(color);
  img.imageSize = new Size(size, size);
}

function message(w, s) {
  w.backgroundColor = new Color(C.bg);
  w.setPadding(12, 14, 12, 14);
  text(w, W.child, 14, { bold: true, color: C.brand });
  w.addSpacer(6);
  text(w, s, 12, { color: C.text2 }).lineLimit = 3;
}

// side panel: her picture and name, then insulin and carbs on board
async function panel(row, v, name, size, panelW) {
  const p = row.addStack();
  p.layoutVertically();
  p.size = new Size(panelW, size.height - 16); // room for the padding, however the phone counts it
  p.setPadding(8, 8, 8, 8);
  const top = p.addStack();
  top.addSpacer();
  const img = await logo();
  if (img) { const i = top.addImage(img); i.imageSize = new Size(34, 34); i.cornerRadius = 9; }
  top.addSpacer();
  p.addSpacer(2);
  const n = p.addStack();
  n.addSpacer();
  text(n, name, 13, { bold: true, color: C.brand });
  n.addSpacer();
  p.addSpacer();
  if (v.onboard) {
    if (v.onboard.iob) { const r = p.addStack(); r.centerAlignContent(); symbol(r, "syringe.fill", C.ins, 12); r.addSpacer(4); text(r, v.onboard.iob, 12, { medium: true, color: C.ins }); }
    p.addSpacer(2);
    if (v.onboard.cob) { const r = p.addStack(); r.centerAlignContent(); symbol(r, "fork.knife", C.carb, 12); r.addSpacer(4); text(r, v.onboard.cob, 12, { medium: true, color: C.carb }); }
  }
}

// value, arrow, change and time, top right
function headline(stack, v, big, showDelta) {
  const r = stack.addStack();
  r.centerAlignContent();
  r.addSpacer();
  text(r, v.value, big, { bold: true, color: v.color });
  r.addSpacer(4);
  text(r, v.arrow, big * 0.62, { bold: true, color: v.color });
  r.addSpacer(8);
  const side = r.addStack();
  side.layoutVertically();
  if (showDelta) text(side, v.delta ? v.delta.split(" ")[0] : v.word, 13, { medium: true, color: C.ink });
  text(side, v.stale ? W.old : v.clock, 12, { color: C.text2 });
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
  if (v && v.onboard) text(w, v.onboard.line, 11, { medium: true });
} else if (!d || d.error === "invalid") message(w, W.revoked);
else if (d.error) message(w, W.offline);
else if (!v) message(w, W.none);
else {
  const size = widgetSize(fam);
  w.setPadding(0, 0, 0, 0);
  if (fam === "small") {
    // small: picture, value and arrow on top; the trend fills the lower half
    w.backgroundImage = background(d, v, size, 0, size.height * 0.5);
    w.setPadding(10, 12, 0, 12);
    const top = w.addStack();
    top.centerAlignContent();
    const img = await logo();
    if (img) { const i = top.addImage(img); i.imageSize = new Size(26, 26); i.cornerRadius = 7; top.addSpacer(6); }
    text(top, v.value, 30, { bold: true, color: v.color });
    top.addSpacer(3);
    text(top, v.arrow, 20, { bold: true, color: v.color });
    text(w, (v.stale ? W.old + " · " : "") + v.age + (v.onboard && v.onboard.iob ? " · IOB " + v.onboard.iob : ""), 10, { color: v.stale ? C.text["low"] : C.text2 });
    w.addSpacer();
  } else {
    // medium and large: side panel; value top right; the trend takes the rest
    const panelW = Math.round(size.width * 0.24);
    const chartTop = fam === "large" ? size.height * 0.22 : size.height * 0.42;
    w.backgroundImage = background(d, v, size, panelW, chartTop);
    const row = w.addStack();
    await panel(row, v, name, size, panelW);
    const right = row.addStack();
    right.layoutVertically();
    right.setPadding(8, 8, 0, 12);
    headline(right, v, fam === "large" ? 48 : 40, true);
    if (d.offline) { const o = right.addStack(); o.addSpacer(); text(o, W.cached, 10, { color: C.text["high"] }); }
    right.addSpacer();
  }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
