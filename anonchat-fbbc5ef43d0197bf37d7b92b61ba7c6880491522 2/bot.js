const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Конфигурация для Railway
const port = process.env.PORT || 3000;
const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

const bot = new TelegramBot(token, { polling: true });
const app = express();

// Веб-хук для Railway (необязательно, но для надежности)
bot.setWebHook(`${webAppUrl}/bot${token}`);

// Обработчик /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `...ваш текст приветствия...`;
  
  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👨🏻‍💻 Анонимный чат', web_app: { url: webAppUrl } }]
      ]
    }
  });
});

// Запускаем Express для Railway
app.listen(port, () => {
  console.log(`Bot and server running on port ${port}`);
});
