// 🔴 REQUIRED: load .env for scripts
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });


const mongoose = require("mongoose");
const Category = require("../models/Category");
const Store = require("../models/Store");
const Product = require("../models/Product");

(async () => {
  try {
    // ✅ THIS CODE GOES HERE
    const uri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI;

    if (!uri) {
      console.error("❌ Missing Mongo URI. Set MONGO_URI or MONGODB_URI in .env");
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ Connected for migration");

    // ---- migration logic below ----
    await Product.updateMany(
      { category: "rsetaurant" },
      { $set: { category: "restaurant" } }
    );

    await Store.updateMany({}, [{ $set: { type: { $toLower: "$type" } } }]);
    await Product.updateMany({}, [{ $set: { category: { $toLower: "$category" } } }]);

    console.log("✅ Migration done");
    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
