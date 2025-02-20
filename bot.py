const TelegramBot = require('node-telegram-bot-api');

// Замените на ваш токен, выданный BotFather
const token = process.env.BOT_TOKEN || '8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA';

// Создаём бота в режиме polling
const bot = new TelegramBot(token, { polling: true });

// Этот URL — ваш WebApp (анонимный чат), например, домен Railway
const WEBAPP_URL = 'anonchat-production-5964.up.railway.app'; 

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `
👨🏻‍💻 *Анонимный Чат*!

▪ *Быстрые знакомства:* мгновенно находите собеседника  
▪ *Полная анонимность:* сообщения нигде не хранятся
▪ *Простота и удобство:* всё прямо в Telegram  

Нажмите на кнопку ниже, чтобы открыть чат:
  `;

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '👨🏻‍💻 Анонимный чат',
            web_app: {
              url: WEBAPP_URL
            }
          }
        ]
      ]
    }
  });
});
