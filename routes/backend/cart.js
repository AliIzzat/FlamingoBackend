const express = require("express");
const router = express.Router();

const Food = require("../models/FoodDef");
// Later you can add:
// const Product = require("../models/Product");
// const PharmacyItem = require("../models/PharmacyItem");
// etc.

function getModelByType(type) {
  // Default to "meal" if not provided
  const t = (type || "meal").toLowerCase();
  if (t === "meal") return Food;

  // Add more types later:
  // if (t === "flower") return Flower;
  // if (t === "pharmacy") return PharmacyItem;

  return null;
}

/* -----------------------------------------
   POST: Add item to cart
   URL: /cart/add
----------------------------------------- */
router.post("/cart/add", async (req, res) => {
  const { itemId, mealId, type } = req.body;

  const finalId = itemId || mealId; // backward compatible with your old code
  const Model = getModelByType(type);

  try {
    if (!finalId) {
      return res.status(400).json({ success: false, message: "itemId is required" });
    }
    if (!Model) {
      return res.status(400).json({ success: false, message: `Unknown type: ${type}` });
    }

    const item = await Model.findById(finalId).lean();
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    req.session.cart = req.session.cart || [];

    const existing = req.session.cart.find(
      (x) => x.itemId?.toString() === item._id.toString() && (x.type || "meal") === (type || "meal")
    );

    if (existing) {
      existing.quantity += 1;
    } else {
      req.session.cart.push({
        type: type || "meal",
        itemId: item._id,
        name: item.name,
        price: Number(item.price) || 0,
        restaurant: item.restaurant_en || item.restaurant || "",
        quantity: 1,
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error adding to cart:", err);
    return res.status(500).json({ success: false, message: "Error adding to cart" });
  }
});

/* -----------------------------------------
   POST: Update ONE item quantity (JSON)
   URL: /cart/update-one
----------------------------------------- */
router.post("/cart/update-one", (req, res) => {
  const { itemId, type, quantity } = req.body;

  if (!req.session.cart) req.session.cart = [];

  const qty = parseInt(quantity, 10);
  if (!itemId || Number.isNaN(qty) || qty < 1 || qty > 100) {
    return res.status(400).json({ success: false, message: "Invalid payload" });
  }

  const cartItem = req.session.cart.find(
    (x) => x.itemId?.toString() === itemId.toString() && (x.type || "meal") === (type || "meal")
  );

  if (!cartItem) {
    return res.status(404).json({ success: false, message: "Cart item not found" });
  }

  cartItem.quantity = qty;

  const total = req.session.cart.reduce((sum, it) => sum + (Number(it.price) || 0) * (it.quantity || 1), 0);

  return res.json({ success: true, total });
});

/* -----------------------------------------
   POST: Remove selected (Form submit)
   URL: /cart/remove-selected
----------------------------------------- */
router.post("/cart/remove-selected", (req, res) => {
  const selectedIds = req.body.selectedMeals;

  if (!req.session.cart || !selectedIds) return res.redirect("/cart/view");

  const idsToRemove = Array.isArray(selectedIds) ? selectedIds : [selectedIds];

  req.session.cart = req.session.cart.filter(
    (item) => !idsToRemove.includes(item.itemId?.toString() || item.mealId?.toString())
  );

  return res.redirect("/cart/view");
});

/* -----------------------------------------
   POST: Update quantities (Form submit)
   URL: /cart/update-quantities
----------------------------------------- */
router.post("/cart/update-quantities", (req, res) => {
  const cart = req.session.cart || [];
  const quantities = req.body.quantities;

  if (!quantities) return res.redirect("/cart/view");

  Object.entries(quantities).forEach(([index, qty]) => {
    const q = parseInt(qty, 10);
    if (cart[index] && q > 0 && q <= 100) cart[index].quantity = q;
  });

  req.session.cart = cart;
  return res.redirect("/cart/view");
});

/* -----------------------------------------
   GET: View Cart
----------------------------------------- */
router.get("/cart/view", async (req, res) => {
  try {
    const cart = req.session.cart || [];

    // If you later support multiple types, you'd fetch per type.
    // For now we assume meals only (FoodDef), but we store itemId.
    const itemIds = cart.map((x) => x.itemId || x.mealId).filter(Boolean);
    const items = await Food.find({ _id: { $in: itemIds } }).lean();

    const cartItems = cart.map((cartItem) => {
      const id = (cartItem.itemId || cartItem.mealId).toString();
      const found = items.find((m) => m._id.toString() === id);

      return {
        type: cartItem.type || "meal",
        itemId: cartItem.itemId || cartItem.mealId,
        name: found?.name || cartItem.name,
        price: found?.price ?? cartItem.price,
        restaurant: found?.restaurant_en || found?.restaurant || cartItem.restaurant,
        quantity: cartItem.quantity || 1,
      };
    });

    req.session.cart = cartItems;

    const totalAmount = cartItems.reduce((sum, item) => sum + (Number(item.price) || 0) * (item.quantity || 1), 0);

    const favoriteIds = req.session.favorites || [];
    const favoriteMeals = await Food.find({ _id: { $in: favoriteIds } }).lean();

    return res.render("cart", {
      cart: cartItems,
      total: totalAmount,
      favoriteMeals,
      hideFooter: true,
    });
  } catch (err) {
    console.error("❌ Error rendering cart:", err);
    return res.status(500).send("Failed to load cart");
  }
});

module.exports = router;