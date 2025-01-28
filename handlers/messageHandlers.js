const User = require("../models/User");
const { localize } = require("../utils/localization");
const Advertisement = require("../models/Advertisement");
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

  if (!user.viewCount) user.viewCount = 0;
  user.viewCount++;
  await user.save();

  if (msg.text === "/premium") {
    const premiumMessage = localize(user.language, "contact_admin_for_premium");
    await bot.sendMessage(chatId, `${premiumMessage} @datingadminacc`);
  }

  if (user.viewCount % 20 === 0) {
    const ad = await Advertisement.findOne({ active: true }).lean();
    if (ad) {
      if (ad.imageUrl) {
        await bot.sendPhoto(chatId, ad.imageUrl, {
          caption: `${ad.text}\n[Перейти к сообществу](${ad.link})`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Перейти к сообществу", url: ad.link }]],
          },
        });
      } else {
        await bot.sendMessage(
          chatId,
          `${ad.text}\n[Перейти к сообществу](${ad.link})`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Перейти к сообществу", url: ad.link }],
              ],
            },
          }
        );
      }
      // Задержка перед показом следующей анкеты
      const delay = Math.floor(Math.random() * (7000 - 5000 + 1) + 5000); // Случайная задержка от 5 до 7 секунд
      setTimeout(async () => {
        const matches = await findMatches(user);
        if (matches.length > 0) {
          await showProfileForMatching(chatId, user, matches[0], bot);
        } else {
          await bot.sendMessage(
            chatId,
            "Больше анкет нет. Попробуйте зайти позже."
          );
        }
      }, delay);
      return; // Прерываем дальнейшую обработку, так как реклама уже показана
    }
  }

  if (msg.text === "/complaint") {
    const currentMatches = await findMatches(user);
    if (currentMatches.length > 0) {
      const currentMatch = currentMatches[0]; // Предполагаем, что первый матч - это текущий просматриваемый профиль
      await User.findByIdAndUpdate(currentMatch._id, { complained: true });
      await bot.sendMessage(
        chatId,
        "Благодарим. Администрация ознакомится с вашей жалобой."
      );

      // Отмечаем текущий просматриваемый профиль как дизлайкнутый
      if (!user.dislikesGiven) user.dislikesGiven = [];
      user.dislikesGiven.push(currentMatch._id.toString());
      await user.save();

      // Показываем следующую анкету
      currentMatches.shift();
      if (currentMatches.length > 0) {
        await showProfileForMatching(chatId, user, currentMatches[0], bot);
      } else {
        await bot.sendMessage(
          chatId,
          "Больше анкет нет. Попробуйте зайти позже."
        );
      }
    } else {
      await bot.sendMessage(
        chatId,
        "Это можно делать только когда вы просматриваете анкеты."
      );
    }
  }

  // if (user.currentMessageRecipient || user.currentChatPartner) {
  //   // Объединяем логику для отправки сообщения
  //   let recipient;
  //   if (user.currentMessageRecipient) {
  //     recipient = await User.findById(user.currentMessageRecipient);
  //     if (recipient) {
  //       await sendMessageToUser(user, recipient, msg.text, bot);
  //       // Очищаем currentMessageRecipient после отправки только если это первое сообщение
  //       await User.findByIdAndUpdate(user._id, {
  //         $unset: { currentMessageRecipient: 1 },
  //         currentChatPartner: recipient._id,
  //       });
  //       // Не отправляем сообщение о подтверждении здесь, так как это делается в sendMessageToUser
  //     } else {
  //       await bot.sendMessage(
  //         chatId,
  //         "Пользователь, которому вы пытались отправить сообщение, не найден."
  //       );
  //       await User.findByIdAndUpdate(user._id, {
  //         $unset: { currentMessageRecipient: 1 },
  //       });
  //     }
  //   } else if (user.currentChatPartner) {
  //     recipient = await User.findById(user.currentChatPartner);
  //     if (recipient) {
  //       // Отправляем сообщение только один раз
  //       await sendMessageToUser(user, recipient, msg.text, bot); // Используем sendMessageToUser для единой точки отправки
  //     } else {
  //       await bot.sendMessage(
  //         chatId,
  //         "Ваш собеседник не найден. Переписка прервана."
  //       );
  //       await User.findByIdAndUpdate(user._id, {
  //         $unset: { currentChatPartner: 1 },
  //       });
  //     }
  //   }
  // }

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
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (!user.lastMessageDate || user.lastMessageDate < startOfDay) {
    const match = await findCurrentMatch(user);
    if (match) {
      const confirmKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "ДА", callback_data: "send_message_yes" }],
            [{ text: "НЕТ", callback_data: "send_message_no" }],
          ],
        },
      };
      await bot.sendMessage(
        chatId,
        "Вы можете отправить сообщение без совпадения по лайкам только один раз в сутки. Вы согласны?",
        confirmKeyboard
      );
    } else {
      await bot.sendMessage(
        chatId,
        "Не удалось найти пользователя для отправки сообщения."
      );
    }
  } else {
    await bot.sendMessage(
      chatId,
      "Извините, услуга доступна только раз в сутки."
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
      const firstMessage = await bot.sendMessage(
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

      // Используем `message_id` из первого сообщения для редактирования
      setTimeout(async () => {
        try {
          await bot.editMessageText(
            "Подтвердите переход, чтобы активировать дополнительные лайки:",
            {
              chat_id: chatId,
              message_id: firstMessage.message_id,
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
        } catch (error) {
          console.error("Error editing message:", error);
          // Если редактирование не удалось (например, сообщение было удалено), отправляем новое сообщение
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
        }
      }, 10000);
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
      await new Promise((resolve) => setTimeout(resolve, 10000));
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

async function sendMatchNotification(user, match, bot) {
  try {
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
    const message = `Новый матч с ${match.name}! Нажмите для начала чата:`;
    await bot.sendPhoto(user.telegramId, match.photoUrl || "no_photo.png", {
      caption: message,
      ...chatButton,
    });
  } catch (error) {
    console.error("Error sending match notification:", error);
    await bot.sendMessage(
      user.telegramId,
      `Ошибка при отправке уведомления о матче с ${match.name}.`
    );
  }
}

async function notifyMatch(user, match, bot) {
  try {
    await sendMatchNotification(user, match, bot);
    await sendMatchNotification(match, user, bot);
  } catch (error) {
    console.error("Error in notifyMatch:", error);
  }
}

module.exports = { handleMessage };
