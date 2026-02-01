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

// Routers (API)
const customerApiRouter = require("./routes/api/customer");
const driverApi = require("./routes/api/driver");
const customerDisputes = require("./routes/api/customerDisputes");
const mobileApi = require("./routes/api/mobile");

// Routers (Web / Payment pages)
const orderRoutes = require("./routes/frontend/order");

// Routers (Admin)
const authRoutes = require("./routes/backend/auth");
const adminDashboard = require("./routes/backend/adminDashboard");
const adminStores = require("./routes/backend/adminStores");
const adminProducts = require("./routes/backend/adminProducts");
const adminCategories = require("./routes/backend/adminCategories");
const adminDisputes = require("./routes/backend/adminDisputes");
const adminOrdersRoutes = require("./routes/backend/adminOrders");
const reportsRouter = require("./routes/backend/reports");

// Helpers
const distanceHelper = require("./utils/distance");

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const MONGODB_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/flamingosDB";

const isProd = process.env.NODE_ENV === "production";
const app = express();

// Feature flags
const flag = (name, fallback = "false") =>
  String(process.env[name] ?? fallback).toLowerCase() === "true";

const ENABLE_ADMIN = flag("ENABLE_ADMIN", "true");
const ENABLE_WEB = flag("ENABLE_WEB", "true");

if (isProd) app.set("trust proxy", 1);

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static
app.use(express.static(path.join(__dirname, "public"), { maxAge: isProd ? "1d" : 0 }));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// Sessions
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
      secure: isProd,          // ✅ true on Railway (HTTPS)
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000,
    },
  })
);

// Locals
app.use((req, res, next) => {
  res.locals.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
  res.locals.user = req.session?.user || null;
  next();
});

// View engine (needed for admin)
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

// Root
app.get("/", (req, res) => {
  const role = req.session?.userRole || req.session?.user?.role;
  if (role === "admin" || role === "support") return res.redirect("/admin");
  return res.redirect("/auth/login");
});

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// APIs
app.use("/api/customer", customerApiRouter);
app.use("/api/driver", driverApi);
app.use("/api/mobile", mobileApi);
app.use("/api/customer/disputes", customerDisputes);

// Web routes (payment callbacks/pages)
if (ENABLE_WEB) {
  app.use("/order", orderRoutes);
}

// Admin routes
if (ENABLE_ADMIN) {
  app.use("/auth", authRoutes);
  app.use("/delivery", require("./routes/backend/delivery"));

  app.use("/admin/stores", adminStores);
  app.use("/admin/products", adminProducts);
  app.use("/admin/categories", adminCategories);
  app.use("/admin/disputes", adminDisputes);

  app.use("/admin", adminOrdersRoutes);
  app.use("/admin", adminDashboard);

  app.use("/backend/reports", reportsRouter);
}

// 404
app.use((req, res) => {
  res.status(404);
  if (req.accepts("html")) return res.render("frontend/404", { layout: "main" });
  return res.json({ error: "Not Found" });
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
