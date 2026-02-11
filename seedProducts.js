/**
 * seedProducts.js
 * Creates 10 products per store (per store.type).
 * Usage:
 *   node seedProducts.js --uri="mongodb://..." --db=aidelivery --mode=append
 *   node seedProducts.js --uri="mongodb://..." --db=aidelivery --mode=reset
 *
 * Notes:
 * - Assumes a "stores" collection exists with fields: name, name_ar, type, logo, address
 * - Inserts into "products" collection (change collection name if yours differs)
 */

const mongoose = require("mongoose");

// ---------- CLI args ----------
const args = process.argv.slice(2).reduce((acc, cur) => {
  const [k, v] = cur.split("=");
  acc[k.replace(/^--/, "")] = (v ?? "").replace(/^"|"$/g, "");
  return acc;
}, {});

const MONGO_URI = args.uri || process.env.MONGODB_URI;
const DB_NAME = args.db || ""; // optional if uri already includes db
const MODE = (args.mode || "append").toLowerCase(); // append | reset
if (process.env.NODE_ENV === "production") {
  console.error("❌ Seeding is disabled in production");
  process.exit(1);
}

if (!MONGO_URI) {
  console.error("❌ Missing Mongo URI. Use --uri=... or set MONGODB_URI");
  process.exit(1);
}

// ---------- Helpers ----------
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const addDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

function makeOffer(price) {
  const offer = Math.random() < 0.35; // 35% on offer
  if (!offer) return { offer: false, offerPrice: null, offerEndsAt: null };

  const discountPct = pick([10, 15, 20, 25, 30]);
  const offerPrice = Math.max(1, Math.round(price * (1 - discountPct / 100)));
  const offerEndsAt = addDays(randInt(3, 14)); // ends in 3–14 days

  return { offer: true, offerPrice, offerEndsAt };
}

