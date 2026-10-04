// Search that forgives how a word was typed: case, Arabic letter forms (أ إ آ → ا, ة → ه, ى → ي) and diacritics,
// and which language it was typed in: a food or brand word found in an item also counts in the other language
// (Milk Toast is found by «توست», «عسل» by "honey"). Every word typed must appear somewhere. Pure, tested in Node.

export const norm = (s: string) => s.toLowerCase()
  .replace(/[ً-ْـ]/g, '') // i18n-ok: regex (diacritics, tatweel, letter forms)
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') // i18n-ok: regex (diacritics, tatweel, letter forms)
  .replace(/[’'`]/g, '')
  .replace(/\s+/g, ' ').trim();

/**
 * The same thing in Arabic and English (and common spellings). When an item's text contains one of a group as a
 * word, the whole group is added to what the item can be found by. Brand names are here too. In Kuwait «عيش» is rice.
 */
const SAME: string[][] = [ // i18n-ok: data (search words in both languages)
  ['toast', 'توست'], ['bread', 'خبز'], ['samoon', 'roll', 'rolls', 'صمون', 'صمونه', 'صمونات', 'رول'], ['arabic bread', 'pita', 'خبز عربي'], // i18n-ok: data
  ['croissant', 'croissants', 'كرواسون', 'كرواسان'], ['puff', 'puffs', 'فطيره', 'فطاير'], // i18n-ok: data
  ['cake', 'cakes', 'كيك', 'كيكه'], ['biscuit', 'biscuits', 'cookie', 'cookies', 'بسكويت'], ['cracker', 'crackers', 'كراكر'], // i18n-ok: data
  ['sandwich', 'sandwiches', 'سندويش', 'سندويشات', 'سندويتش', 'ساندويتش'], ['flour', 'طحين'], // i18n-ok: data
  ['pasta', 'باستا', 'معكرونه', 'مكرونه'], ['spaghetti', 'سباغيتي', 'اسباجيتي'], ['noodles', 'نودلز', 'اندومي'], // i18n-ok: data
  ['rice', 'رز', 'ارز', 'عيش'], ['potato', 'potatoes', 'بطاط', 'بطاطا', 'بطاطس'], ['fries', 'french fries', 'فرايز'], // i18n-ok: data
  ['nugget', 'nuggets', 'mcnuggets', 'ناجت', 'ناغيت', 'نقت', 'نقتس', 'ناقت', 'ناجتس'], ['burger', 'burgers', 'برغر', 'برجر'], ['pizza', 'بيتزا'], ['shawarma', 'شاورما'], // i18n-ok: data
  ['chicken', 'دجاج', 'تشكن', 'شكن'], ['meat', 'beef', 'لحم'], ['fish', 'سمك'], ['egg', 'eggs', 'بيض', 'بيضه'], // i18n-ok: data
  ['milk', 'حليب'], ['laban', 'لبن'], ['labneh', 'لبنه'], ['yoghurt', 'yogurt', 'روب', 'زبادي'], // i18n-ok: data
  ['cheese', 'جبن', 'جبنه'], ['cream cheese', 'جبن كريمي', 'جبنه كريمي'], ['cream', 'قشطه', 'كريمه', 'قيمر'], // i18n-ok: data
  ['thick cream', 'قشطه', 'قيمر'], ['butter', 'زبده'], ['ice cream', 'ايس كريم', 'ايسكريم', 'بوظه'], // i18n-ok: data
  ['honey', 'عسل'], ['sugar', 'سكر'], ['chocolate', 'شوكولاته', 'شوكولا', 'شوكلت'], ['dates', 'date', 'تمر'], ['jam', 'مربى'], // i18n-ok: data
  ['juice', 'عصير'], ['nectar', 'نكتار'], ['water', 'ماء', 'مويه', 'ماي'], ['drink', 'drinks', 'مشروب', 'مشروبات', 'عصير'], ['tea', 'شاي'], // i18n-ok: data
  ['apple', 'apples', 'تفاح'], ['banana', 'bananas', 'موز'], ['orange', 'oranges', 'برتقال'], ['mango', 'مانجو', 'منجا'], // i18n-ok: data
  ['strawberry', 'strawberries', 'فراوله'], ['grape', 'grapes', 'عنب'], ['watermelon', 'بطيخ'], ['pineapple', 'اناناس'], // i18n-ok: data
  ['lemon', 'ليمون'], ['vanilla', 'فانيلا'], ['cocktail', 'كوكتيل'], ['fruit', 'fruits', 'فواكه', 'فاكهه'], ['vegetables', 'خضار'], // i18n-ok: data
  ['sauce', 'صلصه', 'صوص'], ['bbq', 'barbecue', 'barbeque', 'باربيكيو', 'باربكيو', 'باربيكو', 'بربكيو'], ['pepsi', 'بيبسي', 'ببسي'], ['diet', 'دايت'], ['cola', 'coca-cola', 'coke', 'كولا', 'كوكا كولا'], ['ketchup', 'كاتشب'], ['mayonnaise', 'mayo', 'مايونيز'], ['garlic', 'ثوم'], ['zaatar', 'thyme', 'زعتر'], // i18n-ok: data
  ['white', 'ابيض'], ['brown', 'اسمر'], ['wholemeal', 'whole wheat', 'قمح كامل'], ['kids', 'اطفال'], // i18n-ok: data
  ['snack', 'snacks', 'سناك', 'سناكات'], ['breakfast', 'فطور', 'ريوق'], ['lunch', 'غدا', 'غداء'], ['dinner', 'عشا', 'عشاء'], // i18n-ok: data
  ['cornflakes', 'corn flakes', 'frosties', 'كورن فليكس', 'كورنفليكس', 'كورن فلكس', 'كورنفلكس', 'النمر'], ['cereal', 'cereals', 'سيريال', 'حبوب الافطار'], // i18n-ok: data
  ['kelloggs', 'كيلوقز', 'كيلوجز', 'كلوقز'], // i18n-ok: data
  ['topi', 'توبي'], ['muratbey', 'موراتبي', 'مراد بي'], // i18n-ok: data
  ['kdd', 'كي دي دي'], ['kfmb', 'المطاحن', 'مطاحن', 'kuwait flour mills'], ['lusine', 'لوزين'], // i18n-ok: data
  ['cupcake', 'cupcakes', 'cup cake', 'cup cakes', 'كب كيك', 'كاب كيك'], ['muffin', 'muffins', 'مافن', 'مفن'], ['brownie', 'براوني'], // i18n-ok: data
  ['wrap', 'wraps', 'tortilla', 'تورتيلا', 'راب'], ['bun', 'buns', 'burger buns', 'خبز برغر'], ['hot dog', 'hotdog', 'هوت دوق', 'هوت دوج'], // i18n-ok: data
  ['ogaily', 'عقيلي'], ['rugag', 'رقاق'], ['shaboura', 'شابوره'], ['logaimat', 'لقيمات'], ['chappati', 'chapati', 'جباتي'], ['tannur', 'تنور'], // i18n-ok: data
  ['lasagna', 'لازانيا'], ['vermicelli', 'شعيريه'], ['pancake', 'pancakes', 'بان كيك', 'بانكيك'], ['falafel', 'فلافل'], // i18n-ok: data
  ['halloumi', 'حلوم'], ['feta', 'فيتا'], ['coconut', 'جوز هند'], ['caramel', 'كراميل'], ['coffee', 'latte', 'mocha', 'espresso', 'قهوه'], // i18n-ok: data
  ['grapefruit', 'جريب فروت'], ['guava', 'جوافه'], ['peach', 'خوخ'], ['pomegranate', 'رمان'], ['apricot', 'مشمش'], ['cherry', 'كرز'], // i18n-ok: data
  ['raspberry', 'blueberry', 'cranberry', 'توت'], ['tomato', 'طماط', 'طماطم'], ['cucumber', 'خيار'], ['turkey', 'تركي', 'حبش', 'ديك رومي'], ['onion', 'بصل'], ['olive oil', 'زيت زيتون'], // i18n-ok: data
  ['semolina', 'سميد'], ['wheat', 'قمح'], ['bran', 'نخاله'], ['barley', 'شعير'], ['sesame', 'سمسم'], ['lolly', 'مصاصه'], // i18n-ok: data
  ['evaporated milk', 'حليب مبخر'], ['pistachio', 'pistachios', 'فستق', 'فستق حلبي'], ['almond', 'almonds', 'لوز'], // i18n-ok: data
  // generic foods (vegetables, fruit, nuts, fish, grains, extras) and Kuwaiti dishes
  ['zucchini', 'courgette', 'كوسا', 'كوسه'], ['eggplant', 'aubergine', 'باذنجان', 'بيتنجان'], ['okra', 'باميه'], ['carrot', 'carrots', 'جزر'], // i18n-ok: data
  ['spinach', 'سبانخ'], ['lettuce', 'خس'], ['cabbage', 'ملفوف'], ['cauliflower', 'زهره', 'قرنبيط'], ['broccoli', 'بروكلي'], ['peas', 'بازلاء', 'بزاليا'], // i18n-ok: data
  ['corn', 'sweet corn', 'ذره'], ['green beans', 'beans', 'فاصوليا', 'لوبيا'], ['pepper', 'capsicum', 'فلفل'], ['sweet potato', 'بطاط حلو', 'بطاطا حلوه'], ['beetroot', 'beet', 'شمندر', 'شوندر'], // i18n-ok: data
  ['cantaloupe', 'melon', 'شمام'], ['pear', 'كمثرى', 'عرموط'], ['kiwi', 'كيوي'], ['fig', 'figs', 'تين'], ['plum', 'برقوق'], ['raisins', 'زبيب'], ['papaya', 'بابايا'], ['avocado', 'افوكادو'], // i18n-ok: data
  ['cashew', 'cashews', 'كاجو'], ['walnut', 'walnuts', 'عين الجمل', 'جوز'], ['hazelnut', 'hazelnuts', 'بندق'], ['peanut', 'peanuts', 'فول سوداني'], ['nuts', 'مكسرات'], // i18n-ok: data
  ['chickpea', 'chickpeas', 'hummus', 'حمص'], ['lentil', 'lentils', 'عدس'], ['fava', 'fava beans', 'broad beans', 'foul', 'فول'], ['kidney beans', 'فاصوليا حمراء'], // i18n-ok: data
  ['oats', 'oat', 'oatmeal', 'porridge', 'شوفان'], ['bulgur', 'برغل'], ['quinoa', 'كينوا'], ['couscous', 'كسكس', 'كسكسي'], ['freekeh', 'فريكه'], // i18n-ok: data
  ['shrimp', 'shrimps', 'prawn', 'prawns', 'روبيان', 'ربيان'], ['grouper', 'hamour', 'هامور'], ['salmon', 'سلمون', 'سالمون'], ['tuna', 'تونه', 'تونا'], ['sardine', 'sardines', 'سردين'], // i18n-ok: data
  ['zubaidi', 'pomfret', 'زبيدي'], ['lamb', 'mutton', 'غنم', 'لحم غنم'], ['minced meat', 'mince', 'لحم مفروم', 'مفروم'], ['sausage', 'sausages', 'نقانق'], ['liver', 'كبده'], // i18n-ok: data
  ['basmati', 'بسمتي'], ['egyptian rice', 'رز مصري', 'ارز مصري'], ['brown rice', 'رز بني', 'ارز بني'], ['bread crumbs', 'بقسماط'], // i18n-ok: data
  ['date syrup', 'dibs', 'دبس'], ['tahini', 'tahina', 'طحينه'], ['molasses', 'دبس'], ['maple', 'قيقب'], ['syrup', 'شيره', 'شراب'], ['nutella', 'نوتيلا'], ['peanut butter', 'زبده فول سوداني'], // i18n-ok: data
  ['popcorn', 'pop corn', 'فشار', 'بوب كورن'], ['chips', 'crisps', 'شيبس', 'شبس', 'جيبس'], ['donut', 'doughnut', 'دونات'], ['waffle', 'وافل'], ['jelly', 'jello', 'جلي'], // i18n-ok: data
  ['kunafa', 'knafeh', 'كنافه'], ['basbousa', 'بسبوسه'], ['muhallabia', 'mahalabia', 'مهلبيه'], ['custard', 'كاسترد'], ['candy', 'sweets', 'حلاوه', 'حلويات'], // i18n-ok: data
  ['machboos', 'majboos', 'مجبوس'], ['mareg', 'stew', 'مرق', 'مرقه'], ['harees', 'هريس'], ['jareesh', 'جريش'], ['murabyan', 'مربين'], ['balaleet', 'بلاليط'], ['mutabbaq', 'مطبق'], ['quzi', 'ghouzi', 'قوزي'], // i18n-ok: data
  ['granola', 'جرانولا', 'غرانولا'], ['muesli', 'ميوزلي'], ['corn syrup', 'شراب الذره'], // i18n-ok: data
  ['americana', 'امريكانا'], ['mcdonalds', 'mcdonald', 'ماكدونالدز', 'ماكدونالز', 'مكدونالدز', 'ماكدونلدز', 'ماك'], ['almarai', 'المراعي'], ['ritz', 'ريتز'], // i18n-ok: data
].map((g) => g.map(norm));

// words that only look like a group's word: "full cream milk" is milk, not cream (قشطة)
const UNLESS: Record<string, string[]> = {
  cream: ['full cream', 'half cream', 'ice cream', 'cream cheese', 'cream filled', 'sour cream'],
  walnut: ['جوز هند'], fava: ['فول سوداني'], corn: ['corn flakes', 'cornflakes', 'popcorn', 'pop corn'], beans: ['coffee beans'], // i18n-ok: data
};

const LATIN = /^[a-z0-9 ]+$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a word of the group standing on its own in the item's text (an Arabic word may carry «و», «ب» or «ال» in front)
const finders = SAME.map((g) => g.map((w) => LATIN.test(w)
  ? new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`)
  : new RegExp(`(^|[^\\u0600-\\u06ff])(و|ب)?(ال)?${esc(w)}($|[^\\u0600-\\u06ff])`))); // i18n-ok: regex

const cache = new Map<string, string>();
/** The item's text, normalised, with the other language's words for what it contains added. */
export function searchText(hay: (string | null | undefined)[]): string {
  const key = hay.filter(Boolean).join('\u0001');
  let out = cache.get(key);
  if (out !== undefined) return out;
  const h = norm(hay.filter(Boolean).join(' '));
  const extra: string[] = [];
  SAME.forEach((g, i) => {
    const hh = (UNLESS[g[0]] ?? []).reduce((x, phrase) => x.split(phrase).join(' '), h);
    if (finders[i].some((re) => re.test(hh))) extra.push(...g);
  });
  out = extra.length ? `${h} ${extra.join(' ')}` : h;
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

// the start of a word: typing "ice" finds ice cream, not rice or juice; an Arabic word may carry «ال», «و» or «ب»
const AR_LEAD = /^(وال|بال|ال|و|ب)/; // i18n-ok: regex
const tokens = (s: string) => s.split(/[^a-z0-9\u0600-\u06ff]+/).filter(Boolean); // i18n-ok: regex

/** Every word typed must start a word of the item (in either language). */
export function matches(hay: (string | null | undefined)[], query: string): boolean {
  const words = tokens(norm(query));
  if (!words.length) return true;
  const ts = tokens(searchText(hay));
  return words.every((w) => {
    const bare = w.replace(AR_LEAD, '');
    const ws = bare.length >= 2 && bare !== w ? [w, bare] : [w]; // «الخبز» also as «خبز»
    return ts.some((x) => ws.some((v) => x.startsWith(v) || x.replace(AR_LEAD, '').startsWith(v)));
  });
}
