console.log("🚀 APP.JS LOADED - VERSION 2026-02-25 B");
console.log("🔐 MF TOKEN length =", process.env.MYFATOORAH_TOKEN?.length);
console.log("🌐 MF API URL =", process.env.MF_API_URL);
require("dotenv").config();
const path = require("path");
const express = require("express");
const compression = require("compression");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cors = require("cors");
const exphbs = require("express-handlebars");
const Handlebars = require("handlebars");
const Product = require("./models/Product");

// API Routers (these exist and are needed on Railway)
const customerApiRouter = require("./routes/api/customer");
const driverApi = require("./routes/api/driver");
const customerDisputes = require("./routes/api/customerDisputes");
const mobileApi = require("./routes/api/mobile");
const mealsRouter = require("./routes/api/meals");
const storesRouter = require("./routes/api/stores");
const mobileProducts = require("./routes/api/mobileProducts");
const paymentsRoutes = require("./routes/api/mobile/payments");
const orderRoutes = require("./routes/frontend/order");
const mobileOrders = require("./routes/api/mobile/orders");
// Helpers
const distanceHelper = require("./utils/distance");

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGO_URI;

if (!MONGODB_URI) {
  console.error("❌ Missing MongoDB URI. Set MONGODB_URI in Railway Variables.");
  process.exit(1);
}

const isProd = process.env.NODE_ENV === "production";
const app = express();

// check request is reaching Node server
app.use((req, res, next) => {
  console.log("➡️", req.method, req.originalUrl);
  next();
});
// Feature flags
const flag = (name, fallback = "false") =>
  String(process.env[name] ?? fallback).toLowerCase() === "true";

const ENABLE_ADMIN = flag("ENABLE_ADMIN", "false");
const ENABLE_WEB = flag("ENABLE_WEB", "true");

// Hard block admin routes when ENABLE_ADMIN is false (extra safety)
if (!ENABLE_ADMIN) {
  const blocked = ["/admin", "/auth", "/delivery", "/backend"];
  app.use(blocked, (_req, res) => res.status(404).json({ error: "Not Found" }));
}

if (isProd) app.set("trust proxy", 1);

// Middleware
app.use(cors({ origin: true, credentials: true }));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (logos / uploads)
app.use("/logos", express.static(path.join(__dirname, "logos")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Static
app.use(express.static(path.join(__dirname, "public"), { maxAge: isProd ? "1d" : 0 }));


// Sessions (needed for admin + web flows; harmless for API)
if (ENABLE_WEB || ENABLE_ADMIN) {
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallbackSecretKey",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      collectionName: "sessions",
    }),
    name: "sid",
    cookie: {
      secure: isProd, // OK on Railway if NODE_ENV=production and trust proxy=1
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000,
    },
  })
);
}
// Locals
app.use((req, res, next) => {
  res.locals.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
  res.locals.user = req.session?.user || null;
  next();
});


// View engine (only really needed if you render pages)
app.engine(
  "hbs",
  exphbs.engine({
    extname: ".hbs",
    defaultLayout: "backend-layout",
    layoutsDir: path.join(__dirname, "views/layouts"),
    partialsDir: path.join(__dirname, "views/partials"),
    handlebars: Handlebars,
    runtimeOptions: {
      allowProtoPropertiesByDefault: true,
      allowProtoMethodsByDefault: true,
    },
    helpers: {
      distance: distanceHelper,
      eq: (a, b) => String(a) === String(b),
      money: (n) => (Number(n) || 0).toFixed(2),
    },
  })
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.get("/", (req, res) => {
  if (ENABLE_ADMIN) return res.redirect("/auth/login");
  return res.json({ ok: true, message: "FlamingoBackend API running" });
});

// Health
// --- HEALTH (keep ONE copy only) ---
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    port: process.env.PORT || null,
    envFlags: {
      JWT_SECRET: !!process.env.JWT_SECRET,
      DRIVER_JWT_SECRET: !!process.env.DRIVER_JWT_SECRET,
      MYFATOORAH_TOKEN: !!process.env.MYFATOORAH_TOKEN,
      MF_TOKEN: !!process.env.MF_TOKEN,
      MF_API_URL: !!process.env.MF_API_URL,
      MYFATOORAH_API_URL: !!process.env.MYFATOORAH_API_URL,
    },
    lens: {
      JWT_SECRET: (process.env.JWT_SECRET || "").length,
      DRIVER_JWT_SECRET: (process.env.DRIVER_JWT_SECRET || "").length,
      MYFATOORAH_TOKEN: (process.env.MYFATOORAH_TOKEN || "").length,
    },
    time: new Date().toISOString(),
  });
});

