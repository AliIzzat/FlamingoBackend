// models/Order.js
const mongoose = require("mongoose");
const OrderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
      index: true,
    },
    category: { type: String, required: true, index: true },
    name_snapshot: { type: String, required: true },
    price_snapshot: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    image_snapshot: { type: String, default: "" },
  },
  { _id: false }
);
const OrderSchema = new mongoose.Schema(
  {
    customer: {
      name: { type: String, required: true },
      phone: { type: String, required: true, index: true },
      addressText: { type: String, required: true },
      location: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },
    pickup: {
      storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Store",
        default: null,
        index: true,
      },
      addressText: { type: String, default: "" },
      location: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },
    items: { type: [OrderItemSchema], default: [] },
    totals: {
      subtotal: { type: Number, default: 0 },
      deliveryFee: { type: Number, default: 0 },
      total: { type: Number, default: 0, index: true },
    },
    payment: {
      method: {
        type: String,
        enum: ["myfatoorah", "cash"],
        default: "myfatoorah",
        index: true,
      },
      status: {
        type: String,
        enum: ["unpaid", "paid", "failed"],
        default: "unpaid",
        index: true,
      },
      invoiceId: { type: String, default: "" },
      paymentId: { type: String, default: "" },
    },
    // ✅ This is your real "order status" section
    delivery: {
      status: {
        type: String,
        enum: ["Pending", "Claimed", "PickedUp", "Delivered", "Cancelled"],
        default: "Pending",
        index: true,
      },
      assignedDriverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },
      claimedAt: { type: Date, default: null },
      pickedUpAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
    },
    dispute: {
      status: {
        type: String,
        enum: ["None", "Open", "UnderReview", "ApprovedRefund", "Rejected", "Resolved"],
        default: "None",
        index: true,
      },
      reason: { type: String, default: "" },
      notesCustomer: { type: String, default: "" },
      notesAdmin: { type: String, default: "" },
      createdAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
      refund: {
        amount: { type: Number, default: 0 },
        currency: { type: String, default: "QAR" },
        method: { type: String, default: "" },
        refundId: { type: String, default: "" },
        refundedAt: { type: Date, default: null },
      },
    },
  },
  { timestamps: true }
);
// ✅ Helpful compound index for your "available/unpicked orders" page
OrderSchema.index({ "delivery.status": 1, "delivery.assignedDriverId": 1, createdAt: -1 });
const { DELIVERY_FEE } = require("../config/pricing");
OrderSchema.pre("save", function (next) {
  if (!this.totals) this.totals = { subtotal: 0, deliveryFee: 0, total: 0 };
  // Force fixed fee
  this.totals.deliveryFee = DELIVERY_FEE;
  // Ensure subtotal exists
  const subtotal = Number(this.totals.subtotal || 0);
  this.totals.subtotal = subtotal;
  // Recalculate total
  this.totals.total = subtotal + DELIVERY_FEE;

  next();
});
module.exports = mongoose.model("Order", OrderSchema);
