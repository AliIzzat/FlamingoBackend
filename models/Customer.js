// models/Customer.js
const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  label: { type: String, default: "Home" },
  building: { type: String, required: true },
  floor: String,
  apartment: String,
  streetNumber: String,
  addressText: String,
  location: {
    lat: Number,
    lng: Number,
  },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const customerSchema = new mongoose.Schema(
  {
  name: String,
  phone: { type: String, required: true, unique: true, index: true },
  addresses: [addressSchema],
}, { timestamps: true });

module.exports = mongoose.model("Customer", customerSchema);

//   {
//     phone: {
//       type: String,
//       required: true,
//       unique: true,
//       trim: true,
//       index: true,
//     },
//     isVerified: {
//       type: Boolean,
//       default: false,
//     },
//     addresses: {
//       type: [
//         {
//           label: { type: String, default: "Home" },
//           addressText: { type: String, required: true },
//           location: {
//             lat: Number,
//             lng: Number,
//           },
//           streetNumber: String,
//           route: String,
//           zone: String,
//           city: String,
//           country: String,
//           isDefault: { type: Boolean, default: false },
//         },
//       ],
//       default: [],
//     },
//     streetNumber: { 
//       type: String, 
//       default: "",
//      },
//     route: { 
//       type: String, 
//       default: "",
//      },
//     zone: { 
//       type: String, 
//       default: "",
//      },
//     city: { 
//       type: String, 
//       default: "",
//      },
//     country: { 
//       type: String, 
//       default: "",
//      },
//     },
//   { timestamps: true }
// );

// module.exports = mongoose.model('Customer', CustomerSchema);