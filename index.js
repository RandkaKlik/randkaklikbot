require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const User = require("./models/User");
const connectDB = require("./config/db");
const axios = require("axios"); // Убедитесь, что axios установлен

// Загрузка локализации
const locales = {
  pl: require("./locales/pl.json"),
  ru: require("./locales/ru.json"),
  ua: require("./locales/ua.json"),
  en: require("./locales/en.json"),
};

// Функция для получения перевода на нужный язык
function localize(language, key) {
  return locales[language][key] || locales["pl"][key] || key;
}

// Функция для обновления URL фотографии
async function getUpdatedPhotoUrl(fileId) {
  try {
    const fileInfo = await bot.getFile(fileId);
    return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
  } catch (error) {
    console.error("Error updating photo URL:", error);
    return null;
  }
}

// Функция для обратного геокодирования
async function reverseGeocode(latitude, longitude) {
  try {
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          lat: latitude,
          lon: longitude,
          format: "json",
        },
      }
    );

    if (response.data && response.data.address) {
      return (
        response.data.address.city ||
        response.data.address.town ||
        "Unknown City"
      );
    }
    return "Unknown City";
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return "Unknown City";
  }
}

// Подключаемся к базе данных и после успешного подключения запускаем бота
connectDB()
  .then(() => {
    console.log("Database connection established");

    // Основная логика бота начинается здесь
    bot.onText(/\/start/, async (msg) => {
      console.log("Команда /start получена");
      const chatId = msg.chat.id;
      const user = await User.findOne({ telegramId: chatId });

      if (user) {
        let profileText = `${localize(user.language, "profile_preview")}\n\n`;
        profileText += `**${user.name}**\n`;
        profileText += `${localize(user.language, "age")}: ${user.age}\n`;
        profileText += `${localize(user.language, "location")}: ${user.city}\n`;
        profileText += `${localize(user.language, "about")}: ${
          user.about || localize(user.language, "not_provided")
        }`;

        try {
          if (user.photoUrl) {
            let photoToSend = user.photoUrl;
            if (!user.photoUrl.startsWith("http")) {
              const updatedUrl = await getUpdatedPhotoUrl(user.photoUrl);
              if (updatedUrl) {
                photoToSend = updatedUrl;
              } else {
                photoToSend = user.photoUrl;
              }
            }
            await bot.sendPhoto(chatId, photoToSend, {
              caption: profileText,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: localize(user.language, "yes"),
                      callback_data: "profile_approved",
                    },
                  ],
                  [
                    {
                      text: localize(user.language, "no"),
                      callback_data: "profile_edit",
                    },
                  ],
                ],
              },
            });
          } else {
            await bot.sendMessage(chatId, profileText, {
              parse_mode: "Markdown",
            });
          }
        } catch (error) {
          console.error("Failed to send photo:", error);
          await bot.sendMessage(
            chatId,
            "Не удалось отправить фотографию. Вот информация о профиле:",
            { parse_mode: "Markdown" }
          );
          await bot.sendMessage(chatId, profileText, {
            parse_mode: "Markdown",
          });
        }
      } else {
        bot.sendMessage(chatId, localize("pl", "language_selection"), {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Polski", callback_data: "pl" }],
              [{ text: "Русский", callback_data: "ru" }],
              [{ text: "Українська", callback_data: "ua" }],
              [{ text: "English", callback_data: "en" }],
            ],
          },
        });
      }
    });

    bot.on("callback_query", async (query) => {
      const chatId = query.message.chat.id;
      let user = await User.findOne({ telegramId: chatId });

      if (["pl", "ru", "ua", "en"].includes(query.data)) {
        if (!user) {
          user = await User.create({
            telegramId: chatId,
            language: query.data,
            location: {
              type: "Point",
              coordinates: [0, 0],
            },
          });
        } else {
          user.language = query.data;
          await user.save();
        }
        bot.sendMessage(
          chatId,
          `${localize(query.data, "welcome")}\n\n${localize(
            query.data,
            "privacy_policy"
          )}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: localize(query.data, "agree"),
                    callback_data: "agree_privacy",
                  },
                ],
              ],
            },
          }
        );
      } else if (query.data === "agree_privacy") {
        bot.sendMessage(chatId, localize(user.language, "age_question"));
      } else if (
        query.data === "gender_female" ||
        query.data === "gender_male"
      ) {
        user.gender = query.data.split("_")[1];
        await user.save();
        bot.sendMessage(chatId, localize(user.language, "looking_for"), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: localize(user.language, "female"),
                  callback_data: "interested_female",
                },
              ],
              [
                {
                  text: localize(user.language, "male"),
                  callback_data: "interested_male",
                },
              ],
              [
                {
                  text: localize(user.language, "both"),
                  callback_data: "interested_both",
                },
              ],
            ],
          },
        });
      } else if (query.data.startsWith("interested_")) {
        user.interestedIn = query.data.split("_")[1];
        await user.save();
        bot.sendMessage(chatId, localize(user.language, "location_question"), {
          reply_markup: {
            keyboard: [
              [
                {
                  text: localize(user.language, "share_location"),
                  request_location: true,
                },
              ],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
      } else if (query.data === "profile_approved") {
        bot.sendMessage(chatId, "Переход к просмотру анкет...");
      } else if (query.data === "profile_edit") {
        // Начнем процесс редактирования профиля с вопроса о возрасте
        bot.sendMessage(chatId, localize(user.language, "age_question"));
        // Сбросим все данные профиля, кроме telegramId и language
        user.age = undefined;
        user.gender = undefined;
        user.interestedIn = undefined;
        user.city = undefined;
        user.location = { type: "Point", coordinates: [0, 0] };
        user.name = undefined;
        user.about = undefined;
        user.photoUrl = undefined;
        await user.save();
      }
      bot.answerCallbackQuery(query.id);
    });

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      let user = await User.findOne({ telegramId: chatId });

      if (!user) return;

      if (msg.text && !isNaN(Number(msg.text)) && Number(msg.text) >= 17) {
        user.age = Number(msg.text);
        await user.save();
        bot.sendMessage(chatId, localize(user.language, "gender_question"), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: localize(user.language, "female"),
                  callback_data: "gender_female",
                },
              ],
              [
                {
                  text: localize(user.language, "male"),
                  callback_data: "gender_male",
                },
              ],
            ],
          },
        });
      } else if (msg.text && Number(msg.text) < 17) {
        bot.sendMessage(chatId, localize(user.language, "age_too_young"));
      } else if (msg.text && user.gender && user.interestedIn && !user.name) {
        user.name = msg.text || user.firstName || msg.from.first_name || "User";
        await user.save();
        bot.sendMessage(chatId, localize(user.language, "about_question"));
      } else if (msg.text && !user.about) {
        user.about = msg.text;
        await user.save();
        bot.sendMessage(chatId, localize(user.language, "photo_request"));
      } else if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        user.photoUrl = photo.file_id;
        await user.save();

        let profileText = `${localize(user.language, "profile_preview")}\n\n`;
        profileText += `**${user.name}**\n`;
        profileText += `${localize(user.language, "age")}: ${user.age}\n`;
        profileText += `${localize(user.language, "location")}: ${user.city}\n`;
        profileText += `${localize(user.language, "about")}: ${
          user.about || localize(user.language, "not_provided")
        }`;

        try {
          await bot.sendPhoto(chatId, user.photoUrl, {
            caption: profileText,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: localize(user.language, "yes"),
                    callback_data: "profile_approved",
                  },
                ],
                [
                  {
                    text: localize(user.language, "no"),
                    callback_data: "profile_edit",
                  },
                ],
              ],
            },
          });
        } catch (error) {
          console.error("Failed to send photo:", error);
          await bot.sendMessage(
            chatId,
            "Не удалось отправить фотографию. Вот информация о профиле:",
            { parse_mode: "Markdown" }
          );
          await bot.sendMessage(chatId, profileText, {
            parse_mode: "Markdown",
          });
        }
      } else if (msg.location) {
        const city = await reverseGeocode(
          msg.location.latitude,
          msg.location.longitude
        );
        user.city = city;
        user.location = {
          type: "Point",
          coordinates: [msg.location.longitude, msg.location.latitude],
        };
        await user.save();
        bot.sendMessage(chatId, localize(user.language, "name_question"));
      }
    });
  })
  .catch((err) => console.error("Failed to connect to database:", err));
