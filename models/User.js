const mongoose = require("mongoose");
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      default: "",
      trim: true,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },
    
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      address: { type: String, default: "" },
      shortAddress: { type: String, default: "" },
    },

    role: {
      type: String,
      enum: ["admin", "driver", "support", "data_entry", "customer"],
      default: "customer",
    },
  },
  { timestamps: true }
);

// Keep username unique only if you really use it.
// sparse avoids duplicate-key errors for empty/missing usernames.
userSchema.index({ username: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", userSchema);