// optional alias
app.get("/api/health", (_req, res) => res.redirect(302, "/health"));

app.get("/api/ping", (_req, res) => res.type("text/plain").send("pong"));
// APIs
app.use("/api/mobile", mobileApi);
app.use("/api/meals", mealsRouter);
app.use("/api/stores", storesRouter);
app.use("/api/customer", customerApiRouter);
app.use("/api/driver", driverApi);
app.use("/api/customer/disputes", customerDisputes);
app.use("/api/mobile/products", mobileProducts);
app.use("/api/mobile/payments", paymentsRoutes);
app.use("/api/mobile/orders", mobileOrders);

if (ENABLE_WEB) {
  app.use("/order", orderRoutes);
}

// Admin routes (LAZY REQUIRE so disabled means not loaded at all)
if (ENABLE_ADMIN) {
  const authRoutes = require("./routes/backend/auth");
  const deliveryRoutes = require("./routes/backend/delivery");
  const adminDashboard = require("./routes/backend/adminDashboard");
  const adminStores = require("./routes/backend/adminStores");
  const adminProducts = require("./routes/backend/adminProducts");
  const adminCategories = require("./routes/backend/adminCategories");
  const adminDisputes = require("./routes/backend/adminDisputes");
  const adminOrdersRoutes = require("./routes/backend/adminOrders");
  const reportsRouter = require("./routes/backend/reports");

  app.use("/auth", authRoutes);
  app.use("/delivery", deliveryRoutes);

  app.use("/admin/stores", adminStores);
  app.use("/admin/products", adminProducts);
  app.use("/admin/categories", adminCategories);
  app.use("/admin/disputes", adminDisputes);

  app.use("/admin", adminOrdersRoutes);
  app.use("/admin", adminDashboard);

  app.use("/backend/reports", reportsRouter);
}
//--------------------debug try Temp-----------
app.get("/api/_debug/db", (req, res) => {
  res.json({
    host: mongoose.connection.host,
    name: mongoose.connection.name,
    readyState: mongoose.connection.readyState, // 1 = connected
  });
});

app.get("/api/_debug/products-count", async (req, res) => {
  const Product = require("./models/Product");

  const total = await Product.countDocuments({});
  const active = await Product.countDocuments({ isActive: true });

  const restaurantBySnapshot = await Product.countDocuments({
    isActive: true,
    "storeSnapshot.type": "restaurant",
  });

  // Add this for testing
  app.get("/", (req, res) => res.status(200).send("OK")); 

  const offerRestaurantBySnapshot = await Product.countDocuments({
    isActive: true,
    offer: true,
    "storeSnapshot.type": "restaurant",
  });

  const restaurantByCategory = await Product.countDocuments({
    isActive: true,
    category: "restaurant",
  });

  const offerRestaurantByCategory = await Product.countDocuments({
    isActive: true,
    offer: true,
    category: "restaurant",
  });

  return res.json({
    total,
    active,
    restaurantBySnapshot,
    offerRestaurantBySnapshot,
    restaurantByCategory,
    offerRestaurantByCategory,
  });
});
// 404 (safe for API + HTML)
app.use((req, res) => {
  // If it's an API call, return JSON instead of rendering a page
  if (req.originalUrl.startsWith("/api")) {
    return res.status(404).json({ error: "Not found", path: req.originalUrl });
  }

  // Otherwise render web 404 if you have it
  return res.status(404).send("Not found");
});

app.use((err, req, res, next) => {
  console.error("🌋 Unhandled error:", err);
  if (req.originalUrl.startsWith("/api")) {
    return res.status(500).json({ error: "Server error" });
  }
  return res.status(500).send("Server error");
});

app.use((err, req, res, next) => {
  console.error("💥 UNHANDLED ERROR:", err);
  res.status(500).json({ ok: false, error: "Server error", debug: err?.message });
});

process.on("SIGTERM", () => {
  console.log("⚠️ SIGTERM received — Railway is stopping the container");
  process.exit(0);
});

// Start
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
    console.log("Mongo connected");
    app.listen(PORT, "0.0.0.0", () => console.log(`🚀 http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
})();
