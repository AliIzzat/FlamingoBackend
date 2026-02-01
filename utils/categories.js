const Category = require("../models/Category");

async function getActiveCategoryKeys() {
  const rows = await Category.find({ isActive: true }).select("key").lean();
  return rows.map(r => r.key);
}

module.exports = { getActiveCategoryKeys };
