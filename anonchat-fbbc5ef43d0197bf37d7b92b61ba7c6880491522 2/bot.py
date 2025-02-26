import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

BOT_TOKEN = "8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA"
WEBAPP_URL = "https://anonymous-production.up.railway.app/"

# Настройка логгирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Создаем сообщение с форматированием
    message = (
        "🌟 *Анонимный чат*\n\n"
        "🛡️ *Конфиденциальность* – ваши сообщения защищены\n"
        "🎭 *Анонимность* – никто не узнает вашу личность\n"
        "🚀 *Быстро* – мгновенное подключение к собеседнику\n"
        "💬 *Просто* – интуитивно понятный интерфейс"
    )
    
    # Создаем кнопку с веб-приложением
    keyboard = [
        [InlineKeyboardButton("В чат! 🚀", web_app=WebAppInfo(url=WEBAPP_URL))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Отправляем сообщение
    await update.message.reply_text(
        text=message,
        parse_mode='MarkdownV2',
        reply_markup=reply_markup
    )

def main() -> None:
    # Создаем приложение и передаем токен
    application = Application.builder().token(BOT_TOKEN).build()
    
    # Добавляем обработчик команды /start
    application.add_handler(CommandHandler("start", start))
    
    # Запускаем бота
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