// ---------- Product templates (10 per category) ----------
const templatesByType = {
  restaurant: [
    { en: "Chicken Shawarma Wrap", ar: "ساندويتش شاورما دجاج", detailsEn: "Served with garlic sauce & pickles.", detailsAr: "يُقدم مع صوص الثوم والمخلل.", priceMin: 18, priceMax: 35 },
    { en: "Beef Burger", ar: "برجر لحم", detailsEn: "Grilled beef patty with cheese.", detailsAr: "قطعة لحم مشوية مع جبن.", priceMin: 22, priceMax: 45 },
    { en: "Margherita Pizza", ar: "بيتزا مارجريتا", detailsEn: "Classic tomato & mozzarella.", detailsAr: "طماطم وموزاريلا كلاسيكية.", priceMin: 28, priceMax: 55 },
    { en: "Chicken Biryani", ar: "برياني دجاج", detailsEn: "Aromatic rice with spices.", detailsAr: "أرز متبل بالبهارات.", priceMin: 20, priceMax: 40 },
    { en: "Grilled Mix Platter", ar: "مشاوي مشكلة", detailsEn: "Selection of grilled meats.", detailsAr: "تشكيلة من المشاوي.", priceMin: 45, priceMax: 95 },
    { en: "Pasta Alfredo", ar: "باستا ألفريدو", detailsEn: "Creamy sauce with chicken.", detailsAr: "صوص كريمي مع دجاج.", priceMin: 30, priceMax: 60 },
    { en: "Caesar Salad", ar: "سلطة سيزر", detailsEn: "Romaine, parmesan, croutons.", detailsAr: "خس، بارميزان، خبز محمص.", priceMin: 18, priceMax: 35 },
    { en: "Lentil Soup", ar: "شوربة عدس", detailsEn: "Warm & hearty soup.", detailsAr: "شوربة دافئة ومشبعة.", priceMin: 10, priceMax: 18 },
    { en: "Fresh Juice", ar: "عصير طازج", detailsEn: "Choose orange or mango.", detailsAr: "اختر برتقال أو مانجو.", priceMin: 8, priceMax: 18 },
    { en: "Chocolate Cake Slice", ar: "شريحة كيك شوكولاتة", detailsEn: "Rich chocolate dessert.", detailsAr: "تحلية شوكولاتة غنية.", priceMin: 12, priceMax: 25 }
  ],

  grocery: [
    { en: "Fresh Milk 1L", ar: "حليب طازج 1 لتر", detailsEn: "Chilled dairy milk.", detailsAr: "حليب مبرد.", priceMin: 6, priceMax: 12 },
    { en: "Eggs (12 pack)", ar: "بيض (12 حبة)", detailsEn: "Grade A eggs.", detailsAr: "بيض درجة أولى.", priceMin: 8, priceMax: 18 },
    { en: "Bananas 1kg", ar: "موز 1 كجم", detailsEn: "Fresh bananas.", detailsAr: "موز طازج.", priceMin: 5, priceMax: 12 },
    { en: "Tomatoes 1kg", ar: "طماطم 1 كجم", detailsEn: "Ripe tomatoes.", detailsAr: "طماطم ناضجة.", priceMin: 4, priceMax: 10 },
    { en: "Rice 5kg", ar: "أرز 5 كجم", detailsEn: "Long grain rice.", detailsAr: "أرز حبة طويلة.", priceMin: 22, priceMax: 45 },
    { en: "Cooking Oil 1.5L", ar: "زيت طبخ 1.5 لتر", detailsEn: "Vegetable oil.", detailsAr: "زيت نباتي.", priceMin: 14, priceMax: 30 },
    { en: "Bread Loaf", ar: "خبز", detailsEn: "Fresh bakery bread.", detailsAr: "خبز طازج.", priceMin: 3, priceMax: 8 },
    { en: "Chicken Breast 1kg", ar: "صدر دجاج 1 كجم", detailsEn: "Fresh poultry.", detailsAr: "دجاج طازج.", priceMin: 18, priceMax: 35 },
    { en: "Water Pack (12)", ar: "مياه (12)", detailsEn: "Bottled water pack.", detailsAr: "علبة مياه.", priceMin: 10, priceMax: 20 },
    { en: "Cheddar Cheese 200g", ar: "جبن شيدر 200 جم", detailsEn: "Cheddar cheese slices.", detailsAr: "شرائح جبن شيدر.", priceMin: 8, priceMax: 18 }
  ],

  pharmacy: [
    { en: "Vitamin C 1000mg", ar: "فيتامين سي 1000", detailsEn: "Daily immune support.", detailsAr: "لدعم المناعة يومياً.", priceMin: 20, priceMax: 55 },
    { en: "Pain Relief Tablets", ar: "مسكن ألم", detailsEn: "For headache & body pain.", detailsAr: "للصداع وآلام الجسم.", priceMin: 10, priceMax: 30 },
    { en: "Cough Syrup", ar: "شراب سعال", detailsEn: "Soothes dry cough.", detailsAr: "يخفف السعال الجاف.", priceMin: 12, priceMax: 35 },
    { en: "Hand Sanitizer 250ml", ar: "معقم يدين 250 مل", detailsEn: "Kills germs fast.", detailsAr: "يقضي على الجراثيم بسرعة.", priceMin: 8, priceMax: 20 },
    { en: "Adhesive Bandages", ar: "لاصقات جروح", detailsEn: "Assorted sizes.", detailsAr: "مقاسات متنوعة.", priceMin: 6, priceMax: 18 },
    { en: "Thermometer", ar: "ميزان حرارة", detailsEn: "Digital thermometer.", detailsAr: "ميزان حرارة رقمي.", priceMin: 20, priceMax: 55 },
    { en: "Allergy Tablets", ar: "حبوب حساسية", detailsEn: "Relief from allergies.", detailsAr: "لتخفيف الحساسية.", priceMin: 12, priceMax: 40 },
    { en: "Antiseptic Solution", ar: "محلول مطهر", detailsEn: "For wound cleaning.", detailsAr: "لتنظيف الجروح.", priceMin: 10, priceMax: 25 },
    { en: "Moisturizing Cream", ar: "كريم مرطب", detailsEn: "For dry skin.", detailsAr: "للبشرة الجافة.", priceMin: 15, priceMax: 45 },
    { en: "Oral Rehydration Salts", ar: "أملاح معالجة الجفاف", detailsEn: "Electrolyte support.", detailsAr: "تعويض الأملاح والسوائل.", priceMin: 6, priceMax: 18 }
  ],

  flower: [
    { en: "Rose Bouquet (Small)", ar: "باقة ورد (صغيرة)", detailsEn: "Fresh roses, small size.", detailsAr: "ورد طازج حجم صغير.", priceMin: 45, priceMax: 90 },
    { en: "Rose Bouquet (Large)", ar: "باقة ورد (كبيرة)", detailsEn: "Large premium bouquet.", detailsAr: "باقة كبيرة فاخرة.", priceMin: 120, priceMax: 250 },
    { en: "Mixed Flowers Bouquet", ar: "باقة زهور مشكلة", detailsEn: "Seasonal mixed flowers.", detailsAr: "زهور موسمية مشكلة.", priceMin: 80, priceMax: 180 },
    { en: "Tulip Bouquet", ar: "باقة توليب", detailsEn: "Fresh tulips arrangement.", detailsAr: "تنسيق توليب طازج.", priceMin: 90, priceMax: 200 },
    { en: "Gift Box Flowers", ar: "زهور صندوق هدية", detailsEn: "Flowers in a gift box.", detailsAr: "زهور داخل صندوق هدية.", priceMin: 110, priceMax: 260 },
    { en: "Single Rose", ar: "وردة واحدة", detailsEn: "One fresh rose.", detailsAr: "وردة طازجة واحدة.", priceMin: 15, priceMax: 35 },
    { en: "Flower Vase Set", ar: "مزهرية مع زهور", detailsEn: "Vase with flowers.", detailsAr: "مزهرية مع زهور.", priceMin: 140, priceMax: 320 },
    { en: "White Lily Bouquet", ar: "باقة زنبق أبيض", detailsEn: "Elegant white lilies.", detailsAr: "زنبق أبيض أنيق.", priceMin: 100, priceMax: 220 },
    { en: "Birthday Bouquet", ar: "باقة عيد ميلاد", detailsEn: "Colorful birthday bouquet.", detailsAr: "باقة ملونة للمناسبات.", priceMin: 90, priceMax: 210 },
    { en: "Wedding Bouquet", ar: "باقة زفاف", detailsEn: "Bridal style bouquet.", detailsAr: "باقة على طراز العروس.", priceMin: 180, priceMax: 450 }
  ],

  child_care: [
    { en: "Baby Diapers (Small)", ar: "حفاضات أطفال (صغير)", detailsEn: "Soft & comfortable.", detailsAr: "ناعمة ومريحة.", priceMin: 28, priceMax: 55 },
    { en: "Baby Wipes Pack", ar: "مناديل أطفال", detailsEn: "Gentle on skin.", detailsAr: "لطيفة على البشرة.", priceMin: 10, priceMax: 25 },
    { en: "Baby Bottle 250ml", ar: "رضاعة 250 مل", detailsEn: "BPA-free bottle.", detailsAr: "رضاعة بدون BPA.", priceMin: 15, priceMax: 35 },
    { en: "Baby Shampoo", ar: "شامبو أطفال", detailsEn: "Tear-free formula.", detailsAr: "تركيبة بدون دموع.", priceMin: 12, priceMax: 30 },
    { en: "Baby Lotion", ar: "لوشن أطفال", detailsEn: "Moisturizing lotion.", detailsAr: "لوشن مرطب.", priceMin: 15, priceMax: 35 },
    { en: "Toy Blocks Set", ar: "مجموعة مكعبات", detailsEn: "Colorful learning blocks.", detailsAr: "مكعبات تعليمية ملونة.", priceMin: 20, priceMax: 55 },
    { en: "Kids Story Book", ar: "كتاب قصص أطفال", detailsEn: "Illustrated story book.", detailsAr: "كتاب قصص مصور.", priceMin: 10, priceMax: 30 },
    { en: "Baby Pacifier", ar: "لهاية أطفال", detailsEn: "Soft silicone pacifier.", detailsAr: "لهاية سيليكون ناعمة.", priceMin: 6, priceMax: 18 },
    { en: "Kids Lunch Box", ar: "علبة غداء أطفال", detailsEn: "Easy-lock lunch box.", detailsAr: "علبة غداء سهلة الإغلاق.", priceMin: 12, priceMax: 35 },
    { en: "Baby Blanket", ar: "بطانية أطفال", detailsEn: "Warm soft blanket.", detailsAr: "بطانية دافئة وناعمة.", priceMin: 25, priceMax: 70 }
  ],

  nutrition: [
    { en: "Whey Protein 1kg", ar: "بروتين واي 1 كجم", detailsEn: "High protein supplement.", detailsAr: "مكمل عالي البروتين.", priceMin: 120, priceMax: 240 },
    { en: "Creatine 300g", ar: "كرياتين 300 جم", detailsEn: "Performance support.", detailsAr: "لدعم الأداء.", priceMin: 80, priceMax: 160 },
    { en: "Multivitamin", ar: "فيتامينات متعددة", detailsEn: "Daily vitamin support.", detailsAr: "دعم يومي للفيتامينات.", priceMin: 45, priceMax: 110 },
    { en: "Omega-3", ar: "أوميجا 3", detailsEn: "Heart & brain support.", detailsAr: "لدعم القلب والدماغ.", priceMin: 55, priceMax: 140 },
    { en: "Protein Bar (Box)", ar: "ألواح بروتين (علبة)", detailsEn: "Box of protein bars.", detailsAr: "علبة ألواح بروتين.", priceMin: 35, priceMax: 90 },
    { en: "BCAA", ar: "بي سي اي اي", detailsEn: "Recovery support.", detailsAr: "لدعم الاستشفاء.", priceMin: 70, priceMax: 150 },
    { en: "Electrolyte Drink Mix", ar: "بودرة أملاح", detailsEn: "Hydration support.", detailsAr: "لدعم الترطيب.", priceMin: 30, priceMax: 80 },
    { en: "Natural Honey 500g", ar: "عسل طبيعي 500 جم", detailsEn: "Pure honey jar.", detailsAr: "عسل طبيعي.", priceMin: 25, priceMax: 75 },
    { en: "Oats 1kg", ar: "شوفان 1 كجم", detailsEn: "Whole oats.", detailsAr: "شوفان كامل.", priceMin: 12, priceMax: 35 },
    { en: "Peanut Butter 340g", ar: "زبدة فول سوداني 340 جم", detailsEn: "Creamy peanut butter.", detailsAr: "زبدة فول سوداني كريمية.", priceMin: 18, priceMax: 45 }
  ],

  electronics: [
    { en: "Phone Charger 20W", ar: "شاحن هاتف 20 واط", detailsEn: "Fast charging adapter.", detailsAr: "شاحن سريع.", priceMin: 35, priceMax: 95 },
    { en: "USB-C Cable", ar: "سلك USB-C", detailsEn: "Durable charging cable.", detailsAr: "سلك شحن متين.", priceMin: 15, priceMax: 45 },
    { en: "Wireless Earbuds", ar: "سماعات لاسلكية", detailsEn: "Bluetooth earbuds.", detailsAr: "سماعات بلوتوث.", priceMin: 99, priceMax: 299 },
    { en: "Power Bank 10000mAh", ar: "باور بنك 10000", detailsEn: "Portable power bank.", detailsAr: "شاحن متنقل.", priceMin: 70, priceMax: 160 },
    { en: "Phone Case", ar: "جراب هاتف", detailsEn: "Protective phone case.", detailsAr: "جراب حماية.", priceMin: 20, priceMax: 60 },
    { en: "Screen Protector", ar: "حماية شاشة", detailsEn: "Tempered glass.", detailsAr: "زجاج حماية.", priceMin: 10, priceMax: 35 },
    { en: "Bluetooth Speaker", ar: "سماعة بلوتوث", detailsEn: "Portable speaker.", detailsAr: "سماعة متنقلة.", priceMin: 90, priceMax: 250 },
    { en: "Smart Watch", ar: "ساعة ذكية", detailsEn: "Fitness & notifications.", detailsAr: "لياقة وإشعارات.", priceMin: 150, priceMax: 600 },
    { en: "Laptop Mouse", ar: "ماوس لابتوب", detailsEn: "Wireless mouse.", detailsAr: "ماوس لاسلكي.", priceMin: 35, priceMax: 120 },
    { en: "HDMI Cable", ar: "سلك HDMI", detailsEn: "High-speed HDMI.", detailsAr: "HDMI عالي السرعة.", priceMin: 18, priceMax: 55 }
  ]
};

