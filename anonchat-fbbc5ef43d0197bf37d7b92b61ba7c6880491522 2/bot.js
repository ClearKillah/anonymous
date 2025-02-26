# bot.py
import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Updater, CommandHandler, CallbackContext

# Конфигурация из переменных окружения
BOT_TOKEN = os.getenv('8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA')
WEBAPP_URL = os.getenv('https://anonymous-production.up.railway.app/')

def start(update: Update, context: CallbackContext) -> None:
    # Форматированное сообщение с преимуществами
    message = """
🎯 *Быстрый поиск* – мгновенное соединение с собеседником
🔒 *Полная анонимность* – ваши данные нигде не сохраняются
💬 *Свободное общение* – обсуждайте любые темы без ограничений
🔄 *Легкий переход* – смените собеседника в один клик
    """
    
    # Кнопка для открытия WebApp
    keyboard = [
        [InlineKeyboardButton("Анонимный чат! 🚀", web_app={'url': WEBAPP_URL})]
    ]
    
    update.message.reply_text(
        text=message,
        parse_mode='Markdown',
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

def main() -> None:
    updater = Updater(BOT_TOKEN)
    dispatcher = updater.dispatcher
    
    # Регистрация обработчика команды /start
    dispatcher.add_handler(CommandHandler("start", start))
    
    # Запуск бота
    updater.start_polling()
    updater.idle()

if __name__ == '__main__':
    main()
