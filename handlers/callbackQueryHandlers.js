const User = require("../models/User");
const { localize } = require("../utils/localization");
const { showProfileForMatching, findMatches } = require("../utils/profileUtil");
const commandHandlers = require("./commandHandlers");

async function handleCallbackQuery(query, bot) {
  const chatId = query.message.chat.id;
  let user = await User.findOne({ telegramId: chatId });

  if (
    !user &&
    !["start_profile_creation", "pl", "ru", "ua", "en"].includes(query.data)
  ) {
    await bot.sendMessage(chatId, localize("pl", "profile_not_found"), {
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
    return;
  }

  switch (query.data) {
    case query.data === "stop_conversation":
    case query.data.startsWith("stop_conversation_"):
      await handleStopConversation(
        user,
        query.data.split("_")[2] || null,
        chatId,
        bot
      );
      break;
    case "send_message_yes":
      await handleSendMessageConfirmation(user, chatId, bot);
      break;
    case "send_message_no":
      await commandHandlers.handleMyProfile({ chat: { id: chatId } }, bot);
      break;
    case "return_to_profile":
      await commandHandlers.handleMyProfile({ chat: { id: chatId } }, bot);
      break;
    case "delete_profile":
      await handleDeleteProfileConfirmation(chatId, bot);
      break;
    case "confirm_delete":
      await handleProfileDeletion(chatId, user, bot);
      break;
    case "cancel_delete":
      await commandHandlers.handleMyProfile({ chat: { id: chatId } }, bot);
      break;
    case "activate_additional_likes":
      await handleActivateAdditionalLikes(user, chatId, query, bot);
      break;
    case "profile_approved":
      await handleProfileApproved(user, chatId, bot);
      break;
    case "profile_edit":
      await handleProfileEdit(user, chatId, bot);
      break;
    case "stop_chat":
      await handleStopChat(chatId, user, bot);
      break;
    default:
      if (query.data.startsWith("stop_conversation_")) {
        const otherUserId = query.data.split("_")[2];
        await handleStopConversation(user, otherUserId, chatId, bot);
      } else if (query.data.startsWith("start_chat_")) {
        await handleStartChat(user, query.data.split("_")[2], bot);
      } else {
        await handleDefaultCallback(user, chatId, query, bot);
      }
  }
  bot.answerCallbackQuery(query.id);
}

async function findCurrentMatch(user) {
  const matches = await findMatches(user);
  if (matches.length > 0) {
    // Возвращаем последний матч, предполагая, что это текущий просматриваемый профиль
    return matches[0];
  }
  return null;
}

async function handleDeleteProfileConfirmation(chatId, bot) {
  await bot.sendMessage(chatId, "Вы уверены, что хотите удалить профиль?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "ДА", callback_data: "confirm_delete" }],
        [{ text: "НЕТ", callback_data: "cancel_delete" }],
      ],
    },
  });
}

async function handleProfileDeletion(chatId, user, bot) {
  try {
    // Удаление всех упоминаний пользователя
    await User.updateMany(
      {},
      {
        $pull: {
          likesReceived: user._id,
          matches: user._id,
          endedChats: user._id,
        },
      }
    );

    // Удаление самого пользователя
    await User.findByIdAndDelete(user._id);

    await bot.sendMessage(
      chatId,
      "Жаль, что вы решили нас покинуть. Если решите вернуться, нажмите /start"
    );
  } catch (error) {
    console.error("Error deleting profile:", error);
    await bot.sendMessage(
      chatId,
      "Ошибка при удалении профиля. Попробуйте еще раз."
    );
  }
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
  user.photoUrl = no_photo.jpg;
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
async function handleSendMessageConfirmation(user, chatId, bot) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!user.lastMessageDate || user.lastMessageDate < startOfDay) {
    await User.findByIdAndUpdate(user._id, { lastMessageDate: now });
    const match = await findCurrentMatch(user);
    if (match) {
      const chatButton = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Начать чат",
                url: `tg://user?id=${match.telegramId}`,
              },
            ],
          ],
        },
      };
      try {
        await bot.sendMessage(
          chatId,
          `Вы можете начать чат с ${match.name}:`,
          chatButton
        );
      } catch (error) {
        console.error("Error sending message with chat button:", error);
        await bot.sendMessage(
          chatId,
          "Ошибка при создании кнопки для начала чата. Пользователь может быть недоступен или ID некорректен."
        );
      }
    } else {
      await bot.sendMessage(
        chatId,
        "Не удалось найти пользователя для отправки сообщения."
      );
    }
  } else {
    await bot.sendMessage(chatId, "Вы уже использовали эту функцию сегодня.");
  }
}

module.exports = { handleCallbackQuery };
