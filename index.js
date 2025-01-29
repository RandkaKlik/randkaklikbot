require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf"); // Импортируем Telegraf
const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN); // Создаем экземпляр бота
const connectDB = require("./config/db");
const commandHandlers = require("./handlers/commandHandlers");
const messageHandlers = require("./handlers/messageHandlers");
const callbackQueryHandlers = require("./handlers/callbackQueryHandlers");

connectDB()
  .then(() => {
    console.log("Database connection established");

    // Передаем bot в обработчики команд
    bot.command("start", (ctx) => commandHandlers.handleStart(ctx, bot));
    bot.command("myprofile", (ctx) =>
      commandHandlers.handleMyProfile(ctx, bot)
    );

    bot.on("callback_query", async (ctx) => {
      await callbackQueryHandlers.handleCallbackQuery(ctx, bot);
    });

    bot.on("message", (ctx) => messageHandlers.handleMessage(ctx, bot));

    // Настройка webhook
    const webhookUrl = "https://yourdomain.com/webhook"; // Укажите свой URL
    bot.telegram.setWebhook(webhookUrl); // Устанавливаем webhook
  })
  .catch((err) => console.error("Failed to connect to database:", err));

// Создаем маршрут для обработки webhook
app.use(bot.webhookCallback("/webhook")); // Подключаем webhook callback

app.get("/", (req, res) => {
  console.log("Mmm... I’m Mr. Frundles");
  res.send("Bot is running!");
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`Server is running`);
});
