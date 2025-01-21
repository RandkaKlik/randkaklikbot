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

// Добавляйте другие методы по мере необходимости

module.exports = { createUser, getUserByTelegramId };
