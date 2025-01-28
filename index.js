require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const connectDB = require("./config/db");
const commandHandlers = require("./handlers/commandHandlers");
const messageHandlers = require("./handlers/messageHandlers");
const callbackQueryHandlers = require("./handlers/callbackQueryHandlers");

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

const webhookUrl = "https://randkaklik.onrender.com/webhook";

bot.setWebHook(webhookUrl);

app.use(bot.webhookCallback("/webhook"));

app.get("/", (req, res) => {
  console.log("Mmm... I’m Mr. Frundles");
  res.send("Bot is running!");
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`Server is running on ${webhookUrl}`);
});
