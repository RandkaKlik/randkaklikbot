const User = require("../models/User");
const { localize } = require("../utils/localization");
const { showProfileForMatching, findMatches } = require("../utils/profileUtil");
const { resetDailyLikes } = require("../services/userService");

async function handleCallbackQuery(query, bot) {
  const chatId = query.message.chat.id;
  let user = await User.findOne({ telegramId: chatId });

  switch (query.data) {
    case "activate_additional_likes":
      await handleActivateAdditionalLikes(user, chatId, query, bot);
      break;
    case "profile_approved":
      await handleProfileApproved(user, chatId, bot);
      break;
    case "profile_edit":
      await handleProfileEdit(user, chatId, bot);
      break;
    // Добавьте здесь обработчики для других callback_data
    default:
      await handleDefaultCallback(user, chatId, query, bot);
  }
  bot.answerCallbackQuery(query.id);
}

async function handleActivateAdditionalLikes(user, chatId, query, bot) {
  if (
    !user.premium &&
    user.dailyLikesGiven === 10 &&
    !user.additionalLikesUsed
  ) {
    user.additionalLikesUsed = true;
    await user.save();
    bot.answerCallbackQuery(query.id, {
      text: `Активировано 5 дополнительных лайков!`,
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
      text: "Вы уже использовали дополнительные лайки или не можете их активировать.",
    });
  }
}

async function handleProfileApproved(user, chatId, bot) {
  await bot.sendMessage(chatId, "Переход к просмотру анкет...", {
    reply_markup: {
      keyboard: [
        [{ text: "❤️" }, { text: "👎" }, { text: "💌" }, { text: "⛔" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
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
}

async function handleProfileEdit(user, chatId, bot) {
  await bot.sendMessage(chatId, localize(user.language, "age_question"));

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

async function handleDefaultCallback(user, chatId, query, bot) {
  // Обработка других callback_data
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
    await bot.sendMessage(
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
    await bot.sendMessage(chatId, localize(user.language, "age_question"));
  } else if (query.data === "gender_female" || query.data === "gender_male") {
    user.gender = query.data.split("_")[1];
    await user.save();
    await bot.sendMessage(chatId, localize(user.language, "looking_for"), {
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
    await bot.sendMessage(
      chatId,
      localize(user.language, "location_question"),
      {
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
      }
    );
  } else if (query.data === "start_profile_creation") {
    await bot.sendMessage(chatId, localize("pl", "language_selection"), {
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
}

module.exports = { handleCallbackQuery };
