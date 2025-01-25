require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const User = require("./models/User");
const connectDB = require("./config/db");
const axios = require("axios");
const {
  addLike,
  resetDailyLikes,
  checkForNewMatch,
} = require("./services/userService");

// Загрузка локализации
const locales = {
  pl: require("./locales/pl.json"),
  ru: require("./locales/ru.json"),
  ua: require("./locales/ua.json"),
  en: require("./locales/en.json"),
};

const dailyLikeLimit = 10;
const premiumDailyLikeLimit = 25;
const additionalLikes = 5;

function localize(language, key) {
  return locales[language][key] || locales["pl"][key] || key;
}

// Функция для обновления URL фотографии
async function getUpdatedPhotoUrl(fileId) {
  try {
    const fileInfo = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    console.log("Updated photo URL:", photoUrl);
    return photoUrl;
  } catch (error) {
    console.error("Error updating photo URL:", error);
    return null;
  }
}

async function showProfileForMatching(chatId, user, match, bot) {
  let profileText = ``;
  profileText += `**${match.name}**\n`;
  profileText += `${localize(user.language, "age")}: ${match.age}\n`;
  profileText += `${localize(user.language, "location")}: ${match.city}\n`;
  profileText += `${localize(user.language, "about")}: ${
    match.about || localize(user.language, "not_provided")
  }`;

  try {
    if (match.photoUrl) {
      let photoToSend = match.photoUrl;
      if (!match.photoUrl.startsWith("http")) {
        photoToSend = match.photoUrl;
      } else {
        const updatedUrl = await getUpdatedPhotoUrl(match.photoUrl);
        photoToSend = updatedUrl || match.photoUrl;
      }
      console.log("Attempting to send photo:", photoToSend);
      await bot.sendPhoto(chatId, photoToSend, {
        caption: profileText,
        parse_mode: "Markdown",
      });
    } else {
      await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });
    }

    await bot.sendMessage(chatId, "Выберите действие:", {
      reply_markup: {
        keyboard: [
          [{ text: "❤️" }, { text: "👎" }, { text: "💌" }, { text: "⛔" }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  } catch (error) {
    console.error("Failed to send photo:", error);
    await bot.sendMessage(
      chatId,
      "Не удалось отправить фотографию. Вот информация о другом профиле:",
      { parse_mode: "Markdown" }
    );
    await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });

    await bot.sendMessage(chatId, "Выберите действие:", {
      reply_markup: {
        keyboard: [
          [{ text: "❤️" }, { text: "👎" }, { text: "💌" }, { text: "⛔" }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  }
}

async function findMatches(user) {
  console.log("User location:", user.location);
  console.log("User interestedIn:", user.interestedIn);
  console.log("User gender:", user.gender);

  const maxDistance = 100 * 1000;
  const query = {
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: user.location.coordinates || [0, 0],
        },
        $maxDistance: maxDistance,
      },
    },
    gender: { $in: user.interestedIn },
    interestedIn: user.gender,
    _id: { $nin: [...user.likesGiven, ...user.dislikesGiven, user._id] },
  };

  console.log("Match query:", query);

  const matches = await User.find(query).limit(10);
  console.log(`Found matches count: ${matches.length}`);
  return matches;
}

async function createCustomKeyboard() {
  return {
    keyboard: [
      [{ text: "❤️" }, { text: "👎" }, { text: "💌" }, { text: "⛔" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

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

connectDB()
  .then(() => {
    console.log("Database connection established");

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
            try {
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
            } catch (error) {
              console.error("Failed to send photo using file_id:", error);

              try {
                const updatedUrl = await getUpdatedPhotoUrl(photoToSend);
                if (updatedUrl) {
                  await bot.sendPhoto(chatId, updatedUrl, {
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
                  throw new Error("Failed to update photo URL");
                }
              } catch (urlUpdateError) {
                console.error("Failed to update photo URL:", urlUpdateError);

                await bot.sendMessage(
                  chatId,
                  "Не удалось отправить фотографию. Вот информация о профиле:",
                  { parse_mode: "Markdown" }
                );
                await bot.sendMessage(chatId, profileText, {
                  parse_mode: "Markdown",
                });
              }
            }
          } else {
            await bot.sendMessage(chatId, profileText, {
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

    bot.onText(/\/myprofile/, async (msg) => {
      console.log("Команда /myprofile получена");
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
            let photoToSend = user.photoUrl.startsWith("http")
              ? user.photoUrl
              : user.photoUrl;
            try {
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
            } catch (error) {
              console.error("Failed to send photo using file_id:", error);

              try {
                const updatedUrl = await getUpdatedPhotoUrl(user.photoUrl);
                if (updatedUrl) {
                  await bot.sendPhoto(chatId, updatedUrl, {
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
                  throw new Error("Failed to update photo URL");
                }
              } catch (urlUpdateError) {
                console.error("Failed to update photo URL:", urlUpdateError);

                await bot.sendMessage(
                  chatId,
                  "Не удалось отправить фотографию. Вот информация о профиле:",
                  { parse_mode: "Markdown" }
                );
                await bot.sendMessage(chatId, profileText, {
                  parse_mode: "Markdown",
                });
              }
            }
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
        bot.sendMessage(chatId, localize("pl", "profile_not_found"), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: localize("pl", "create_profile"),
                  callback_data: "start_profile_creation",
                },
              ],
            ],
          },
        });
      }
    });

    bot.on("callback_query", async (query) => {
      const chatId = query.message.chat.id;
      let user = await User.findOne({ telegramId: chatId });

      if (query.data === "activate_additional_likes") {
        console.log(
          "Activate additional likes clicked. User state:",
          user.dailyLikesGiven,
          user.additionalLikesUsed
        );
        if (
          !user.premium &&
          user.dailyLikesGiven === dailyLikeLimit &&
          !user.additionalLikesUsed
        ) {
          console.log("Conditions met for additional likes.");
          user.additionalLikesUsed = true; // Устанавливаем флаг, что дополнительные лайки были использованы
          await user.save();

          bot.answerCallbackQuery(query.id, {
            text: `Активировано ${additionalLikes} дополнительных лайков!`,
          });

          const matches = await findMatches(user);
          if (matches.length > 0) {
            await showProfileForMatching(chatId, user, matches[0], bot);
          } else {
            await bot.sendMessage(
              chatId,
              "Пока что анкеты закончились. Попробуйте зайти позже."
            );
          }
        } else {
          console.log("Conditions not met for additional likes.");
          bot.answerCallbackQuery(query.id, {
            text: "Вы уже использовали дополнительные лайки или не можете их активировать.",
          });
        }
      }

      if (query.data === "increase_likes") {
        const now = new Date();
        const startOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );

        if (!user.lastLikeDate || user.lastLikeDate < startOfDay) {
          await resetDailyLikes(user._id);
          user.additionalLikesUsed = false;
          await user.save();
          user = await User.findOne({ telegramId: chatId });
        }

        if (
          !user.additionalLikesUsed &&
          user.dailyLikesGiven < dailyLikeLimit + additionalLikes
        ) {
          user.dailyLikesGiven = Math.min(
            user.dailyLikesGiven + additionalLikes,
            user.premium
              ? premiumDailyLikeLimit
              : dailyLikeLimit + additionalLikes
          );
          user.additionalLikesUsed = true;
          await user.save();
          bot.answerCallbackQuery(query.id, {
            text: `Лимит лайков увеличен на ${additionalLikes}!`,
          });

          const matches = await findMatches(user);
          if (matches.length > 0) {
            await showProfileForMatching(chatId, user, matches[0], bot);
          } else {
            await bot.sendMessage(
              chatId,
              "Пока что анкеты закончились. Попробуйте зайти позже."
            );
          }
        } else {
          bot.answerCallbackQuery(query.id, {
            text: user.additionalLikesUsed
              ? "Вы уже использовали дополнительные лайки на сегодня. Для увеличения лимита возьмите премиум."
              : "Вы уже получили максимальное количество лайков на сегодня.",
          });
        }
      }

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
        const interest = query.data.split("_")[1];
        user.interestedIn = [interest];

        if (query.data === "interested_both") {
          user.interestedIn = ["male", "female"];
        }

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
        await bot.sendMessage(chatId, "Переход к просмотру анкет...", {
          reply_markup: createCustomKeyboard(),
        });

        const matches = await findMatches(user);
        console.log(`Matches count: ${matches.length}`);
        if (matches.length > 0) {
          await showProfileForMatching(chatId, user, matches[0], bot);
        } else {
          await bot.sendMessage(
            chatId,
            "Пока что анкеты закончились. Попробуйте зайти позже."
          );
        }
      } else if (query.data === "profile_edit") {
        bot.sendMessage(chatId, localize(user.language, "age_question"));

        user.age = undefined;
        user.gender = undefined;
        user.interestedIn = undefined;
        user.city = undefined;
        user.location = { type: "Point", coordinates: [0, 0] };
        user.name = undefined;
        user.about = undefined;
        user.photoUrl = undefined;
        await user.save();
      } else if (query.data === "start_profile_creation") {
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
      if (msg.text === "❤️") {
        const now = new Date();
        const startOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        let user = await User.findOne({ telegramId: chatId });

        if (!user.lastLikeDate || user.lastLikeDate < startOfDay) {
          await resetDailyLikes(user._id);
          user = await User.findOne({ telegramId: chatId }); // Обновляем пользователя после сброса лайков
        }

        // Определяем текущий лимит с учетом дополнительных лайков
        const currentLimit =
          dailyLikeLimit + (user.additionalLikesUsed ? additionalLikes : 0);

        if (user.premium && user.dailyLikesGiven >= premiumDailyLikeLimit) {
          await bot.sendMessage(
            chatId,
            "Вы достигли лимита лайков. Для увеличения лимита возьмите премиум."
          );
          return;
        } else if (!user.premium && user.dailyLikesGiven >= currentLimit) {
          if (!user.additionalLikesUsed) {
            await bot.sendMessage(
              chatId,
              "Вы достигли лимита лайков. Перейдите на страницу Илона Маска для получения дополнительных лайков:",
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Перейти на X Илона Маска",
                        url: "https://x.com/elonmusk",
                      },
                    ],
                  ],
                },
              }
            );

            await bot.sendMessage(
              chatId,
              "Подтвердите переход, чтобы активировать дополнительные лайки:",
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Активировать дополнительные лайки",
                        callback_data: "activate_additional_likes",
                      },
                    ],
                  ],
                },
              }
            );
            return;
          } else {
            await bot.sendMessage(
              chatId,
              "Вы достигли лимита лайков. Для увеличения лимита возьмите премиум."
            );
            return;
          }
        }

        // Логика лайка, если лимит не достигнут
        const matches = await findMatches(user);
        if (matches.length > 0) {
          const currentMatch = matches[0];
          await addLike(user._id, currentMatch._id);
          await bot.sendMessage(
            chatId,
            `Пользователь лайкнут. Осталось лайков: ${
              user.premium
                ? premiumDailyLikeLimit - user.dailyLikesGiven - 1
                : currentLimit - user.dailyLikesGiven - 1
            }`,
            {
              reply_markup: createCustomKeyboard(),
            }
          );
          // Показать следующую анкету, если она есть
          matches.shift(); // Удаляем текущую анкету из списка
          if (matches.length > 0) {
            await showProfileForMatching(chatId, user, matches[0], bot);
          } else {
            await bot.sendMessage(
              chatId,
              "Больше анкет нет. Попробуйте зайти позже."
            );
          }
        }
      } else if (msg.text === "👎") {
        if (!user.dislikesGiven) user.dislikesGiven = [];
        const matches = await findMatches(user);
        if (matches.length > 0) {
          const currentMatch = matches[0];
          user.dislikesGiven.push(currentMatch._id.toString());
          await user.save();

          matches.shift();
          if (matches.length > 0) {
            await showProfileForMatching(chatId, user, matches[0], bot);
          } else {
            await bot.sendMessage(
              chatId,
              "Больше анкет нет. Попробуйте зайти позже."
            );
          }
        }
      } else if (msg.text === "⛔") {
        await bot.sendMessage(chatId, "Остановка просмотра анкет.", {
          reply_markup: { remove_keyboard: true },
        });
        await myProfileCommand(msg, bot);
      } else if (msg.text === "💌") {
        await bot.sendMessage(chatId, "Функционал '💌' будет добавлен позже.");
      }
    });
  })
  .catch((err) => console.error("Failed to connect to database:", err));
