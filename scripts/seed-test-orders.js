// scripts/seed-test-orders.js
require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("../models/Order");
const User = require("../models/User");

/**
 * CONFIG
 * - Run like: node scripts/seed-test-orders.js 25
 * - Default: 20 orders
 */
const countArg = parseInt(process.argv[2], 10);
const ORDER_COUNT = Number.isFinite(countArg) ? Math.max(1, Math.min(countArg, 50)) : 20;

// Doha-ish coordinates for map verification (lat/lng)
const DOHA_POINTS = [
  { name: "West Bay", lat: 25.323, lng: 51.528 },
  { name: "Al Sadd", lat: 25.285, lng: 51.526 },
  { name: "The Pearl", lat: 25.372, lng: 51.548 },
  { name: "Lusail", lat: 25.420, lng: 51.490 },
  { name: "Old Airport", lat: 25.260, lng: 51.565 },
  { name: "Bin Mahmoud", lat: 25.292, lng: 51.515 },
  { name: "Al Wakrah", lat: 25.168, lng: 51.604 },
  { name: "Al Rayyan", lat: 25.308, lng: 51.424 },
];

// Fake menu items
const MENU = [
  { name: "Chicken Shawarma", price: 18, category: "restaurant" },
  { name: "Beef Burger", price: 25, category: "restaurant" },
  { name: "Pizza Margherita", price: 30, category: "restaurant" },
  { name: "Biryani", price: 28, category: "restaurant" },
  { name: "Pasta Alfredo", price: 32, category: "restaurant" },
];

// Helpers
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

async function connect() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGO_URI (or MONGODB_URI) in .env");
  }
  await mongoose.connect(uri);
}

async function upsertTestDriver() {
  // Adjust fields if your User model differs
  const username = "test_driver";
  const password = "1234"; // For testing only
  const role = "driver";

  let driver = await User.findOne({ username }).lean();

  if (!driver) {
    const created = await User.create({
      name: "Test Driver",
      username,
      password,
      role,
      phone: "50000000",
    });
    driver = created.toObject();
    console.log("✅ Test driver created:", driver.username, driver._id.toString());
  } else {
    console.log("✅ Test driver exists:", driver.username, driver._id.toString());
  }

  return driver;
}

async function seedOrders(driverId) {
  const now = Date.now();

  const docs = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    const customerPoint = pick(DOHA_POINTS);
    const pickupPoint = pick(DOHA_POINTS);

    const item = pick(MENU);
    const qty = randInt(1, 3);
    const subtotal = item.price * qty;
    const deliveryFee = randInt(3, 10);
    const total = subtotal + deliveryFee;

    // Status distribution
    // - some Pending (unpicked)
    // - some Claimed, PickedUp, Delivered
    const roll = Math.random();
    let status = "Pending";
    if (roll >= 0.45 && roll < 0.65) status = "Claimed";
    if (roll >= 0.65 && roll < 0.85) status = "PickedUp";
    if (roll >= 0.85) status = "Delivered";

    const assignedDriverId = status === "Pending" ? null : driverId;

    // timestamps spaced out
    const createdAt = new Date(now - randInt(5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000));
    const claimedAt = assignedDriverId ? new Date(createdAt.getTime() + randInt(2, 30) * 60 * 1000) : null;
    const pickedUpAt = status === "PickedUp" || status === "Delivered"
      ? new Date((claimedAt || createdAt).getTime() + randInt(5, 30) * 60 * 1000)
      : null;
    const deliveredAt = status === "Delivered"
      ? new Date((pickedUpAt || claimedAt || createdAt).getTime() + randInt(10, 60) * 60 * 1000)
      : null;

    docs.push({
      // Tag for easy reset
      isTestSeed: true,

      customer: {
        name: `Customer ${i + 1}`,
        phone: `55${randInt(100000, 999999)}`,
        addressText: `${customerPoint.name}, Doha`,
        location: { lat: customerPoint.lat, lng: customerPoint.lng },
      },

      pickup: {
        addressText: `Test Restaurant - ${pickupPoint.name}`,
        location: { lat: pickupPoint.lat, lng: pickupPoint.lng },
      },

      items: [
        {
          productId: new mongoose.Types.ObjectId(), // safe fake Product ID
          storeId: null,
          category: item.category,
          name_snapshot: item.name,
          price_snapshot: round2(item.price),
          qty,
          image_snapshot: "",
        },
      ],

      totals: {
        subtotal: round2(subtotal),
        deliveryFee: round2(deliveryFee),
        total: round2(total),
      },

      payment: {
        method: "cash",
        status: "paid",
        invoiceId: "",
        paymentId: "",
      },

      delivery: {
        status,
        assignedDriverId,
        claimedAt,
        pickedUpAt,
        deliveredAt,
      },

      dispute: {
        status: "None",
        reason: "",
        notesCustomer: "",
        notesAdmin: "",
        createdAt: null,
        updatedAt: null,
        refund: {
          amount: 0,
          currency: "QAR",
          method: "",
          refundId: "",
          refundedAt: null,
        },
      },

      createdAt,
      updatedAt: new Date(createdAt.getTime() + randInt(1, 120) * 60 * 1000),
    });
  }

  const inserted = await Order.insertMany(docs);
  console.log(`✅ Inserted ${inserted.length} test orders (isTestSeed=true).`);
}

(async () => {
  try {
    await connect();

    const driver = await upsertTestDriver();
    await seedOrders(driver._id);

    console.log("✅ Done.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
})();
