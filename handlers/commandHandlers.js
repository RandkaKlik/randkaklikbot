const User = require("../models/User");
const { localize } = require("../utils/localization");
const { getUpdatedPhotoUrl } = require("../utils/photoUtil");

async function handleStart(msg, bot) {
  const chatId = msg.chat.id;
  const user = await User.findOne({ telegramId: chatId });

  if (user) {
    let profileText = `${localize(user.language, "profile_preview")}\n\n`;
    profileText += `**${user.name}**\n${localize(user.language, "age")}: ${
      user.age
    }\n${localize(user.language, "location")}: ${user.city}\n${localize(
      user.language,
      "about"
    )}: ${user.about || localize(user.language, "not_provided")}`;
    if (user.hidden) {
      profileText += `\n🔒 ${localize(user.language, "profile_hidden")}`;
    }
    try {
      if (user.photoUrl) {
        await sendProfileWithPhoto(
          chatId,
          user.photoUrl,
          profileText,
          user.language,
          bot
        );
      } else {
        await bot.sendMessage(chatId, profileText, {
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
      }
    } catch (error) {
      console.error("Failed to send photo:", error);
      await bot.sendMessage(
        chatId,
        localize(user.language, "error_sending_photo"),
        { parse_mode: "Markdown" }
      );
      await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });
    }
  } else {
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

async function handleMyProfile(msg, bot) {
  const chatId = msg.chat.id;
  const user = await User.findOne({ telegramId: chatId });

  if (user) {
    let profileText = `${localize(user.language, "profile_preview")}\n\n`;
    profileText += `**${user.name}**\n${localize(user.language, "age")}: ${
      user.age
    }\n${localize(user.language, "location")}: ${user.city}\n${localize(
      user.language,
      "about"
    )}: ${user.about || localize(user.language, "not_provided")}`;
    if (user.hidden) {
      profileText += `\n🔒 ${localize(user.language, "profile_hidden")}`;
    }
    try {
      if (user.photoUrl) {
        await sendProfileWithPhoto(
          chatId,
          user.photoUrl,
          profileText,
          user.language,
          bot
        );
      } else {
        await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });
      }
    } catch (error) {
      console.error("Failed to send photo:", error);
      await bot.sendMessage(
        chatId,
        localize(user.language, "error_sending_photo"),
        { parse_mode: "Markdown" }
      );
      await bot.sendMessage(chatId, profileText, { parse_mode: "Markdown" });
    }
  } else {
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
  }
}

async function sendProfileWithPhoto(
  chatId,
  photoUrl,
  profileText,
  language,
  bot
) {
  let photoToSend = photoUrl.startsWith("http") ? photoUrl : photoUrl;
  try {
    await bot.sendPhoto(chatId, photoToSend, {
      caption: profileText,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: localize(language, "go_to_profiles"),
              callback_data: "profile_approved",
            },
          ],
          [
            {
              text: localize(language, "return_to_edit"),
              callback_data: "profile_edit",
            },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Failed to send photo using file_id:", error);
    const updatedUrl = await getUpdatedPhotoUrl(photoToSend, bot);
    if (updatedUrl) {
      await bot.sendPhoto(chatId, updatedUrl, {
        caption: profileText,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: localize(language, "go_to_profiles"),
                callback_data: "profile_approved",
              },
            ],
            [
              {
                text: localize(language, "return_to_edit"),
                callback_data: "profile_edit",
              },
            ],
          ],
        },
      });
    } else {
      throw new Error("Failed to update photo URL");
    }
  }
}

module.exports = { handleStart, handleMyProfile };
