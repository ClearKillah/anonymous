import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

BOT_TOKEN = "8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA"
WEBAPP_URL = "https://anonymous-production.up.railway.app/"
IMAGE_URL = "https://cdn.prod.website-files.com/62d84e447b4f9e7263d31e94/6557420216a456cfaef685c0_6399a4d27711a5ad2c9bf5cd_ben-sweet-2LowviVHZ-E-unsplash-1.jpg"

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = (
        "<b>👨🏻‍💻 Dox: Анонимный Чат</b>\n\n"
        "• Данные защищены на 102%\n"
        "• Моментальный подбор собеседника\n"
        "• Автоудаление чатов через 72 часа\n"
    )
    
    # Клавиатура с двумя кнопками
    keyboard = [
        [InlineKeyboardButton(
            "Найти собеседника! 🚀", 
            web_app=WebAppInfo(url=WEBAPP_URL)
        )],
        [InlineKeyboardButton(
            "Поддержка", 
            url="https://t.me/DoxGames_bot"  # Ссылка на бота поддержки
        )]
    ]
    
    await update.message.reply_photo(
        photo=IMAGE_URL,
        caption=message,
        parse_mode='HTML',
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

def main() -> None:
    application = Application.builder().token(BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.run_polling()

if __name__ == "__main__":
    main()
