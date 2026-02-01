const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../../models/Order");
function adminOnly(req, res, next) {
  // TEMP: allow for now; replace with isAdmin later
  next();
}

// GET /admin/disputes
router.get("/", adminOnly, async (req, res) => {
  try {
    const status = (req.query.status || "All").trim();

    const baseDisputeFilter = {
      "dispute.status": { $ne: "None" },
      $or: [
        { "dispute.reason": { $exists: true, $ne: "" } },
        { "dispute.notesCustomer": { $exists: true, $ne: "" } },
        { "dispute.createdAt": { $exists: true, $ne: null } },
      ],
    };

    const filter =
      status === "All"
        ? baseDisputeFilter
        : { ...baseDisputeFilter, "dispute.status": status };

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();

    res.render("backend/admin-disputes", {
      title: "Disputes",
      orders,
      selectedStatus: status,
    });
  } catch (e) {
    console.error("❌ admin disputes list:", e);
    return res.status(500).send("Server error");
  }
});


// POST /admin/disputes/:id/update
router.post("/:id/update", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notesAdmin, refundAmount } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send("Invalid order id");

    const allowed = ["UnderReview", "ApprovedRefund", "Rejected", "Resolved"];
    if (!allowed.includes(status)) return res.status(400).send("Invalid dispute status");

    const patch = {
      "dispute.status": status,
      "dispute.notesAdmin": notesAdmin || "",
      "dispute.updatedAt": new Date(),
    };

    if (status === "ApprovedRefund") {
      patch["dispute.refund.amount"] = Number(refundAmount || 0);
      patch["dispute.refund.currency"] = "QAR";
      patch["dispute.refund.method"] = "manual"; // upgrade later to myfatoorah
      patch["dispute.refund.refundedAt"] = new Date();
    }

    await Order.findByIdAndUpdate(id, { $set: patch });
    return res.redirect("/admin/disputes?status=" + encodeURIComponent(status));
  } catch (e) {
    console.error("❌ admin dispute update:", e);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
