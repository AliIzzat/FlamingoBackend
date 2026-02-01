const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  username: String,
  email: { type: String, default:""},
  mobile: String,
  password: String,
  role: {
    type: String,
    enum: ['admin', 'driver', 'support', 'data_entry','customer'], // ✅ Updated roles
    default: 'customer' // Or set a different default
  },
  name: String
});
userSchema.index({ username: 1 }, { unique: true });
module.exports = mongoose.model('User', userSchema);