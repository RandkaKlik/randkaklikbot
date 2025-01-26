const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AdvertisementSchema = new Schema({
  title: { type: String, required: true },
  imageUrl: { String }, // URL для изображения, если есть
  text: { type: String, required: true },
  link: { type: String, required: true }, // Ссылка на сообщество или сайт
  active: { type: Boolean, default: true }, // Флаг для управления активностью рекламы
});

module.exports = mongoose.model("Advertisement", AdvertisementSchema);