// ---------- Schemas (minimal) ----------
const StoreSchema = new mongoose.Schema(
  {
    name: String,
    name_ar: String,
    type: String,
    logo: String,
    address: String
  },
  { collection: "stores" }
);

const ProductSchema = new mongoose.Schema(
  {
    storeId: mongoose.Schema.Types.ObjectId,
    storeSnapshot: {
      type: { type: String },
      name: String,
      name_ar: String,
      logo: String,
      address: String
    },
    name: String,
    name_ar: String,
    price: Number,
    image: String,
    offer: Boolean,
    offerPrice: Number,
    offerEndsAt: Date,
    details: String,
    details_ar: String,
    stockQty: Number,
    isActive: Boolean
  },
  { collection: "products", timestamps: true }
);

const Store = mongoose.model("Store", StoreSchema);
const Product = mongoose.model("Product", ProductSchema);

// ---------- Main ----------
(async () => {
  try {
    const conn = DB_NAME ? `${MONGO_URI}/${DB_NAME}` : MONGO_URI;
    await mongoose.connect(conn);
    console.log("✅ Connected");

    const stores = await Store.find({}).lean();
    console.log(`🧾 Stores found: ${stores.length}`);

    if (MODE === "reset") {
      const storeIds = stores.map((s) => s._id);
      const del = await Product.deleteMany({ storeId: { $in: storeIds } });
      console.log(`🧹 Deleted existing products: ${del.deletedCount}`);
    }

    const toInsert = [];

    for (const store of stores) {
      const type = store.type;
      const templates = templatesByType[type];

      if (!templates || templates.length < 10) {
        console.warn(`⚠️ No templates for type "${type}" (store ${store.name})`);
        continue;
      }

      // Exactly 10 products per store
      for (let i = 0; i < 10; i++) {
        const t = templates[i];

        const price = randInt(t.priceMin, t.priceMax);

        const { offer, offerPrice, offerEndsAt } = makeOffer(price);

        // Product image placeholder (you can replace later with real uploaded paths)
        const image = `/uploads/seed/${type}-${i + 1}.png`;

        const productDoc = {
          storeId: store._id,
          storeSnapshot: {
            type,
            name: store.name || "",
            name_ar: store.name_ar || "",
            logo: store.logo || "",
            address: store.address || ""
          },
          name: t.en,
          name_ar: t.ar,
          price,
          image,
          offer,
          offerPrice,
          offerEndsAt,
          details: t.detailsEn || "",
          details_ar: t.detailsAr || "",
          stockQty: randInt(5, 80),
          isActive: true
        };

        toInsert.push(productDoc);
      }
    }

    if (!toInsert.length) {
      console.log("⚠️ Nothing to insert.");
      process.exit(0);
    }

    const res = await Product.insertMany(toInsert, { ordered: false });
    console.log(`✅ Inserted products: ${res.length}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exit(1);
  }
})();
