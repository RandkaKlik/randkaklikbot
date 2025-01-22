require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const User = require("./models/User");
const connectDB = require("./config/db");
const axios = require("axios");

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
    const photoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    console.log("Updated photo URL:", photoUrl); // Добавлено логирование для отладки
    return photoUrl;
  } catch (error) {
    console.error("Error updating photo URL:", error);
    return null;
  }
}

async function showProfileForMatching(chatId, user, match, bot) {
  let profileText = ``; // Удалено упоминание "profile_preview"
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
        // Используем file_id напрямую
        photoToSend = match.photoUrl;
      } else {
        // Если это URL, пробуем обновить
        const updatedUrl = await getUpdatedPhotoUrl(match.photoUrl);
        photoToSend = updatedUrl || match.photoUrl; // Используем file_id, если обновление URL не удалось
      }
      console.log("Attempting to send photo:", photoToSend);
      await bot.sendPhoto(chatId, photoToSend, {
        caption: profileText,
        parse_mode: "Markdown",
      });
    } else {
      await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });
    }

    // Отправляем клавиатуру после фото или текста
    await bot.sendMessage(chatId, "Выберите действие:", {
      reply_markup: {
        keyboard: [
          [{ text: "Лайк" }, { text: "Дизлайк" }],
          [{ text: "Написать" }, { text: "Стоп" }],
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
    // Отправляем клавиатуру даже если фото не удалось отправить
    await bot.sendMessage(chatId, "Выберите действие:", {
      reply_markup: {
        keyboard: [
          [{ text: "Лайк" }, { text: "Дизлайк" }],
          [{ text: "Написать" }, { text: "Стоп" }],
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
          coordinates: user.location.coordinates || [0, 0], // Проверка на наличие координат
        },
        $maxDistance: maxDistance,
      },
    },
    gender: { $in: user.interestedIn },
    interestedIn: user.gender,
    _id: { $nin: [...user.likesGiven, ...user.dislikesGiven, user._id] },
  };

  console.log("Match query:", query); // Логирование запроса для отладки

  const matches = await User.find(query).limit(10);
  console.log(`Found matches count: ${matches.length}`);
  return matches;
}

async function createCustomKeyboard() {
  return {
    keyboard: [
      [{ text: "Лайк" }, { text: "Дизлайк" }],
      [{ text: "Написать" }, { text: "Стоп" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
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
              // Попробуем получить новый URL
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
                // Отправляем только текст, если и с URL не получилось
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
            // Если нет фото, отправляем только текст
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
          // В случае ошибки, отправляем только текст профиля
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
              : user.photoUrl; // Используем file_id напрямую, если это не URL
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
              // Попробуем обновить URL
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
                // Отправляем только текст, если и с URL не получилось
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
        // Если пользователь не найден, предложите начать с создания анкеты
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
        user.interestedIn = [interest]; // Начинаем с массива с одним элементом

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
        // Показать кастомную клавиатуру
        await bot.sendMessage(chatId, "Переход к просмотру анкет...", {
          reply_markup: createCustomKeyboard(),
        });

        const matches = await findMatches(user);
        console.log(`Matches count: ${matches.length}`); // Логирование количества найденных анкет
        if (matches.length > 0) {
          await showProfileForMatching(chatId, user, matches[0], bot);
        } else {
          await bot.sendMessage(
            chatId,
            "Пока что анкеты закончились. Попробуйте зайти позже."
          );
          // Здесь можно добавить логику для расширения радиуса поиска или уведомления о новых анкетах
        }
      } else if (query.data === "profile_edit") {
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
      if (msg.text === "Лайк") {
        if (!user.likesGiven) user.likesGiven = [];
        if (
          !user.premium &&
          user.likesGiven.length >= (user.lastLikeBoost ? 15 : 10)
        ) {
          await bot.sendMessage(
            chatId,
            "Вы достигли лимита лайков. Хотите получить еще 5 лайков?",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Перейти на Instagram", url: "YOUR_INSTAGRAM_URL" }],
                ],
              },
            }
          );
          return;
        }

        const matches = await findMatches(user);
        if (matches.length > 0) {
          const currentMatch = matches[0]; // Предполагаем, что показываем первую анкету из списка
          user.likesGiven.push(currentMatch._id.toString());
          user.lastLikeBoost = user.lastLikeBoost || null; // Убедимся, что поле существует
          await user.save();
          await bot.sendMessage(chatId, "Пользователь лайкнут", {
            reply_markup: createCustomKeyboard(),
          });
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
      } else if (msg.text === "Дизлайк") {
        // Похожий подход для дизлайка
        if (!user.dislikesGiven) user.dislikesGiven = [];
        const matches = await findMatches(user);
        if (matches.length > 0) {
          const currentMatch = matches[0];
          user.dislikesGiven.push(currentMatch._id.toString());
          await user.save();
          // Показать следующую анкету, если она есть
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
      } else if (msg.text === "Стоп") {
        await bot.sendMessage(chatId, "Остановка просмотра анкет.", {
          reply_markup: { remove_keyboard: true },
        });
        await myProfileCommand(msg, bot); // Используем существующую функцию для показа профиля пользователя
      } else if (msg.text === "Написать") {
        // Пока просто кнопка без функционала
        await bot.sendMessage(
          chatId,
          "Функционал 'Написать' будет добавлен позже."
        );
      }
    });
  })
  .catch((err) => console.error("Failed to connect to database:", err));
