const User = require("../models/User");
const { localize } = require("../utils/localization");
const { reverseGeocode } = require("../utils/locationUtil");
const { addLike, resetDailyLikes } = require("../services/userService");
const { showProfileForMatching, findMatches } = require("../utils/profileUtil");

async function handleMessage(msg, bot) {
  const chatId = msg.chat.id;
  let user = await User.findOne({ telegramId: chatId });

  if (!user) return;

  if (msg.text && !isNaN(Number(msg.text)) && Number(msg.text) >= 17) {
    user.age = Number(msg.text);
    await user.save();
    await bot.sendMessage(chatId, localize(user.language, "gender_question"), {
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
    await bot.sendMessage(chatId, localize(user.language, "age_too_young"));
  } else if (msg.text && user.gender && user.interestedIn && !user.name) {
    user.name = msg.text || user.firstName || msg.from.first_name || "User";
    await user.save();
    await bot.sendMessage(chatId, localize(user.language, "about_question"));
  } else if (msg.text && !user.about) {
    user.about = msg.text;
    await user.save();
    await bot.sendMessage(chatId, localize(user.language, "photo_request"));
  } else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    user.photoUrl = photo.file_id;
    await user.save();
    let profileText = `${localize(user.language, "profile_preview")}\n\n**${
      user.name
    }**\n${localize(user.language, "age")}: ${user.age}\n${localize(
      user.language,
      "location"
    )}: ${user.city}\n${localize(user.language, "about")}: ${
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
      await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });
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
    await bot.sendMessage(chatId, localize(user.language, "name_question"));
  } else if (msg.text === "❤️") {
    await handleLike(chatId, user, bot);
  } else if (msg.text === "👎") {
    await handleDislike(chatId, user, bot);
  } else if (msg.text === "⛔") {
    await bot.sendMessage(chatId, "Остановка просмотра анкет.", {
      reply_markup: { remove_keyboard: true },
    });
    await handleStop(chatId, bot);
  } else if (msg.text === "💌") {
    await bot.sendMessage(chatId, "Функционал '💌' будет добавлен позже.");
  }
}

async function handleLike(chatId, user, bot) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (!user.lastLikeDate || user.lastLikeDate < startOfDay) {
    await resetDailyLikes(user._id);
    user = await User.findOne({ telegramId: chatId });
  }

  const currentLimit = 10 + (user.additionalLikesUsed ? 5 : 0);

  if (user.premium && user.dailyLikesGiven >= 25) {
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

  const matches = await findMatches(user);
  if (matches.length > 0) {
    const currentMatch = matches[0];
    await addLike(user._id, currentMatch._id);
    await bot.sendMessage(
      chatId,
      `Пользователь лайкнут. Осталось лайков: ${
        user.premium
          ? 25 - user.dailyLikesGiven - 1
          : currentLimit - user.dailyLikesGiven - 1
      }`,
      {
        reply_markup: {
          keyboard: [
            [{ text: "❤️" }, { text: "👎" }, { text: "💌" }, { text: "⛔" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      }
    );
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
}

async function handleDislike(chatId, user, bot) {
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
}

async function handleStop(chatId, bot) {
  // Здесь должна быть логика для обработки команды 'Стоп'
  // Сейчас это просто заглушка, так как в оригинале используется неопределенная функция myProfileCommand
  await bot.sendMessage(chatId, "Вы вернулись к просмотру вашего профиля.");
}

module.exports = { handleMessage };
