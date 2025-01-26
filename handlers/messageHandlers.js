const User = require("../models/User");
const { localize } = require("../utils/localization");
const { reverseGeocode } = require("../utils/locationUtil");
const {
  addLike,
  resetDailyLikes,
  checkForNewMatch,
} = require("../services/userService");
const { showProfileForMatching, findMatches } = require("../utils/profileUtil");

async function handleMessage(msg, bot) {
  const chatId = msg.chat.id;
  let user = await User.findOne({ telegramId: chatId }).lean(false);

  if (!user) return;

  if (user.currentMessageRecipient || user.currentChatPartner) {
    // Объединяем логику для отправки сообщения
    let recipient;
    if (user.currentMessageRecipient) {
      recipient = await User.findById(user.currentMessageRecipient);
      if (recipient) {
        await sendMessageToUser(user, recipient, msg.text, bot);
        // Очищаем currentMessageRecipient после отправки только если это первое сообщение
        await User.findByIdAndUpdate(user._id, {
          $unset: { currentMessageRecipient: 1 },
          currentChatPartner: recipient._id,
        });
      } else {
        await bot.sendMessage(
          chatId,
          "Пользователь, которому вы пытались отправить сообщение, не найден."
        );
        await User.findByIdAndUpdate(user._id, {
          $unset: { currentMessageRecipient: 1 },
        });
      }
    } else if (user.currentChatPartner) {
      recipient = await User.findById(user.currentChatPartner);
      if (recipient) {
        await sendMessageToUser(user, recipient, msg.text, bot); // Используем sendMessageToUser для обоих случаев
      } else {
        await bot.sendMessage(
          chatId,
          "Ваш собеседник не найден. Переписка прервана."
        );
        await User.findByIdAndUpdate(user._id, {
          $unset: { currentChatPartner: 1 },
        });
      }
    }
  }

  if (
    msg.text &&
    !isNaN(Number(msg.text)) &&
    Number(msg.text) >= 17 &&
    !user.age
  ) {
    // Регистрация возраста
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
  } else if (msg.text && Number(msg.text) < 17 && !user.age) {
    await bot.sendMessage(chatId, localize(user.language, "age_too_young"));
  } else if (msg.text && user.gender && user.interestedIn && !user.name) {
    // Регистрация имени
    user.name = msg.text || user.firstName || msg.from.first_name || "User";
    await user.save();
    await bot.sendMessage(chatId, localize(user.language, "about_question"));
  } else if (msg.text && !user.about) {
    // Регистрация информации о себе
    user.about = msg.text;
    await user.save();
    await bot.sendMessage(chatId, localize(user.language, "photo_request"));
  } else if (msg.photo && !user.photoUrl) {
    // Регистрация фото
    const photo = msg.photo[msg.photo.length - 1];
    user.photoUrl = photo.file_id;
    await user.save();
    // Показать профиль для подтверждения
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
  } else if (msg.location && !user.location.coordinates[0]) {
    // Регистрация местоположения
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
    // Обработка лайка
    await handleLike(chatId, user, bot);
  } else if (msg.text === "👎") {
    // Обработка дизлайка
    await handleDislike(chatId, user, bot);
  } else if (msg.text === "⛔") {
    await bot.sendMessage(chatId, "Выберите действие:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Вернуться к анкете", callback_data: "return_to_profile" }],
          [{ text: "Удалить профиль", callback_data: "delete_profile" }],
        ],
      },
    });
  } else if (msg.text === "💌") {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const user = await User.findOne({ telegramId: chatId });

    if (!user.premium) {
      await bot.sendMessage(
        chatId,
        "Извините, вы можете написать без совпадения по лайкам только с премиум подпиской. Для возвращения на анкету нажмите /myprofile"
      );
    } else {
      if (!user.lastMessageDate || user.lastMessageDate < startOfDay) {
        await handlePremiumSendMessage(user, chatId, bot);
      } else {
        await bot.sendMessage(
          chatId,
          "Извините. Вы исчерпали свой лимит на сегодня."
        );
      }
    }
  } else if (msg.text && user.matches.length > 0) {
    // Обработка чат-сообщений только если у пользователя есть хотя бы один матч
    // await handleChatMessage(msg, user, bot);
  }
}

