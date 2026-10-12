-- Glycemic index per food (International GI Tables, Atkinson et al. 2008/2021; glucose = 100).
-- gi_match: exact (same food in the tables), similar (closest food; shown as approximate), estimate (no published
-- value: worked out from its carbs, fat and fibre; shown as estimated), na (too little carbohydrate to measure).
alter table carb.products
  add column if not exists gi smallint check (gi between 0 and 100),
  add column if not exists gi_match text check (gi_match in ('exact','similar','estimate','na')),
  add column if not exists gi_note text;

update carb.products p set gi = v.gi, gi_match = v.m, gi_note = v.note
from (values
  ('آيس كريم شوكولاتة', 51, 'similar', 'متوسط الآيس كريم العادي'),
  ('آيس كريم فانيلا', 51, 'similar', 'متوسط الآيس كريم العادي'),
  ('شاورما دجاج بدون خبز + ثوم', null, 'na', null),
  ('عيش أبيض', 73, 'similar', 'رز أبيض مسلوق'),
  ('كباب', null, 'na', null),
  ('كتكات', 50, 'estimate', 'ويفر مع شوكولاتة؛ الدهن يبطّئه · ⚠️ الكارب مسجّل 0، يحتاج تصحيح من الملصق'),
  ('مرق دجاج', null, 'na', null),
  ('مرق بدون عيش وبطاط (مغرفة)', 40, 'estimate', 'كاربه من الطماط والبصل والخضار؛ بدون عيش وبطاط يكون منخفض'),
  ('سباغيتي بر مطبوخة', 48, 'exact', null),
  ('سباغيتي مطبوخة', 49, 'exact', null),
  ('سباغيتي نيئة (جافة)', 49, 'similar', 'القيمة تُقاس بعد الطبخ'),
  ('شعيرية مطبوخة', 35, 'exact', 'شعيرية قمح'),
  ('معكرونة مطبوخة (مقرون/بيني)', 47, 'exact', null),
  ('نودلز بالبيض مطبوخة', 47, 'similar', 'نودلز قمح'),
  ('بسكويت زبدة (شورت بريد)', 64, 'exact', null),
  ('بسكويت شوكولاتة محشي كريمة', 45, 'estimate', 'مثل بسكويت الساندويتش المعروف؛ الكريمة الدهنية تخفّضه'),
  ('بسكويت فانيلا محشي كريمة', 55, 'estimate', 'طحين أبيض وسكر، مع كريمة دهنية'),
  ('كوكيز رقائق الشوكولاتة', 50, 'estimate', 'طحين وسكر مع دهن وشوكولاتة'),
  ('ويفر محشي كريمة', 65, 'estimate', 'ويفر خفيف سريع الهضم مع كريمة'),
  ('بيض', null, 'na', null),
  ('بيض مخفوق (سكرامبل)', null, 'na', null),
  ('بيض مسلوق', null, 'na', null),
  ('بيض مقلي', null, 'na', null),
  ('جبن بارميزان مبشور', null, 'na', null),
  ('جبن شرائح', null, 'na', null),
  ('جبن شيدر', null, 'na', null),
  ('جبن فيتا', null, 'na', null),
  ('جبن قريش (كوتج)', null, 'na', null),
  ('جبن كريمي (للدهن)', null, 'na', null),
  ('جبن موزاريلا', null, 'na', null),
  ('غرانولا', 57, 'similar', 'موسلي'),
  ('برغل مطبوخ', 48, 'exact', null),
  ('حمص (متبل بالطحينة)', 6, 'exact', 'حمص دِب'),
  ('حمص حب مطبوخ', 28, 'exact', null),
  ('شوفان (جاف)', 55, 'similar', 'عصيدة شوفان مفرود'),
  ('شوفان مطبوخ بالماء', 55, 'exact', null),
  ('عدس مطبوخ', 32, 'exact', null),
  ('فاصوليا بيضاء مطبوخة', 33, 'exact', null),
  ('فاصوليا حمراء مطبوخة', 24, 'exact', null),
  ('فول مطبوخ', 79, 'similar', 'فول عريض؛ القيمة قديمة وتتفاوت'),
  ('قمح حب (جاف، للهريس)', 45, 'similar', 'حب قمح مسلوق'),
  ('كسكس مطبوخ', 65, 'exact', null),
  ('كينوا مطبوخة', 53, 'exact', null),
  ('ماش مطبوخ', 31, 'similar', null),
  ('حليب بالشوكولاتة', 37, 'similar', null),
  ('حليب خالي الدسم', 37, 'exact', null),
  ('حليب قليل الدسم', 37, 'similar', null),
  ('حليب كامل الدسم', 39, 'exact', null),
  ('بيغل', 72, 'exact', null),
  ('توست أبيض (شريحة)', 75, 'exact', null),
  ('خبز بر', 74, 'exact', null),
  ('خبز برغر', 61, 'exact', null),
  ('خبز تورتيا (طحين)', 30, 'exact', null),
  ('خبز تورتيا ذرة', 46, 'exact', null),
  ('خبز عربي أبيض', 68, 'exact', null),
  ('خبز عربي بر', 68, 'similar', 'الخبز البر غالباً قريب من الأبيض'),
  ('صمون', 95, 'similar', 'باغيت فرنسي'),
  ('كرواسون سادة', 67, 'exact', null),
  ('باذنجان مسلوق', null, 'na', null),
  ('بازلاء مسلوقة', 51, 'exact', null),
  ('بامية مسلوقة', null, 'na', null),
  ('بروكلي مسلوق', null, 'na', null),
  ('بصل', null, 'na', null),
  ('بطاط مسلوق', 78, 'exact', null),
  ('بطاط مشوي بالقشر', 85, 'exact', null),
  ('بطاط مقلي (أصابع مجمدة بالفرن)', 63, 'exact', null),
  ('بطاط مهروس (بيتي بالحليب والزبدة)', 87, 'exact', null),
  ('بطاطا حلوة مشوية', 63, 'similar', 'قيمة المسلوقة؛ المشوية أعلى'),
  ('ثوم', null, 'na', null),
  ('جزر مسلوق', 39, 'exact', null),
  ('جزر نيء', 39, 'similar', 'قيمة المسلوق'),
  ('خس روماني', null, 'na', null),
  ('خيار', null, 'na', null),
  ('ذرة مسلوقة', 52, 'exact', null),
  ('سبانخ مسلوقة', null, 'na', null),
  ('طماط', null, 'na', null),
  ('فاصوليا خضراء مسلوقة', null, 'na', null),
  ('فطر مسلوق', null, 'na', null),
  ('فلفل رومي أحمر', null, 'na', null),
  ('فلفل رومي أخضر', null, 'na', null),
  ('قرنبيط مسلوق', null, 'na', null),
  ('كوسا مسلوقة', null, 'na', null),
  ('معجون طماط', null, 'na', 'كمياته صغيرة'),
  ('ملفوف نيء', null, 'na', null),
  ('رز أبيض مطبوخ', 73, 'exact', null),
  ('رز أبيض نيء', 73, 'similar', 'القيمة تُقاس بعد الطبخ'),
  ('رز بري مطبوخ', 57, 'exact', null),
  ('رز بسمتي مطبوخ', 58, 'exact', null),
  ('رز بني مطبوخ', 68, 'exact', null),
  ('رز قصير الحبة مطبوخ', 83, 'similar', null),
  ('رز مسلوق مسبقاً (بربويل) مطبوخ', 47, 'similar', null),
  ('رز مصري مطبوخ', 73, 'similar', 'رز أبيض متوسط الحبة'),
  ('روب قليل الدسم', 35, 'similar', null),
  ('روب كامل الدسم', 36, 'exact', null),
  ('سكر أبيض', 65, 'exact', null),
  ('سكر بني', 65, 'similar', null),
  ('شراب البانكيك', 66, 'similar', null),
  ('شراب القيقب (ميبل)', 54, 'exact', null),
  ('صوص شوكولاتة', 60, 'estimate', 'أغلبه سكر'),
  ('عسل', 61, 'exact', 'متوسط'),
  ('مربى', 51, 'similar', null),
  ('تونة معلبة بالزيت', null, 'na', null),
  ('تونة معلبة بالماء', null, 'na', null),
  ('روبيان مطبوخ', null, 'na', null),
  ('سلمون مطبوخ', null, 'na', null),
  ('هامور مطبوخ', null, 'na', null),
  ('بريتزل', 83, 'exact', null),
  ('بسكويت مملح (سولتين)', 74, 'exact', null),
  ('بيتي فور', 55, 'estimate', 'طحين وسكر وزبدة، مثل البسكويت الحلو'),
  ('سناك بار / بسكويت (101 سعرة)', 55, 'estimate', 'متوسط البسكويت والبارات الحلوة'),
  ('شاي بالحليب والسكر', 60, 'estimate', 'السكر (65) مع شوي حليب (39)'),
  ('شرائح تركي وخيار', null, 'na', null),
  ('شيبس بطاط', 56, 'exact', null),
  ('عصير علبة', 41, 'similar', 'عصير تفاح'),
  ('فشار بالزيت', 65, 'exact', null),
  ('فشار بدون زيت', 65, 'exact', null),
  ('شوكولاتة بالحليب', 43, 'exact', null),
  ('شوكولاتة داكنة', 40, 'similar', null),
  ('زيت نباتي', null, 'na', null),
  ('سمن', null, 'na', null),
  ('صوص باربكيو', 60, 'estimate', 'أغلبه سكر ودبس'),
  ('صوص ثوم (توم)', null, 'na', null),
  ('صويا صوص', null, 'na', null),
  ('طحينة', null, 'na', null),
  ('كاتشب', 55, 'estimate', 'طماط مع سكر مضاف'),
  ('مايونيز', null, 'na', null),
  ('مستردة', null, 'na', null),
  ('عصير أناناس طبيعي', 46, 'exact', null),
  ('عصير برتقال طبيعي (معصور)', 50, 'exact', null),
  ('عصير تفاح طبيعي', 41, 'exact', null),
  ('عصير رمان طبيعي', 50, 'estimate', 'مثل باقي العصائر الطبيعية (41–50)'),
  ('عصير عنب طبيعي', 48, 'similar', null),
  ('عصير ليمون (بدون سكر)', null, 'na', null),
  ('نكتار مانجو (معلب)', 55, 'estimate', 'مانجو (51) مع سكر مضاف'),
  ('بان كيك سادة', 66, 'exact', null),
  ('فرنش توست', 60, 'estimate', 'توست أبيض (75)؛ البيض والحليب يخفّضونه'),
  ('وافل سادة', 76, 'exact', null),
  ('أناناس', 59, 'exact', null),
  ('برتقال', 43, 'exact', null),
  ('بطيخ', 76, 'exact', null),
  ('تفاح', 36, 'exact', null),
  ('تمر دقلة نور', 42, 'similar', 'متوسط التمور'),
  ('تمر مجهول', 42, 'similar', 'متوسط التمور'),
  ('توت أزرق', 53, 'exact', null),
  ('تين', 61, 'similar', 'تين مجفف'),
  ('جوافة', 35, 'estimate', 'فاكهة غنية بالألياف'),
  ('خوخ', 42, 'exact', null),
  ('رمان', 35, 'estimate', 'فاكهة؛ مثل التفاح والكمثرى'),
  ('زبيب', 64, 'exact', null),
  ('شمام', 65, 'exact', null),
  ('عنب', 53, 'exact', null),
  ('فراولة', 40, 'exact', null),
  ('كرز', 22, 'exact', null),
  ('كمثرى', 38, 'exact', null),
  ('كيوي', 53, 'exact', null),
  ('مانجو', 51, 'exact', null),
  ('مشمش', 34, 'exact', null),
  ('موز', 51, 'exact', null),
  ('يوسفي', 47, 'similar', null),
  ('كيك إسفنجي', 46, 'exact', null),
  ('كيك سادة (أصفر)', 46, 'similar', 'كيك إسفنجي'),
  ('كيك شوكولاتة بالكريمة', 38, 'exact', null),
  ('لبن', 36, 'similar', 'روب'),
  ('لبن (المنتج الحالي — حدّث الاسم من الملصق)', 36, 'similar', 'روب'),
  ('لبن كامل الدسم', 36, 'similar', 'روب'),
  ('تركي شرائح (صدر ديك رومي مدخن)', null, 'na', null),
  ('دجاج مطبوخ', null, 'na', null),
  ('ستيك لحم مشوي', null, 'na', null),
  ('شاورما دجاج (لحم فقط، بدون خبز)', null, 'na', null),
  ('صدر دجاج مشوي', null, 'na', null),
  ('صدر ديك رومي مشوي', null, 'na', null),
  ('فخذ دجاج مشوي', null, 'na', null),
  ('لحم غنم مشوي', null, 'na', null),
  ('لحم مفروم مطبوخ', null, 'na', null),
  ('ناجتس دجاج', 46, 'exact', null),
  ('نقانق دجاج', null, 'na', null),
  ('نقانق لحم بقر', null, 'na', null),
  ('بندق', null, 'na', null),
  ('جوز (عين الجمل)', null, 'na', null),
  ('حب (بذور دوار الشمس) مقشر محمص', null, 'na', null),
  ('زبدة فول سوداني', 14, 'similar', 'فول سوداني'),
  ('فستق حلبي محمص', null, 'na', null),
  ('فول سوداني محمص', 14, 'exact', null),
  ('كاجو محمص', 25, 'exact', null),
  ('لوز', null, 'na', null),
  ('ملوخية بيتية ثقيلة (ورق مع لحم/دجاج)', null, 'na', null)
) as v(name, gi, m, note)
where p.name = v.name and coalesce(p.brand, '') = '';

