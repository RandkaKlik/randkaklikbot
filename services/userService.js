const User = require("../models/User");

const createUser = async (userData) => {
  try {
    const newUser = new User(userData);
    return await newUser.save();
  } catch (error) {
    throw error;
  }
};

const getUserByTelegramId = async (telegramId) => {
  return await User.findOne({ telegramId });
};

const addLike = async (likerId, likedId) => {
  try {
    // Обновляем данные пользователя, который лайкает
    const user = await User.findByIdAndUpdate(
      likerId,
      {
        $inc: { dailyLikesGiven: 1 },
        $addToSet: { likesGiven: likedId },
      },
      { new: true }
    );
    // Обновляем данные пользователя, который был лайкнут
    await User.findByIdAndUpdate(likedId, {
      $addToSet: { likesReceived: likerId },
    });
    return user;
  } catch (error) {
    throw error;
  }
};

const resetDailyLikes = async (userId) => {
  try {
    return await User.findByIdAndUpdate(
      userId,
      {
        dailyLikesGiven: 0,
        additionalLikesUsed: false,
        lastLikeDate: Date.now(),
      },
      { new: true }
    );
  } catch (error) {
    throw error;
  }
};

async function checkForNewMatch(userId, likedUserId) {
  try {
    const user = await User.findById(userId);
    const likedUser = await User.findById(likedUserId);
    if (
      user.likesGiven.includes(likedUserId.toString()) &&
      likedUser.likesGiven.includes(userId.toString())
    ) {
      // Добавляем друг друга в массив matches
      await User.findByIdAndUpdate(userId, {
        $addToSet: { matches: likedUserId },
      });
      await User.findByIdAndUpdate(likedUserId, {
        $addToSet: { matches: userId },
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error checking for new match:", error);
    throw error;
  }
}

module.exports = {
  createUser,
  getUserByTelegramId,
  addLike,
  resetDailyLikes,
  checkForNewMatch,
};
