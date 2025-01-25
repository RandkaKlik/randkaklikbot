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

module.exports = {
  createUser,
  getUserByTelegramId,
  addLike,
  resetDailyLikes,
};
