
const express = require("express");
const router = express.Router();
const CarouselSlide = require("../../models/CarouselSlide");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const uploadToCloudinary = require("../../utils/uploadToCloudinary");

// GET /admin/carousel
router.get("/", async (req, res) => {
  try {
    const slides = await CarouselSlide.find()
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return res.render("backend/carousel", {
      layout: "backend-layout",
      title: "Carousel Manager",
      user: req.session.user,
      slides: slides || [],
      editSlide: null,
    });
  } catch (err) {
    console.error("❌ GET /admin/carousel error:", err);
    return res.status(500).send("Server error");
  }
});

// GET /admin/carousel/edit/:id
router.get("/edit/:id", async (req, res) => {
  try {
    const slides = await CarouselSlide.find()
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    const editSlide = await CarouselSlide.findById(req.params.id).lean();

    if (!editSlide) {
      return res.redirect("/admin/carousel");
    }

    return res.render("backend/carousel", {
      layout: "backend-layout",
      title: "Carousel Manager",
      user: req.session.user,
      slides: slides || [],
      editSlide,
    });
  } catch (err) {
    console.error("❌ GET /admin/carousel/edit/:id error:", err);
    return res.status(500).send("Server error");
  }
});

// POST /admin/carousel/save
router.post("/save", upload.single("media"), async (req, res) => {
  try {
    console.log("🔥 SAVE ROUTE HIT");
    console.log("BODY id:", req.body?.id);
    console.log("BODY mediaUrl:", req.body?.mediaUrl);
    console.log("FILE EXISTS:", !!req.file);

    const {
      id,
      type,
      mediaUrl,
      title,
      titleAr,
      description,
      buttonText,
      actionType,
      actionValue,
      sortOrder,
    } = req.body;

    let finalMediaUrl = "";

    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.buffer, "onego/carousel");
      finalMediaUrl = uploaded.secure_url;
    } else if (mediaUrl && String(mediaUrl).trim()) {
      finalMediaUrl = String(mediaUrl).trim();
    }

    if (id) {
      const existing = await CarouselSlide.findById(id);
      console.log("EXISTING SLIDE:", existing ? existing._id : null);
      console.log("EXISTING mediaUrl:", existing?.mediaUrl);

      if (!existing) {
        return res.status(404).send("Slide not found");
      }

      if (!finalMediaUrl) {
        finalMediaUrl = existing.mediaUrl || "";
      }

      const payload = {
        type: String(type || existing.type || "image").trim(),
        mediaUrl: finalMediaUrl,
        title: String(title || "").trim(),
        titleAr: String(titleAr || "").trim(),
        description: String(description || "").trim(),
        buttonText: String(buttonText || "").trim(),
        actionType: String(actionType || "none").trim(),
        actionValue: String(actionValue || "").trim(),
        isActive: req.body.isActive === "on",
        sortOrder: Number(sortOrder || 0),
      };

      if (!payload.mediaUrl) {
        return res.status(400).send("Media file or Media URL is required");
      }

      await CarouselSlide.findByIdAndUpdate(id, payload, { new: true });
    } else {
      const payload = {
        type: String(type || "image").trim(),
        mediaUrl: finalMediaUrl,
        title: String(title || "").trim(),
        titleAr: String(titleAr || "").trim(),
        description: String(description || "").trim(),
        buttonText: String(buttonText || "").trim(),
        actionType: String(actionType || "none").trim(),
        actionValue: String(actionValue || "").trim(),
        isActive: req.body.isActive === "on",
        sortOrder: Number(sortOrder || 0),
      };

      if (!payload.mediaUrl) {
        return res.status(400).send("Media file or Media URL is required");
      }

      await CarouselSlide.create(payload);
    }

    return res.redirect("/admin/carousel");
  } catch (err) {
    console.error("❌ POST /admin/carousel/save error:", err);
    return res.status(500).send("Server error");
  }
});

// POST /admin/carousel/delete/:id
router.post("/delete/:id", async (req, res) => {
  try {
    const slide = await CarouselSlide.findById(req.params.id);

    if (!slide) {
      return res.redirect("/admin/carousel");
    }

    await CarouselSlide.findByIdAndDelete(req.params.id);
    return res.redirect("/admin/carousel");
  } catch (err) {
    console.error("❌ POST /admin/carousel/delete/:id error:", err);
    return res.status(500).send("Server error");
  }
});

module.exports = router;