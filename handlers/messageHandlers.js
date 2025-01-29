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
    await bot.sendMessage(
      chatId,
      `${localize(user.language, "contact_admin_for_premium")} @datingadminacc`
    );
  }

  if (user.viewCount % 20 === 0) {
    const ad = await Advertisement.findOne({ active: true }).lean();
    if (ad) {
      if (ad.imageUrl) {
        await bot.sendPhoto(chatId, ad.imageUrl, {
          caption: `${ad.text}\n[${localize(
            user.language,
            "go_to_community"
          )}](${ad.link})`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: localize(user.language, "go_to_community"),
                  url: ad.link,
                },
              ],
            ],
          },
        });
      } else {
        await bot.sendMessage(
          chatId,
          `${ad.text}\n[${localize(user.language, "go_to_community")}](${
            ad.link
          })`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: localize(user.language, "go_to_community"),
                    url: ad.link,
                  },
                ],
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
          await bot.sendMessage(chatId, localize(user.language, "no_profiles"));
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
        localize(user.language, "complaint_to_admin")
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
        await bot.sendMessage(chatId, localize(user.language, "no_profiles"));
      }
    } else {
      await bot.sendMessage(
        chatId,
        localize(user.language, "complaint_failed")
      );
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
    if (user.hidden) {
      profileText += `\n🔒 ${localize(user.language, "profile_hidden")}`;
    }
    try {
      await bot.sendPhoto(chatId, user.photoUrl, {
        caption: profileText,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: localize(user.language, "go_to_profiles"),
                callback_data: "profile_approved",
              },
            ],
            [
              {
                text: localize(user.language, "return_to_edit"),
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
        localize(user.language, "error_sending_photo"),
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
    await bot.sendMessage(chatId, localize(user.language, "selects_one"), {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: localize(user.language, "go_to_profile"),
              callback_data: "return_to_profile",
            },
          ],
          [
            {
              text: localize(user.language, "profile_hide_show"),
              callback_data: user.hidden ? "show_profile" : "hide_profile",
            },
          ],
          [
            {
              text: localize(user.language, "delete_profile"),
              callback_data: "delete_profile",
            },
          ],
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
        localize(user.language, "error_not_premium")
      );
    } else {
      if (!user.lastMessageDate || user.lastMessageDate < startOfDay) {
        await handlePremiumSendMessage(user, chatId, bot);
      } else {
        await bot.sendMessage(chatId, localize(user.language, "limit_off"));
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
            [
              {
                text: localize(user.language, "yes"),
                callback_data: "send_message_yes",
              },
            ],
            [
              {
                text: localize(user.language, "no"),
                callback_data: "send_message_no",
              },
            ],
          ],
        },
      };
      await bot.sendMessage(
        chatId,
        localize(user.language, "premium_message"),
        confirmKeyboard
      );
    } else {
      await bot.sendMessage(
        chatId,
        localize(user.language, "conversation_not_started")
      );
    }
  } else {
    await bot.sendMessage(
      chatId,
      localize(user.language, "feature_used_today")
    );
  }
}

async function findCurrentMatch(user) {
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
    await bot.sendMessage(chatId, localize(user.language, "premium_likes"));
    return;
  } else if (!user.premium && user.dailyLikesGiven >= currentLimit) {
    if (!user.additionalLikesUsed) {
      const urls = [
        { platform: "Instagram", url: "https://www.instagram.com/randkaklik" },
        { platform: "X", url: "https://x.com/randkaklik" },
        { platform: "Telegram", url: "https://t.me/randkaklikanal" },
      ];

      const randomUrl = urls[Math.floor(Math.random() * urls.length)];

      const firstMessage = await bot.sendMessage(
        chatId,
        localize(user.language, "like_limit_reached"),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: randomUrl.platform,
                  url: randomUrl.url,
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
            localize(user.language, "extra_likes_confirm"),
            {
              chat_id: chatId,
              message_id: firstMessage.message_id,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: localize(user.language, "extra_likes_button"),
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
            localize(user.language, "extra_likes_confirm"),
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: localize(user.language, "extra_likes_button"),
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
      await bot.sendMessage(chatId, localize(user.language, "premium_likes"));
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
      `${localize(user.language, "user_liked")} ${
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
      await bot.sendMessage(chatId, localize(user.language, "no_profiles"));
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
      await bot.sendMessage(chatId, localize(user.language, "no_profiles"));
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
              text: localize(user.language, "start_conversation"),
              url: `tg://user?id=${match.telegramId}`,
            },
          ],
        ],
      },
    };
    const message = `${localize(user.language, "new_match")} ${match.name}`;
    await bot.sendPhoto(user.telegramId, match.photoUrl || "no_photo.png", {
      caption: message,
      ...chatButton,
    });
  } catch (error) {
    console.error("Error sending match notification:", error);
    await bot.sendMessage(
      user.telegramId,
      `${localize(user.language, "error")} ${match.name}.`
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
