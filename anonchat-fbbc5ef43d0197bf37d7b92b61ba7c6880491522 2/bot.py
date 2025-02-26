# bot.py
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Updater, CommandHandler, CallbackContext
import os

# Для локального тестирования (удалите эти строки при деплое на Railway!)
BOT_TOKEN = "8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA"  # Пример: "8039344227:AAFuRzP92ZoGOxRC3EOWF..."
WEBAPP_URL = "https://anonymous-production.up.railway.app/"    # Пример: "https://ваш-проект.railway.app"

def start(update: Update, context: CallbackContext) -> None:
    message = """
🎯 *Быстрый поиск* – мгновенное соединение с собеседником
🔒 *Полная анонимность* – ваши данные нигде не сохраняются
💬 *Свободное общение* – обсуждайте любые темы без ограничений
🔄 *Легкий переход* – смените собеседника в один клик
    """
    keyboard = [[InlineKeyboardButton("Анонимный чат! 🚀", web_app={'url': WEBAPP_URL})]]
    update.message.reply_text(
        text=message,
        parse_mode='Markdown',
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

def main():
    updater = Updater(BOT_TOKEN, use_context=True)
    dispatcher = updater.dispatcher
    dispatcher.add_handler(CommandHandler("start", start))
    updater.start_polling()
    updater.idle()

if __name__ == '__main__':
    main()