-- Branded products: the generic food they are closest to (similar) or worked out from what is in them (estimate).
-- Under 5 g carbohydrate per 100 there is too little to measure (na).
with b as (
  select q.id, case
      when q.carbs_per_100 < 5 then '|na|'
      when q.category = 'مشروبات' and q.name ~* '(coca|fanta|sprite|pepsi)' then '63|similar|مثل المشروبات الغازية'
      when q.category = 'مشروبات' and q.name ~* '(frappick|mocha|spanish|hot chocolate|cloud|okinawa|wake up|maple|samadi|dutch|pick latte|togo latte)' then '60|estimate|حليب مع سكر أو شراب مضاف'
      when q.category = 'مشروبات' and q.name ~* '(latte|cappuc|flat white|babyccino)' then '45|estimate|حليب مع شوي سكر'
      when q.category = 'مشروبات' and q.name ~* 'pro shake' then '45|estimate|بروتين مع فاكهة أو تمر'
      when q.category = 'مشروبات' and q.name ~* 'shot' then '50|estimate|عصير طازج مركّز'
      when q.category = 'مشروبات' and q.name ~* 'laban' then '36|similar|روب'
      when q.category = 'مشروبات' and q.name ~* 'tomato' then '38|similar|عصير طماط'
      when q.category = 'مشروبات' and q.name ~* 'grapefruit' then '48|similar|عصير جريب فروت'
      when q.category = 'مشروبات' and q.name ~* 'apple juice' then '41|similar|عصير تفاح'
      when q.category = 'مشروبات' and q.name ~* 'orange' and q.name !~* 'fanta' then '50|similar|عصير برتقال'
      when q.category = 'مشروبات' and q.name ~* 'grape juice' then '48|similar|عصير عنب'
      when q.category = 'مشروبات' then '55|estimate|عصير أو نكتار مع سكر'
      when q.category = 'خبز' and q.name ~* '(tortilla|wrap)' then '30|similar|خبز تورتيا'
      when q.category = 'خبز' and q.name ~* '(bun|burger|roll|slider|brioche)' then '61|similar|خبز برغر'
      when q.category in ('خبز', 'توست') then '75|similar|خبز أبيض أو بر'
      when q.category = 'طحين' then '70|similar|طحين قمح بعد الخبز'
      when q.category = 'باستا' and q.name ~* 'vermicelli' then '35|similar|شعيرية'
      when q.category = 'باستا' then '49|similar|معكرونة مطبوخة'
      when q.category = 'معجنات' and q.name ~* '(pancake|hotcake)' then '66|similar|بان كيك'
      when q.category = 'معجنات' and q.name ~* 'pizza' then '60|similar|بيتزا'
      when q.category = 'معجنات' then '67|similar|كرواسون'
      when q.category = 'كيك' and q.name ~* 'cheesecake' then '35|estimate|جبن وكريمة مع شوي بسكويت'
      when q.category = 'كيك' and q.name ~* 'tiramisu' then '50|estimate|كيك مع كريمة'
      when q.category = 'كيك' and q.name ~* 'muffin' then '60|similar|مافن'
      when q.category = 'كيك' and q.name ~* 'خليط' then '70|estimate|خليط طحين؛ بعد الخبز'
      when q.category = 'كيك' then '46|similar|كيك'
      when q.category = 'حلويات' and q.name ~* 'donut' then '76|similar|دونات'
      when q.category = 'حلويات' and q.name ~* 'tutti' then '78|similar|حلاوة جيلي'
      when q.category = 'حلويات' and q.name ~* '(cone|ice cream biscuit)' then '70|estimate|ويفر خفيف وسكر'
      when q.category = 'حلويات' and q.name ~* 'pain au' then '67|similar|كرواسون'
      when q.category = 'حلويات' and q.name ~* '(babka|cake)' then '46|similar|كيك'
      when q.category = 'حلويات' then '55|estimate|طحين وسكر مع دهن'
      when q.category = 'بسكويت' and q.name ~* 'digestive' then '59|similar|بسكويت دايجستف'
      when q.category = 'بسكويت' and q.name ~* '(marie|petit|nice|tik)' then '60|estimate|بسكويت سادة'
      when q.category = 'بسكويت' then '55|estimate|بسكويت حلو'
      when q.category = 'آيس كريم' and q.name ~* 'lolly' then '65|estimate|ماي وسكر'
      when q.category = 'آيس كريم' then '51|similar|آيس كريم'
      when q.category in ('حليب', 'كريمة طبخ') then '37|similar|حليب'
      when q.category in ('روب', 'لبن') or q.name ~* 'labneh' then '36|similar|روب'
      when q.category = 'فواكه' and q.name ~* 'cantaloupe' then '65|similar|شمام'
      when q.category = 'فواكه' and q.name ~* 'pineapple' then '59|similar|أناناس'
      when q.category = 'فواكه' and q.name ~* 'watermelon' then '76|similar|بطيخ'
      when q.category = 'فواكه' and q.name ~* 'mango' then '51|similar|مانجو'
      when q.category = 'فواكه' and q.name ~* 'oatmeal' then '55|similar|شوفان'
      when q.category = 'فواكه' then '50|estimate|فواكه مشكلة'
      when q.category = 'خضار' and q.name ~* 'pasta' then '49|similar|معكرونة'
      when q.category = 'خضار' and q.name ~* 'quinoa' then '53|similar|كينوا'
      when q.category = 'خضار' and q.name ~* 'potato' then '60|estimate|بطاط مسلوق بارد مع صوص'
      when q.category = 'خضار' then '40|estimate|سلطة: خضار وصوص'
      when q.name ~* '(fries|hash brown|golden longs)' then '63|similar|بطاط مقلي'
      when q.name ~* 'frosties' then '55|similar|كورن فليكس بالسكر'
      when q.name ~* 'ritz' then '74|similar|بسكويت مملح'
      when q.name ~* '(pasta|beefaroni|noodles)' then '49|similar|معكرونة'
      when q.name ~* 'nugget' then '46|similar|ناجتس'
      when q.name ~* 'كورن فليكس' then '81|similar|كورن فليكس'
      when q.name ~* 'ice cream' then '51|similar|آيس كريم'
      when q.name ~* 'juice|عصير' then '45|estimate|عصير'
      when q.name ~* 'soup' then '40|estimate|شوربة'
      when q.category = 'سندويشات' then '55|estimate|خبز مع بروتين ودهن'
      when q.category = 'نشويات' then '60|estimate|رز أو نشويات مع لحم وصوص'
      when q.name ~* 'ملوخية' then '65|estimate|أغلب الكارب من العيش'
      when q.name ~* '(barbeque|bbq)' then '60|estimate|أغلبه سكر ودبس'
      when q.category = 'كاتشب' then '55|estimate|طماط مع سكر مضاف'
      when q.category in ('صلصة', 'مايونيز', 'جبن', 'برغر لحم') then '|na|'
      else '55|estimate|أكل مخلوط'
    end as v
  from carb.products q
  where coalesce(q.brand, '') <> ''
)
update carb.products p
set gi = nullif(split_part(b.v, '|', 1), '')::smallint, gi_match = split_part(b.v, '|', 2), gi_note = nullif(split_part(b.v, '|', 3), '')
from b where p.id = b.id;
