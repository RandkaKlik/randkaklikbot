const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  telegramId: { type: Number, unique: true },
  language: {
    type: String,
    enum: ["pl", "ru", "ua", "en"],
  },
  age: { type: Number, min: 17, max: 100 },
  gender: {
    type: String,
    enum: ["male", "female"],
  },
  interestedIn: [
    {
      type: String,
      enum: ["male", "female"],
    },
  ],
  city: { type: String },
  location: {
    type: { type: String, default: "Point" },
    coordinates: [Number],
  },
  name: { type: String },
  about: { type: String },
  photoUrl: { type: String },
  premium: { type: Boolean, default: false },
  likesGiven: [{ type: String }],
  dislikesGiven: [{ type: String }],
  likesReceived: [{ type: String }],
  registrationDate: { type: Date, default: Date.now },
  subscriptionStatus: { type: String, default: "free" },
  views: { type: Number, default: 0 },
  lastLikeBoost: { type: Date },
});

UserSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("User", UserSchema);
