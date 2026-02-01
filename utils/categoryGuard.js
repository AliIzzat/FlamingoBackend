// utils/categoryGuard.js
const Category = require("../models/Category");

async function getActiveCategoryKeys() {
  const cats = await Category.find({ isActive: true }).select("key").lean();
  return cats.map((c) => c.key);
}

async function isCategoryActive(key) {
  if (!key) return false;
  const cat = await Category.findOne({ key: String(key).trim().toLowerCase(), isActive: true })
    .select("_id")
    .lean();
  return !!cat;
}

module.exports = { getActiveCategoryKeys, isCategoryActive };