async function handlePremiumSendMessage(user, chatId, bot) {
  const match = await findCurrentMatch(user); // Предполагаем, что мы знаем, какой матч сейчас просматривается
  if (match) {
    await bot.sendMessage(
      chatId,
      "Вы можете отправить сообщение без совпадения по лайкам только один раз в сутки. Вы согласны?",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "ДА", callback_data: "send_message_yes" }],
            [{ text: "НЕТ", callback_data: "send_message_no" }],
          ],
        },
      }
    );
  } else {
    await bot.sendMessage(
      chatId,
      "Не удалось найти пользователя для отправки сообщения."
    );
  }
}

async function findCurrentMatch(user) {
  // Логика для нахождения текущего матча, например, последний просмотренный профиль
  // Это может быть последний элемент массива matches или специальное поле для текущего матча
  return await User.findOne({
    _id: { $in: user.matches },
    _id: { $ne: user._id },
  }).sort({ registrationDate: -1 });
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
    // Проверяем на новый матч
    const isNewMatch = await checkForNewMatch(user._id, currentMatch._id);
    if (isNewMatch) {
      // Уведомляем пользователей о новом матче
      await notifyMatch(user, currentMatch, bot);
    }
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

// async function handleChatMessage(msg, user, bot) {
//   if (user.currentChatPartner) {
//     const chatPartner = await User.findById(user.currentChatPartner);
//     if (chatPartner) {
//       await bot.sendMessage(
//         chatPartner.telegramId,
//         `${user.name}: ${msg.text}`,
//         {
//           reply_markup: {
//             inline_keyboard: [
//               [
//                 {
//                   text: "Завершить беседу",
//                   callback_data: `stop_conversation_${user._id}`,
//                 },
//               ],
//             ],
//           },
//         }
//       );
//       await bot.sendMessage(user.telegramId, "Сообщение отправлено.", {
//         reply_markup: {
//           inline_keyboard: [
//             [{ text: "Завершить беседу", callback_data: "stop_conversation" }],
//           ],
//         },
//       });
//     } else {
//       await bot.sendMessage(
//         user.telegramId,
//         "Пользователь, с которым вы пытались общаться, не найден."
//       );
//       await User.findByIdAndUpdate(user._id, {
//         $unset: { currentChatPartner: 1 },
//       });
//     }
//   } else {
//     // Предположим, что пользователь хочет начать переписку с последним матчем
//     const lastMatch = user.matches[user.matches.length - 1];
//     if (lastMatch) {
//       const matchUser = await User.findById(lastMatch);
//       if (matchUser) {
//         // Уведомляем обеих пользователей о начале переписки
//         await bot.sendMessage(
//           user.telegramId,
//           `Начинаете переписку с ${matchUser.name}.`
//         );
//         await bot.sendMessage(
//           matchUser.telegramId,
//           `Начинается переписка с ${user.name}.`
//         );
//         // Устанавливаем currentChatPartner
//         await User.findByIdAndUpdate(user._id, {
//           currentChatPartner: matchUser._id,
//         });
//         await User.findByIdAndUpdate(matchUser._id, {
//           currentChatPartner: user._id,
//         });
//         // Отправляем сообщение партнеру
//         await bot.sendMessage(
//           matchUser.telegramId,
//           `${user.name}: ${msg.text}`
//         );
//       } else {
//         await bot.sendMessage(
//           user.telegramId,
//           "Не удалось найти последнего матча для начала переписки."
//         );
//       }
//     } else {
//       await bot.sendMessage(
//         user.telegramId,
//         "У вас нет текущего чата. Начните с лайка, чтобы найти матч."
//       );
//     }
//   }
// }

async function notifyMatch(user, match, bot) {
  try {
    const matchKeyboard = {
      inline_keyboard: [
        [
          {
            text: "Начать переписку",
            callback_data: `start_chat_${match._id}`,
          },
        ],
        [
          {
            text: "Прервать переписку",
            callback_data: "stop_chat",
          },
        ],
      ],
    };

    // Отправка уведомления пользователю о новом матче с фотографией
    await sendNotificationWithPhoto(
      user.telegramId,
      match,
      bot,
      matchKeyboard,
      `У вас новый матч с ${match.name}!`
    );

    // Отправка уведомления матчу о новом матче с фотографией
    await sendNotificationWithPhoto(
      match.telegramId,
      user,
      bot,
      matchKeyboard,
      `У вас новый матч с ${user.name}!`
    );

    await User.findByIdAndUpdate(user._id, {
      $addToSet: { availableChatPartners: match._id },
    });
    await User.findByIdAndUpdate(match._id, {
      $addToSet: { availableChatPartners: user._id },
    });
  } catch (error) {
    console.error("Error notifying match:", error);
  }
}

async function notifyMatch(user, match, bot) {
  try {
    const matchKeyboard = {
      inline_keyboard: [
        [
          {
            text: "Начать переписку",
            callback_data: `start_chat_${match._id}`,
          },
        ],
        [
          {
            text: "Прервать переписку",
            callback_data: "stop_chat",
          },
        ],
      ],
    };

    // Отправка уведомления пользователю о новом матче с фотографией
    await sendNotificationWithPhoto(
      user.telegramId,
      match,
      bot,
      matchKeyboard,
      `У вас новый матч с ${match.name}!`
    );

    // Отправка уведомления матчу о новом матче с фотографией
    await sendNotificationWithPhoto(
      match.telegramId,
      user,
      bot,
      matchKeyboard,
      `У вас новый матч с ${user.name}!`
    );

    await User.findByIdAndUpdate(user._id, {
      $addToSet: { availableChatPartners: match._id },
    });
    await User.findByIdAndUpdate(match._id, {
      $addToSet: { availableChatPartners: user._id },
    });
  } catch (error) {
    console.error("Error notifying match:", error);
  }
}

async function sendMessageToUser(sender, recipient, messageText, bot) {
  try {
    const senderKeyboard = {
      inline_keyboard: [
        [{ text: "Завершить беседу", callback_data: "stop_conversation" }],
      ],
    };
    const recipientKeyboard = {
      inline_keyboard: [
        [
          {
            text: "Завершить беседу",
            callback_data: `stop_conversation_${sender._id}`,
          },
        ],
      ],
    };

    // Изменяем сообщение для получателя
    await sendNotificationWithPhoto(
      recipient.telegramId,
      sender,
      bot,
      recipientKeyboard,
      `У вас новое сообщение от ${sender.name}:\n${messageText}`
    );
    // Отправляем подтверждение отправителю только здесь
    await bot.sendMessage(sender.telegramId, "Сообщение отправлено.", {
      reply_markup: senderKeyboard,
    });
  } catch (error) {
    console.error("Error sending message to user:", error);
    await bot.sendMessage(
      sender.telegramId,
      "Не удалось отправить сообщение. Попробуйте позже."
    );
  }
}

async function sendNotificationWithPhoto(
  chatId,
  profileUser,
  bot,
  keyboard,
  messageText
) {
  try {
    if (profileUser.photoUrl) {
      let photoToSend = profileUser.photoUrl;
      if (!profileUser.photoUrl.startsWith("http")) {
        photoToSend = profileUser.photoUrl;
      } else {
        const { getUpdatedPhotoUrl } = require("../utils/photoUtil");
        const updatedUrl = await getUpdatedPhotoUrl(profileUser.photoUrl, bot);
        photoToSend = updatedUrl || profileUser.photoUrl;
      }
      await bot.sendPhoto(chatId, photoToSend, {
        caption: messageText,
        reply_markup: keyboard,
      });
    } else {
      // Если фото отсутствует, отправляем только текст
      await bot.sendMessage(chatId, messageText, {
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error("Error sending notification with photo:", error);
    // Отправляем только текстовое сообщение в случае ошибки с фото
    await bot.sendMessage(chatId, messageText, {
      reply_markup: keyboard,
    });
  }
}

module.exports = { handleMessage };
