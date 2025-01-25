require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const connectDB = require("./config/db");
const commandHandlers = require("./handlers/commandHandlers");
const messageHandlers = require("./handlers/messageHandlers");
const callbackQueryHandlers = require("./handlers/callbackQueryHandlers");
const { addLike, resetDailyLikes } = require("./services/userService");

connectDB()
  .then(() => {
    console.log("Database connection established");

    // Передаем bot в обработчики команд
    bot.onText(/\/start/, (msg) => commandHandlers.handleStart(msg, bot));
    bot.onText(/\/myprofile/, (msg) =>
      commandHandlers.handleMyProfile(msg, bot)
    );

    bot.on("callback_query", async (query) => {
      await callbackQueryHandlers.handleCallbackQuery(query, bot);
    });

    // Передаем bot в обработчик сообщений
    bot.on("message", (msg) => messageHandlers.handleMessage(msg, bot));
  })
  .catch((err) => console.error("Failed to connect to database:", err));
