const mongoose = require("mongoose");

const CarouselSlideSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
    mediaUrl: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      default: "",
      trim: true,
    },
    titleAr: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    buttonText: {
      type: String,
      default: "",
      trim: true,
    },
    actionType: {
      type: String,
      enum: ["none", "link", "navigate"],
      default: "none",
    },
    actionValue: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CarouselSlide", CarouselSlideSchema);