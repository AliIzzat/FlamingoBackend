const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const Food = require("../../models/Product");
const Restaurant = require("../../models/Store");
// Load JSON data
const groceries = require("../../data/groceries.json");
const childCareStores = require("../../data/childCareStores.json");
const pharmacies = require("../../data/pharmacies.json");
const flowerShops = require("../../data/flowerShops.json");
const nutrition = require("../../data/nutrition.json");
const electronics = require("../../data/electronics.json");

// Root route → loads introduction.hbs
router.get("/", (req, res) => {
  return res.render("frontend/introduction", {
    layout: false,
    title: "Welcome to Flamingo",
  });
});

// ✅ Full-featured homepage
router.get("/home", async (req, res) => {
  try {
    // Pull meals + restaurants
    const allMeals = await Food.find().limit(20).lean();
    const allRestaurants = await Restaurant.find().lean();

    // Session
    const favorites = req.session.favorites || [];
    const cart = req.session.cart || [];
    const cartCount = Array.isArray(cart) ? cart.length : 0;

    // Optional: decorate meals with isFavorite (easy use in hbs)
    const favSet = new Set((favorites || []).map(String));
    const mealsWithFav = (allMeals || []).map((m) => ({
      ...m,
      isFavorite: favSet.has(String(m._id)),
    }));

    // Load carousel items safely
    const jsonPath = path.join(__dirname, "../../public/carousel/data.json");
    let carouselItems = [];

    if (fs.existsSync(jsonPath)) {
      try {
        const jsonData = await fs.promises.readFile(jsonPath, "utf-8");
        const parsed = JSON.parse(jsonData);
        carouselItems = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("⚠️ Carousel JSON read/parse error:", e.message);
        carouselItems = [];
      }
    }

//     return res.render("frontend/home", {
//       layout: "main",          // ✅ use views/layouts/main.hbs
//       title: "Home",
//       showMiniCart: true,      // ✅ enables your mini cart in main.hbs

//       // User/session context (optional but useful)
//       user: req.session.user || null,
//       cartCount,

//       // Data for page
//       allMeals: mealsWithFav,
//       meals: mealsWithFav,     // ✅ support templates expecting "meals"
//       favorites,               // keep original favorites array too

//       restaurants: allRestaurants,
//       carouselItems,

//       groceries,
//       childCareStores,
//       pharmacies,
//       flowerShops,
//       nutrition,
//       electronics,
//     });
//   } catch (err) {
//     console.error("❌ Error in /home route:", err);
//     return res.status(500).render("frontend/500", {
//       layout: "main",
//       title: "Server Error",
//       showMiniCart: false,
//     });
//   }
 });

module.exports = router;
