const User = require("../models/User");
const { localize } = require("./localization");

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
        const { getUpdatedPhotoUrl } = require("./photoUtil");
        const updatedUrl = await getUpdatedPhotoUrl(match.photoUrl, bot);
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
    _id: {
      $ne: user._id,
      $nin: [...user.likesGiven, ...user.dislikesGiven],
    },
  };

  console.log("Match query:", query);

  const matches = await User.find(query)
    .sort({ registrationDate: -1 })
    .limit(10);
  console.log(`Found matches count: ${matches.length}`);
  return matches;
}

module.exports = { showProfileForMatching, findMatches };
