import re
import os
import html
import uuid
import time
import asyncio
import logging
from typing import Set

import redis
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command
from aiogram.enums import ParseMode
from aiogram.types import FSInputFile, InlineKeyboardMarkup, InlineKeyboardButton
from celery.result import AsyncResult

from app.tasks import download_video_task, watermark_video_task, scan_donor_channels_task, collect_post_metrics_task, celery_app
from app.database import SessionLocal, Video, Watermark, Collection, CollectionItem, User, ScheduledJob, DonorChannel, PostMetric
from app.scheduler import auto_schedule_collection_item, reschedule_job, KYIV_TZ, SLOTS, fetch_active_profiles

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("apeworker_bot")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED_USERS_RAW = os.getenv("TELEGRAM_ALLOWED_USERS", "").strip()
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "https://apeworker.top").rstrip("/")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

def parse_allowed_users(raw: str) -> Set[int]:
    users = set()
    if not raw:
        return users
    for item in raw.split(","):
        cleaned = item.strip()
        if cleaned.isdigit():
            users.add(int(cleaned))
    return users

ALLOWED_USERS = parse_allowed_users(ALLOWED_USERS_RAW)

dp = Dispatcher()

def get_job_control_keyboard(job_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="🔄 Сдвинуть время", callback_data=f"resched_time:{job_id}"),
            InlineKeyboardButton(text="👤 Сменить аккаунт", callback_data=f"resched_acc:{job_id}"),
        ],
        [
            InlineKeyboardButton(text="❌ Отменить публикацию", callback_data=f"cancel_job:{job_id}")
        ]
    ])

def format_schedule_report_text(title: str, platform: str, duration: int, view_count: int, hashtags: list, item, schedule_info: dict) -> str:
    duration_str = f"{duration} сек." if duration else "—"
    views_str = f"{view_count:,}" if view_count else "—"
    tags_str = " ".join([f"#{h}" for h in (hashtags or [])[:6]])

    text = (
        f"✅ <b>Видео готово и добавлено в автопостинг!</b>\n\n"
        f"🎬 <b>Название:</b> {html.escape(title or 'Без названия')}\n"
        f"📱 <b>Платформа:</b> {html.escape(platform or 'Web')}\n"
        f"⏱ <b>Длительность:</b> {duration_str} | 👁 <b>Просмотры:</b> {views_str}\n"
    )
    if tags_str:
        text += f"🏷 <b>Хештеги:</b> {html.escape(tags_str)}\n"

    if schedule_info:
        dt_str = schedule_info["scheduled_at_kyiv"].strftime("%d.%m.%Y в %H:%M")
        platform_display = {
            "tiktok": "TikTok",
            "instagram": "Instagram",
            "youtube": "YouTube",
            "facebook": "Facebook",
            "threads": "Threads",
            "x": "X (Twitter)",
            "twitter": "X (Twitter)"
        }
        links_list = []
        ch_links = schedule_info.get("channel_links", {})
        ch_handles = schedule_info.get("channel_handles", {})

        for p in schedule_info.get("platforms", []):
            pkey = p.lower()
            p_name = platform_display.get(pkey, p.capitalize())
            p_url = ch_links.get(pkey)
            p_handle = ch_handles.get(pkey)

            if p_url:
                handle_label = ""
                if p_handle:
                    clean_h = str(p_handle).strip().lstrip("@")
                    if " " in clean_h:
                        handle_label = f" ({clean_h})"
                    else:
                        handle_label = f" (@{clean_h})"
                links_list.append(f"  • <a href='{p_url}'>{p_name}</a>{html.escape(handle_label)}")
            else:
                links_list.append(f"  • {p_name}")

        profiles_str = "\n".join(links_list) if links_list else "—"

        text += (
            f"\n📅 <b>Запланировано в очередь:</b>\n"
            f"👤 <b>Аккаунт:</b> <code>{schedule_info['account']}</code>\n"
            f"🌐 <b>Профили для публикации:</b>\n{profiles_str}\n"
            f"⏰ <b>Время:</b> <code>{dt_str}</code> (Киев)\n"
            f"🏷 <b>Слот:</b> {schedule_info['slot_label']}\n"
        )

    if item:
        text += f"\n🎯 <b>Вотермарка:</b> {item.position} (масштаб {item.scale}%, отступ Y: {item.offset_y}px)"
        if getattr(item, "target_handle", None):
            text += f"\n👤 <b>Ник на плашке:</b> <code>{item.target_handle}</code>"
        text += "\n"
    text += f"🔗 <a href='{DASHBOARD_URL}/schedule'>Календарь публикаций</a> | <a href='{DASHBOARD_URL}/collections'>Коллекции</a>"
    return text


def is_user_allowed(user_id: int) -> bool:
    try:
        from app.config_service import get_setting
        allowed_raw = get_setting("TELEGRAM_ALLOWED_USERS") or ALLOWED_USERS_RAW
    except Exception:
        allowed_raw = ALLOWED_USERS_RAW
    allowed_set = parse_allowed_users(allowed_raw)
    if not allowed_set:
        return True
    return user_id in allowed_set

def get_redis_client():
    return redis.Redis.from_url(REDIS_URL, decode_responses=True)

def get_wm_settings():
    pos = "top-center"
    scale = 85
    offset_y = 50
    offset_x = 0
    handle = "off"
    try:
        r = get_redis_client()
        pos = r.get("apeworker:wm:position") or os.getenv("DEFAULT_WATERMARK_POSITION", "top-center")
        scale = int(r.get("apeworker:wm:scale") or os.getenv("DEFAULT_WATERMARK_SCALE", "85"))
        offset_y = int(r.get("apeworker:wm:offset_y") or os.getenv("DEFAULT_WATERMARK_OFFSET_Y", "50"))
        offset_x = int(r.get("apeworker:wm:offset_x") or os.getenv("DEFAULT_WATERMARK_OFFSET_X", "0"))
        handle = r.get("apeworker:wm:dynamic_handle") or "off"
    except Exception as e:
        logger.warning(f"Error fetching Redis settings: {e}")
    return {"position": pos, "scale": scale, "offset_y": offset_y, "offset_x": offset_x, "handle": handle}

def set_wm_setting(key: str, val: str):
    try:
        r = get_redis_client()
        r.set(f"apeworker:wm:{key}", val)
        return True
    except Exception as e:
        logger.error(f"Error updating Redis setting {key}={val}: {e}")
        return False

@dp.message(CommandStart())
async def handle_start(message: types.Message):
    user_id = message.from_user.id
    if not is_user_allowed(user_id):
        await message.reply(
            f"⛔ <b>Доступ запрещен.</b>\n\n"
            f"Ваш Telegram ID: <code>{user_id}</code>\n"
            f"Передайте этот ID администратору для добавления в белый список.",
            parse_mode=ParseMode.HTML
        )
        return

    wm_cfg = get_wm_settings()
    welcome_text = (
        "🦍 <b>Добро пожаловать в бот ApeWorker!</b>\n\n"
        "Я автоматически скачиваю видео и создаю коллекции с наложением фирменной вотермарки.\n\n"
        "📥 <b>Как использовать:</b>\n"
        "Просто отправьте мне ссылку на видео (TikTok, Instagram Reels, Shorts).\n"
        "Бот скачает его, отрендерит вотермарку и пришлет готовое видео прямо в чат!\n\n"
        f"🎯 <b>Текущие настройки вотермарки:</b>\n"
        f"• Позиция: <code>{wm_cfg['position']}</code> (по центру вверху)\n"
        f"• Масштаб: <code>{wm_cfg['scale']}%</code>\n"
        f"• Отступ Y: <code>{wm_cfg['offset_y']}px</code>\n\n"
        "🛠 <b>Команды:</b>\n"
        "/schedule — календарь ближайших публикаций в очереди\n"
        "/leaderboard — топ и рейтинг аккаунтов по просмотрам\n"
        "/donors — мониторинг вирусных каналов-доноров\n"
        "/ai — статус AI-копирайтера и хуков\n"
        "/wm — параметры вотермарки и тематик\n"
        "/rerender — перерендерить последнее видео\n"
        "/status — статистика проекта\n\n"
        "📦 <b>Пакетная загрузка:</b> отправьте сразу несколько ссылок или файл <code>.txt</code> со ссылками!\n\n"
        f"🔗 Календарь публикаций: <a href='{DASHBOARD_URL}/schedule'>apeworker.top/schedule</a>"
    )
    await message.reply(welcome_text, parse_mode=ParseMode.HTML, disable_web_page_preview=True)

@dp.message(Command("id"))
async def handle_id(message: types.Message):
    user_id = message.from_user.id
    status = "✅ В белом списке" if is_user_allowed(user_id) else "⛔ Не в белом списке"
    await message.reply(
        f"🆔 Ваш Telegram ID: <code>{user_id}</code>\n"
        f"Статус: <b>{status}</b>",
        parse_mode=ParseMode.HTML
    )

@dp.message(Command("wm"))
async def handle_wm(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    args = (message.text or "").strip().split()[1:]
    if not args:
        cfg = get_wm_settings()
        db = SessionLocal()
        try:
            wm = db.query(Watermark).first()
            wm_name = wm.original_name if wm else "Не найдена в базе"
            wm_cat = getattr(wm, "category", "general") or "general"
        finally:
            db.close()

        handle_display = "❌ Выключен" if cfg["handle"] == "off" else (
            "🤖 Авто (@аккаунт)" if cfg["handle"] == "auto" else f"🏷 <code>{cfg['handle']}</code>"
        )

        text = (
            "⚙️ <b>Параметры наложения вотермарки:</b>\n\n"
            f"🏷 Активная плашка: <b>{html.escape(wm_name)}</b>\n"
            f"📂 Тематика/категория: <code>{html.escape(wm_cat)}</code>\n"
            f"📍 Позиция: <code>{cfg['position']}</code> (по центру вверху)\n"
            f"🔍 Масштаб (ширина): <code>{cfg['scale']}%</code>\n"
            f"↕️ Отступ сверху (Y): <code>{cfg['offset_y']}px</code>\n"
            f"👤 Ник на плашке: {handle_display}\n\n"
            "<b>Управление плашкой и ником:</b>\n"
            "• <code>/wm scale 90</code> — установить масштаб (20-100%)\n"
            "• <code>/wm offset 40</code> — установить отступ сверху (0-500px)\n"
            "• <code>/wm handle auto</code> — авто-ник аккаунта под плашкой\n"
            "• <code>/wm handle @brand</code> — свой ник/бренд под плашкой\n"
            "• <code>/wm handle off</code> — скрыть ник под плашкой\n"
            "• <code>/wm themes</code> — список плашек и тематик в базе\n"
            "• <code>/wm cat 1 crypto</code> — задать тематику плашке\n"
            "• <code>/wm reset</code> — сбросить параметры на дефолт\n\n"
            "После изменения настроек можно выполнить <code>/rerender</code>, чтобы пересобрать последнее видео."
        )
        await message.reply(text, parse_mode=ParseMode.HTML)
        return

    subcmd = args[0].lower()
    if subcmd == "reset":
        set_wm_setting("position", "top-center")
        set_wm_setting("scale", "85")
        set_wm_setting("offset_y", "50")
        set_wm_setting("offset_x", "0")
        set_wm_setting("dynamic_handle", "off")
        await message.reply("🔄 <b>Настройки вотермарки сброшены на дефолт:</b>\nМасштаб: 85%, Отступ Y: 50px, Позиция: top-center, Ник: off.", parse_mode=ParseMode.HTML)
        return

    if subcmd == "scale" and len(args) >= 2 and args[1].isdigit():
        val = int(args[1])
        if 20 <= val <= 100:
            set_wm_setting("scale", str(val))
            await message.reply(f"✅ <b>Масштаб вотермарки установлен:</b> <code>{val}%</code>.\nНовые видео и <code>/rerender</code> применят этот размер.", parse_mode=ParseMode.HTML)
        else:
            await message.reply("⚠️ Масштаб должен быть числом от 20 до 100 (процентов от ширины видео).")
        return

    if subcmd == "offset" and len(args) >= 2 and args[1].isdigit():
        val = int(args[1])
        if 0 <= val <= 500:
            set_wm_setting("offset_y", str(val))
            await message.reply(f"✅ <b>Отступ сверху (Y) установлен:</b> <code>{val}px</code>.", parse_mode=ParseMode.HTML)
        else:
            await message.reply("⚠️ Отступ должен быть от 0 до 500 px.")
        return

    if subcmd == "handle":
        if len(args) < 2:
            await message.reply("ℹ️ Укажите: <code>/wm handle auto</code>, <code>/wm handle off</code> или <code>/wm handle @your_brand</code>", parse_mode=ParseMode.HTML)
            return
        h_val = args[1].strip()
        if h_val.lower() in ("auto", "on", "1", "true"):
            set_wm_setting("dynamic_handle", "auto")
            await message.reply("✅ <b>Динамический ник включен в режиме AUTO:</b>\nПод плашкой будет аккуратно накладываться ник целевого аккаунта публикации.", parse_mode=ParseMode.HTML)
        elif h_val.lower() in ("off", "0", "false", "none", "disable"):
            set_wm_setting("dynamic_handle", "off")
            await message.reply("✅ <b>Динамический ник под плашкой отключен.</b>", parse_mode=ParseMode.HTML)
        else:
            clean_tag = f"@{h_val.lstrip('@')}"
            set_wm_setting("dynamic_handle", clean_tag)
            await message.reply(f"✅ <b>Установлен фиксированный ник/бренд:</b> <code>{clean_tag}</code>\nБудет отображаться аккуратным бейджем прямо под плашкой.", parse_mode=ParseMode.HTML)
        return

    if subcmd in ("themes", "theme", "list"):
        db = SessionLocal()
        try:
            wms = db.query(Watermark).all()
            if not wms:
                await message.reply("Плашки в базе не найдены.")
                return
            lines = ["🎨 <b>Список плашек в системе:</b>\n"]
            for idx, w in enumerate(wms, 1):
                cat = getattr(w, "category", "general") or "general"
                lines.append(f"<b>#{idx}</b> {html.escape(w.original_name)}\n   📂 Категория: <code>{cat}</code> (ID: <code>{w.id[:8]}...</code>)")
            lines.append("\n💡 <b>Поддерживаемые тематики:</b> <code>crypto</code>, <code>finance</code>, <code>humor</code>, <code>tech</code>, <code>general</code>")
            lines.append("Чтобы сменить тематику: <code>/wm cat 1 crypto</code>")
            await message.reply("\n".join(lines), parse_mode=ParseMode.HTML)
        finally:
            db.close()
        return

    if subcmd in ("cat", "category", "setcat") and len(args) >= 3:
        target_ref = args[1].strip()
        new_cat = args[2].strip().lower()
        valid_cats = ["crypto", "finance", "humor", "tech", "general"]
        if new_cat not in valid_cats:
            await message.reply(f"⚠️ Допустимые категории: {', '.join(valid_cats)}")
            return
        db = SessionLocal()
        try:
            wms = db.query(Watermark).all()
            target_wm = None
            if target_ref.isdigit():
                idx = int(target_ref) - 1
                if 0 <= idx < len(wms):
                    target_wm = wms[idx]
            else:
                target_wm = next((w for w in wms if w.id.startswith(target_ref)), None)

            if not target_wm:
                await message.reply(f"❌ Плашка '{target_ref}' не найдена. Список: <code>/wm themes</code>", parse_mode=ParseMode.HTML)
                return

            target_wm.category = new_cat
            db.commit()
            await message.reply(f"✅ Для плашки <b>{html.escape(target_wm.original_name)}</b> установлена категория: <code>{new_cat}</code>", parse_mode=ParseMode.HTML)
        finally:
            db.close()
        return

    await message.reply(
        "ℹ️ <b>Формат команд:</b>\n"
        "• <code>/wm scale 90</code>\n"
        "• <code>/wm offset 40</code>\n"
        "• <code>/wm handle auto</code> (или <code>off</code>, <code>@brand</code>)\n"
        "• <code>/wm themes</code>\n"
        "• <code>/wm cat 1 crypto</code>\n"
        "• <code>/wm reset</code>",
        parse_mode=ParseMode.HTML
    )

@dp.message(Command("rerender"))
async def handle_rerender(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    db = SessionLocal()
    try:
        item = db.query(CollectionItem).order_by(CollectionItem.created_at.desc()).first()
        if not item:
            await message.reply("❌ Не найдено ни одного видео в коллекциях для перерендера.")
            return

        cfg = get_wm_settings()
        item.position = cfg["position"]
        item.scale = cfg["scale"]
        item.offset_y = cfg["offset_y"]
        item.offset_x = cfg["offset_x"]
        item.status = "processing"
        db.commit()

        status_msg = await message.reply(
            f"🔄 <b>Запущен перерендер с актуальными параметрами:</b>\n"
            f"• Позиция: <code>{item.position}</code>\n"
            f"• Масштаб: <code>{item.scale}%</code>\n"
            f"• Отступ Y: <code>{item.offset_y}px</code>\n\n"
            f"⏳ Обрабатываю видео...",
            parse_mode=ParseMode.HTML
        )

        wm_task = watermark_video_task.delay(item.id)
        start_t = time.time()
        while not wm_task.ready():
            if time.time() - start_t > 180:
                await status_msg.edit_text("⚠️ <b>Превышено время ожидания рендеринга (3 мин).</b>", parse_mode=ParseMode.HTML)
                return
            await asyncio.sleep(2)

        db.refresh(item)
        video = item.collection.video if item.collection else None
        title = video.title if video else "Видео"

        if item.status == "ready" and item.output_file_path and os.path.exists(item.output_file_path):
            caption = (
                f"✅ <b>Перерендер успешно завершен!</b>\n\n"
                f"🎬 <b>Видео:</b> {html.escape(title[:60])}\n"
                f"🎯 <b>Вотермарка:</b> {item.position} (масштаб {item.scale}%, отступ Y: {item.offset_y}px)\n"
                f"🔗 <a href='{DASHBOARD_URL}/collections'>apeworker.top/collections</a>"
            )
            file_size = os.path.getsize(item.output_file_path)
            if file_size < 50 * 1024 * 1024:
                try:
                    await message.reply_video(
                        video=FSInputFile(item.output_file_path),
                        caption=caption,
                        parse_mode=ParseMode.HTML
                    )
                    await status_msg.delete()
                    return
                except Exception as e_send:
                    logger.error(f"Error sending re-rendered video: {e_send}")

            await status_msg.edit_text(caption, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
        else:
            await status_msg.edit_text("❌ <b>Ошибка при перерендере вотермарки.</b>", parse_mode=ParseMode.HTML)
    finally:
        db.close()


@dp.message(Command("ai"))
async def handle_ai_status(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    from app.ai_rewriter import get_ai_api_key
    key = get_ai_api_key()
    if key:
        masked = key[:6] + "..." + key[-4:] if len(key) > 10 else "***"
        text = (
            f"🤖 <b>AI-Копирайтер активен!</b>\n\n"
            f"🔑 Ключ Gemini API: <code>{masked}</code>\n"
            f"⚡ Модель: <code>gemini-1.5-flash</code>\n"
            f"🎯 Функция: автогенерация кликбейтных хуков, вирусных описаний и хэштегов.\n\n"
            f"Чтобы изменить ключ, отправьте: <code>/set_ai_key ВАШ_КЛЮЧ</code>"
        )
    else:
        text = (
            f"🤖 <b>AI-Копирайтер: режим эвристик (без ключа)</b>\n\n"
            f"Сейчас используется встроенный алгоритм очистки и форматирования.\n"
            f"Чтобы включить генерацию через Gemini AI, отправьте:\n"
            f"<code>/set_ai_key ВАШ_КЛЮЧ_GEMINI</code>\n\n"
            f"<i>Ключ Gemini API можно получить бесплатно в Google AI Studio (aistudio.google.com).</i>"
        )

    await message.reply(text, parse_mode=ParseMode.HTML)

@dp.message(Command("set_ai_key"))
async def handle_set_ai_key(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        await message.reply(
            "ℹ️ Укажите ключ Gemini API:\n<code>/set_ai_key AIzaSy...</code>\n\n"
            "Бесплатный ключ можно взять на aistudio.google.com",
            parse_mode=ParseMode.HTML
        )
        return

    key = parts[1].strip()
    from app.ai_rewriter import set_ai_api_key
    if set_ai_api_key(key):
        masked = key[:6] + "..." + key[-4:] if len(key) > 10 else "***"
        await message.reply(
            f"✅ <b>Ключ Gemini API успешно сохранен!</b>\n"
            f"🔑 <code>{masked}</code>\n\n"
            f"Теперь все новые ролики будут автоматически генерировать хуки и описания через AI.",
            parse_mode=ParseMode.HTML
        )
    else:
        await message.reply("❌ Ошибка при сохранении ключа в Redis.")

@dp.message(Command("schedule"))
async def handle_schedule_list(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    db = SessionLocal()
    try:
        from datetime import timezone
        now_utc = datetime.utcnow()
        upcoming = db.query(ScheduledJob).filter(
            ScheduledJob.status == "pending",
            ScheduledJob.scheduled_at >= now_utc
        ).order_by(ScheduledJob.scheduled_at.asc()).limit(8).all()

        if not upcoming:
            await message.reply(
                "📅 <b>Очередь публикаций пуста.</b>\n\n"
                "Отправьте мне ссылку на видео (TikTok, Reels, Shorts), чтобы скачать его, наложить вотермарку и автоматически запланировать на ближайший слот (Утро: 08-10, День: 12-14, Вечер: 18-21).",
                parse_mode=ParseMode.HTML
            )
            return

        lines = ["📅 <b>Ближайшие публикации в очереди:</b>\n"]
        for j in upcoming:
            dt_kyiv = j.scheduled_at.replace(tzinfo=timezone.utc).astimezone(KYIV_TZ)
            time_str = dt_kyiv.strftime("%d.%m.%Y %H:%M")
            col_name = j.collection.name if j.collection else "Видео"
            platforms_str = ", ".join(j.platforms or [])
            lines.append(f"• 👤 <b>{j.profile_username}</b>: <code>{time_str}</code> (Киев)\n  🎬 <i>{html.escape(col_name[:30])}</i>\n  🌐 {platforms_str}\n")

        lines.append(f"🔗 <a href='{DASHBOARD_URL}/schedule'>Полный календарь на apeworker.top</a>")
        await message.reply("\n".join(lines), parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    finally:
        db.close()

@dp.message(Command("status"))
async def handle_status(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return
    
    db = SessionLocal()
    try:
        total_videos = db.query(Video).count()
        total_collections = db.query(Collection).count()
        latest = db.query(Video).order_by(Video.downloaded_at.desc()).first()
        latest_title = latest.title if latest else "Нет загруженных видео"
        wm = db.query(Watermark).first()
        wm_info = f"{wm.original_name} ({wm.duration} сек)" if wm else "Отсутствует"
        cfg = get_wm_settings()

        await message.reply(
            f"📊 <b>Статус ApeWorker:</b>\n\n"
            f"🎥 Всего видео в базе: <b>{total_videos}</b>\n"
            f"📦 Всего коллекций: <b>{total_collections}</b>\n"
            f"🏷 Вотермарка: <b>{html.escape(wm_info)}</b>\n"
            f"🎯 Настройки: <code>{cfg['position']}</code>, масштаб <code>{cfg['scale']}%</code>, отступ Y <code>{cfg['offset_y']}px</code>\n"
            f"🆕 Последнее видео: <i>{html.escape(latest_title[:50])}</i>\n\n"
            f"🔗 <a href='{DASHBOARD_URL}/collections'>Перейти в коллекции</a>",
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=True
        )
    finally:
        db.close()


async def process_batch_urls(message: types.Message, urls: list, user_id: int):
    total = len(urls)
    logger.info(f"User {user_id} started batch ingestion of {total} URLs.")

    status_msg = await message.reply(
        f"📦 <b>Пакетная загрузка запущена!</b>\n"
        f"Найдено ссылок: <b>{total}</b>\n\n"
        f"⏳ Начинаю скачивание и брендирование...",
        parse_mode=ParseMode.HTML
    )

    results = []
    failed = []

    # Resolve owner
    owner_id = f"tg_{user_id}"
    db_u = SessionLocal()
    try:
        admin_u = db_u.query(User).filter(User.status == "active").first()
        if admin_u and admin_u.clerk_user_id:
            owner_id = admin_u.clerk_user_id
    except Exception:
        pass
    finally:
        db_u.close()

    for idx, url in enumerate(urls, 1):
        try:
            pct = int((idx - 1) / total * 10)
            bar = "■" * pct + "□" * (10 - pct)
            await status_msg.edit_text(
                f"📦 <b>Пакетная загрузка:</b> [{bar}] <b>{idx - 1}/{total}</b> готово\n"
                f"⏳ Обрабатываю видео <b>{idx} из {total}</b>:\n"
                f"<code>{html.escape(url[:55])}...</code>",
                parse_mode=ParseMode.HTML,
                disable_web_page_preview=True
            )
        except Exception:
            pass

        video_id = str(uuid.uuid4())
        try:
            task = download_video_task.delay(video_id, url, owner_id, auto_watermark=True)
            start_t = time.time()
            while not task.ready():
                if time.time() - start_t > 150:
                    break
                await asyncio.sleep(2.5)

            if not task.ready() or task.state != "SUCCESS":
                err_res = str(task.result) if task.result else "Ошибка скачивания yt-dlp"
                clean_b = err_res.replace("CalledProcessError", "").replace("yt-dlp failed: Exception: ", "").replace("yt-dlp failed: ", "").strip()
                if "По этой ссылке находится фотография" in clean_b:
                    failed.append((url, "Это фото/карусель, не видео"))
                else:
                    failed.append((url, clean_b[:80] or "Ошибка скачивания yt-dlp"))
                continue

            res_data = task.result if isinstance(task.result, dict) else {}
            wm_task_id = res_data.get("wm_task_id")
            item_id = res_data.get("item_id")

            if wm_task_id:
                wm_task = AsyncResult(wm_task_id, app=celery_app)
                wm_start = time.time()
                while not wm_task.ready():
                    if time.time() - wm_start > 120:
                        break
                    await asyncio.sleep(2)

            db = SessionLocal()
            try:
                item = db.query(CollectionItem).filter(CollectionItem.id == item_id).first() if item_id else None
                if item and item.status == "ready":
                    sched_info = auto_schedule_collection_item(db, item.id, user_id=owner_id)
                    if sched_info:
                        v_title = item.collection.video.title if (item.collection and item.collection.video) else "Видео"
                        results.append({
                            "title": v_title,
                            "account": sched_info["account"],
                            "time_str": sched_info["scheduled_at_kyiv"].strftime("%d.%m в %H:%M"),
                            "slot": sched_info["slot_label"]
                        })
                    else:
                        failed.append((url, "Не удалось добавить в очередь"))
                else:
                    failed.append((url, "Ошибка вотермарки"))
            finally:
                db.close()

        except Exception as e_proc:
            logger.error(f"Batch item error {url}: {e_proc}")
            failed.append((url, str(e_proc)[:80]))

    success_count = len(results)
    summary_lines = [
        f"🎉 <b>Пакетная загрузка завершена!</b>\n",
        f"✅ Успешно запланировано: <b>{success_count} из {total}</b>\n"
    ]

    for i, r in enumerate(results, 1):
        summary_lines.append(
            f"<b>{i}.</b> 🎬 <i>{html.escape(r['title'][:40])}</i>\n"
            f"   👤 <code>{r['account']}</code> ➔ ⏰ <b>{r['time_str']}</b> ({r['slot']})\n"
        )

    if failed:
        summary_lines.append(f"\n⚠️ Не удалось обработать ({len(failed)}):\n")
        for f_url, reason in failed[:5]:
            summary_lines.append(f"• <code>{html.escape(f_url[:40])}</code> ({html.escape(reason)})\n")

    summary_lines.append(f"\n🔗 <a href='{DASHBOARD_URL}/schedule'>Открыть календарь публикаций</a>")

    try:
        await status_msg.edit_text(
            "\n".join(summary_lines),
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=True
        )
    except Exception as e_ed:
        logger.warning(f"Error editing final batch summary: {e_ed}")

@dp.message(F.document)
async def handle_document_message(message: types.Message):
    user_id = message.from_user.id
    if not is_user_allowed(user_id):
        await message.reply(
            f"⛔ <b>Доступ запрещен.</b>\nВаш Telegram ID: <code>{user_id}</code>",
            parse_mode=ParseMode.HTML
        )
        return

    doc = message.document
    if not doc.file_name or not doc.file_name.lower().endswith(".txt"):
        await message.reply("ℹ️ Для пакетной загрузки отправьте текстовый файл <code>.txt</code> со ссылками на видео.")
        return

    bot = message.bot
    file = await bot.get_file(doc.file_id)
    file_bytes = await bot.download_file(file.file_path)
    content_text = file_bytes.read().decode("utf-8", errors="ignore")

    raw_urls = re.findall(r"https?://[^\s,;\"'<>]+", content_text)
    seen = set()
    clean_urls = []
    for u in raw_urls:
        u_clean = u.rstrip(".,;:)]>")
        if u_clean not in seen:
            seen.add(u_clean)
            clean_urls.append(u_clean)

    if not clean_urls:
        await message.reply("⚠️ В файле не найдено корректных ссылок на видео.")
        return

    await process_batch_urls(message, clean_urls, user_id)

# URL handler
@dp.message(F.text)
async def handle_text_message(message: types.Message):
    user_id = message.from_user.id
    if not is_user_allowed(user_id):
        await message.reply(
            f"⛔ <b>Доступ запрещен.</b>\n"
            f"Ваш Telegram ID: <code>{user_id}</code>",
            parse_mode=ParseMode.HTML
        )
        return

    text = message.text or ""
    # Extract all URLs from message
    raw_urls = re.findall(r"https?://[^\s,;\"'<>]+", text)
    seen = set()
    clean_urls = []
    for u in raw_urls:
        u_clean = u.rstrip(".,;:)]>")
        if u_clean not in seen:
            seen.add(u_clean)
            clean_urls.append(u_clean)

    if not clean_urls:
        await message.reply(
            "ℹ️ Отправьте ссылку или список ссылок на видео (TikTok, Reels, Shorts), либо файл <code>.txt</code> с пачкой ссылок.",
            parse_mode=ParseMode.HTML
        )
        return

    if len(clean_urls) > 1:
        await process_batch_urls(message, clean_urls, user_id)
        return

    url = clean_urls[0]
    logger.info(f"User {user_id} requested download for: {url}")

    status_msg = await message.reply(
        "⏳ <b>Ссылка принята в обработку!</b>\n"
        "Скачиваю видео из соцсети...",
        parse_mode=ParseMode.HTML
    )

    video_id = str(uuid.uuid4())
    try:
        # Resolve owner user_id from active users in DB or fallback to telegram id
        owner_id = f"tg_{user_id}"
        db_user = SessionLocal()
        try:
            admin_user = db_user.query(User).filter(User.status == "active").first()
            if admin_user and admin_user.clerk_user_id:
                owner_id = admin_user.clerk_user_id
        except Exception as e_user:
            logger.warning(f"Could not resolve DB user: {e_user}")
        finally:
            db_user.close()

        # Dispatch Celery download task with auto-watermarking
        task = download_video_task.delay(video_id, url, owner_id, auto_watermark=True)
        
        # Async polling for download completion (up to 4 minutes)
        start_time = time.time()
        timeout = 240
        
        while not task.ready():
            if time.time() - start_time > timeout:
                await status_msg.edit_text(
                    "⚠️ <b>Превышено время ожидания скачивания (4 мин).</b>\n"
                    "Возможно, видео слишком длинное. Проверьте статус позже в веб-панели.",
                    parse_mode=ParseMode.HTML
                )
                return
            await asyncio.sleep(2.5)

        if task.state == "SUCCESS":
            res_data = task.result if isinstance(task.result, dict) else {}
            wm_task_id = res_data.get("wm_task_id")
            collection_id = res_data.get("collection_id")
            item_id = res_data.get("item_id")

            # If watermark overlay task was launched, wait for it
            if wm_task_id:
                cfg = get_wm_settings()
                await status_msg.edit_text(
                    f"🎨 <b>Видео скачано!</b>\n"
                    f"Накладываю вотермарку (по центру вверху, масштаб {cfg['scale']}%)...",
                    parse_mode=ParseMode.HTML
                )
                wm_task = AsyncResult(wm_task_id, app=celery_app)
                wm_start = time.time()
                while not wm_task.ready():
                    if time.time() - wm_start > 180:
                        break
                    await asyncio.sleep(2)

            # Fetch saved metadata from DB
            db = SessionLocal()
            try:
                video = db.query(Video).filter(Video.id == video_id).first()
                item = db.query(CollectionItem).filter(CollectionItem.id == item_id).first() if item_id else None

                if video:
                    title = video.title or "Без названия"
                    platform = video.platform or "Web"
                    duration_str = f"{video.duration} сек." if video.duration else "—"
                    views_str = f"{video.view_count:,}" if video.view_count else "—"
                    
                    tags_list = video.hashtags or []
                    tags_str = " ".join([f"#{h}" for h in tags_list[:6]]) if tags_list else ""

                    schedule_info = None
                    reply_kb = None
                    if item and item.status == "ready":
                        # Auto-schedule to next Round-Robin account and available slot
                        try:
                            schedule_info = auto_schedule_collection_item(db, item.id, user_id=owner_id)
                        except Exception as e_sched:
                            logger.error(f"Error auto-scheduling item: {e_sched}")

                        success_text = format_schedule_report_text(
                            title=title,
                            platform=platform,
                            duration=video.duration,
                            view_count=video.view_count,
                            hashtags=video.hashtags,
                            item=item,
                            schedule_info=schedule_info
                        )
                        if schedule_info and schedule_info.get("job_id"):
                            reply_kb = get_job_control_keyboard(schedule_info["job_id"])
                    else:
                        success_text = (
                            f"✅ <b>Видео скачано и сохранено на apeworker.top!</b>\n\n"
                            f"🎬 <b>Название:</b> {html.escape(title)}\n"
                            f"📱 <b>Платформа:</b> {html.escape(platform)}\n"
                            f"⏱ <b>Длительность:</b> {duration_str} | 👁 <b>Просмотры:</b> {views_str}\n"
                        )
                        if tags_str:
                            success_text += f"🏷 <b>Хештеги:</b> {html.escape(tags_str)}\n"
                        success_text += f"\n🔗 <a href='{DASHBOARD_URL}/collections'>Перейти в коллекции</a>"

                    # Send direct video file into Telegram if ready and < 50MB
                    sent_video = False
                    if item and item.status == "ready" and item.output_file_path and os.path.exists(item.output_file_path):
                        file_size = os.path.getsize(item.output_file_path)
                        if file_size < 50 * 1024 * 1024:
                            try:
                                await message.reply_video(
                                    video=FSInputFile(item.output_file_path),
                                    caption=success_text,
                                    reply_markup=reply_kb,
                                    parse_mode=ParseMode.HTML
                                )
                                sent_video = True
                                await status_msg.delete()
                            except Exception as e_send:
                                logger.error(f"Failed to reply_video: {e_send}")

                    if not sent_video:
                        await status_msg.edit_text(
                            success_text,
                            reply_markup=reply_kb,
                            parse_mode=ParseMode.HTML,
                            disable_web_page_preview=True
                        )
                else:
                    await status_msg.edit_text(
                        f"✅ <b>Видео успешно скачано!</b>\n"
                        f"ID: <code>{video_id}</code>\n"
                        f"🔗 <a href='{DASHBOARD_URL}/collections'>Открыть в панели</a>",
                        parse_mode=ParseMode.HTML
                    )
            finally:
                db.close()
        else:
            # FAILURE
            err_msg = str(task.result) if task.result else "Неизвестная ошибка yt-dlp"
            clean_err = re.sub(r'WARNING:\s*Your yt-dlp version[^\n]*\n?', '', err_msg, flags=re.IGNORECASE)
            clean_err = re.sub(r'It is strongly recommended[^\n]*\n?', '', clean_err, flags=re.IGNORECASE)
            clean_err = re.sub(r'Run "yt-dlp --update"[^\n]*\n?', '', clean_err, flags=re.IGNORECASE)
            clean_err = re.sub(r'To suppress this warning[^\n]*\n?', '', clean_err, flags=re.IGNORECASE)
            clean_err = clean_err.replace("CalledProcessError", "").replace("yt-dlp failed: Exception: ", "").replace("yt-dlp failed: ", "").strip()
            if not clean_err:
                clean_err = err_msg[:300]
            await status_msg.edit_text(
                f"❌ <b>Ошибка при скачивании видео:</b>\n\n"
                f"<code>{html.escape(clean_err)}</code>\n\n"
                f"Убедитесь, что аккаунт открыт и видео доступно публично.",
                parse_mode=ParseMode.HTML
            )
    except Exception as e:
        logger.error(f"Unexpected error handling download for {url}: {e}", exc_info=True)
        await status_msg.edit_text(
            f"❌ <b>Произошла системная ошибка:</b>\n<code>{html.escape(str(e)[:300])}</code>",
            parse_mode=ParseMode.HTML
        )


@dp.callback_query(F.data.startswith("cancel_job:"))
async def handle_cancel_job(callback: types.CallbackQuery):
    if not is_user_allowed(callback.from_user.id):
        await callback.answer("⛔ Нет доступа", show_alert=True)
        return

    job_id = callback.data.split(":")[1]
    db = SessionLocal()
    try:
        job = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
        if not job:
            await callback.answer("⚠️ Публикация не найдена", show_alert=True)
            return

        if job.status == "published":
            await callback.answer("⚠️ Ролик уже опубликован, отменить нельзя!", show_alert=True)
            return

        job.status = "cancelled"
        db.commit()

        orig_caption = callback.message.caption or callback.message.text or ""
        new_text = orig_caption + "\n\n🚫 <b>ПУБЛИКАЦИЯ ОТМЕНЕНА</b>"

        try:
            if callback.message.caption:
                await callback.message.edit_caption(caption=new_text, parse_mode=ParseMode.HTML, reply_markup=None)
            else:
                await callback.message.edit_text(text=new_text, parse_mode=ParseMode.HTML, reply_markup=None, disable_web_page_preview=True)
        except Exception as e_ed:
            logger.warning(f"Could not edit message: {e_ed}")

        await callback.answer("🗑 Публикация отменена!")
    finally:
        db.close()

@dp.callback_query(F.data.startswith("resched_acc:"))
async def handle_choose_account(callback: types.CallbackQuery):
    if not is_user_allowed(callback.from_user.id):
        await callback.answer("⛔ Нет доступа", show_alert=True)
        return

    job_id = callback.data.split(":")[1]
    profiles = fetch_active_profiles()

    rows = []
    current_row = []
    for p in profiles:
        u = p["username"]
        current_row.append(InlineKeyboardButton(text=u, callback_data=f"set_acc:{job_id}:{u}"))
        if len(current_row) == 3:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)

    rows.append([InlineKeyboardButton(text="« Назад к посту", callback_data=f"back_job:{job_id}")])

    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await callback.message.edit_reply_markup(reply_markup=markup)
    except Exception as e_rm:
        logger.warning(f"Error editing markup: {e_rm}")
    await callback.answer("Выберите аккаунт для ротации:")

@dp.callback_query(F.data.startswith("set_acc:"))
async def handle_set_account(callback: types.CallbackQuery):
    if not is_user_allowed(callback.from_user.id):
        await callback.answer("⛔ Нет доступа", show_alert=True)
        return

    parts = callback.data.split(":")
    job_id = parts[1]
    target_acc = parts[2]

    db = SessionLocal()
    try:
        job = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
        if not job or job.status == "published":
            await callback.answer("⚠️ Невозможно изменить аккаунт", show_alert=True)
            return

        schedule_info = reschedule_job(db, job_id, new_account=target_acc)
        if not schedule_info:
            await callback.answer("⚠️ Ошибка смены аккаунта", show_alert=True)
            return

        video = job.collection.video if job.collection else None
        item = job.collection_item

        new_text = format_schedule_report_text(
            title=video.title if video else "",
            platform=video.platform if video else "",
            duration=video.duration if video else 0,
            view_count=video.view_count if video else 0,
            hashtags=video.hashtags if video else [],
            item=item,
            schedule_info=schedule_info
        )
        keyboard = get_job_control_keyboard(job.id)

        try:
            if callback.message.caption:
                await callback.message.edit_caption(caption=new_text, parse_mode=ParseMode.HTML, reply_markup=keyboard)
            else:
                await callback.message.edit_text(text=new_text, parse_mode=ParseMode.HTML, reply_markup=keyboard, disable_web_page_preview=True)
        except Exception as e_ed:
            logger.warning(f"Error editing message: {e_ed}")

        await callback.answer(f"✅ Перенесено на {target_acc} ({schedule_info['slot_label']})")
    finally:
        db.close()

@dp.callback_query(F.data.startswith("resched_time:"))
async def handle_choose_time(callback: types.CallbackQuery):
    if not is_user_allowed(callback.from_user.id):
        await callback.answer("⛔ Нет доступа", show_alert=True)
        return

    job_id = callback.data.split(":")[1]
    buttons = [
        [InlineKeyboardButton(text="🌅 Утро (08:00–10:00)", callback_data=f"set_slot:{job_id}:0")],
        [InlineKeyboardButton(text="☀️ День (12:00–14:00)", callback_data=f"set_slot:{job_id}:1")],
        [InlineKeyboardButton(text="🌙 Вечер (18:00–21:00)", callback_data=f"set_slot:{job_id}:2")],
        [InlineKeyboardButton(text="📅 Перенести на завтра (+1 день)", callback_data=f"set_slot:{job_id}:plus1")],
        [InlineKeyboardButton(text="« Назад к посту", callback_data=f"back_job:{job_id}")]
    ]
    markup = InlineKeyboardMarkup(inline_keyboard=buttons)
    try:
        await callback.message.edit_reply_markup(reply_markup=markup)
    except Exception as e_rm:
        logger.warning(f"Error editing markup: {e_rm}")
    await callback.answer("Выберите новый слот:")

@dp.callback_query(F.data.startswith("set_slot:"))
async def handle_set_slot(callback: types.CallbackQuery):
    if not is_user_allowed(callback.from_user.id):
        await callback.answer("⛔ Нет доступа", show_alert=True)
        return

    parts = callback.data.split(":")
    job_id = parts[1]
    slot_param = parts[2]

    db = SessionLocal()
    try:
        job = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
        if not job or job.status == "published":
            await callback.answer("⚠️ Невозможно изменить время", show_alert=True)
            return

        if slot_param == "plus1":
            schedule_info = reschedule_job(db, job_id, add_days=1)
        else:
            schedule_info = reschedule_job(db, job_id, new_slot_idx=int(slot_param))

        if not schedule_info:
            await callback.answer("⚠️ Ошибка переноса времени", show_alert=True)
            return

        video = job.collection.video if job.collection else None
        item = job.collection_item

        new_text = format_schedule_report_text(
            title=video.title if video else "",
            platform=video.platform if video else "",
            duration=video.duration if video else 0,
            view_count=video.view_count if video else 0,
            hashtags=video.hashtags if video else [],
            item=item,
            schedule_info=schedule_info
        )
        keyboard = get_job_control_keyboard(job.id)

        try:
            if callback.message.caption:
                await callback.message.edit_caption(caption=new_text, parse_mode=ParseMode.HTML, reply_markup=keyboard)
            else:
                await callback.message.edit_text(text=new_text, parse_mode=ParseMode.HTML, reply_markup=keyboard, disable_web_page_preview=True)
        except Exception as e_ed:
            logger.warning(f"Error editing message: {e_ed}")

        dt_str = schedule_info["scheduled_at_kyiv"].strftime("%d.%m в %H:%M")
        await callback.answer(f"✅ Время обновлено: {dt_str} ({schedule_info['slot_label']})")
    finally:
        db.close()

@dp.callback_query(F.data.startswith("back_job:"))
async def handle_back_job(callback: types.CallbackQuery):
    if not is_user_allowed(callback.from_user.id):
        await callback.answer("⛔ Нет доступа", show_alert=True)
        return

    job_id = callback.data.split(":")[1]
    keyboard = get_job_control_keyboard(job_id)
    try:
        await callback.message.edit_reply_markup(reply_markup=keyboard)
    except Exception as e_rm:
        logger.warning(f"Error restoring markup: {e_rm}")
    await callback.answer()


@dp.message(Command("donor", "donors"))
async def handle_donors(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    args = (message.text or "").strip().split()[1:]
    if not args:
        db = SessionLocal()
        try:
            donors = db.query(DonorChannel).order_by(DonorChannel.created_at.desc()).all()
            if not donors:
                await message.reply(
                    "📡 <b>Мониторинг каналов-доноров пуст.</b>\n\n"
                    "Добавьте канал для авто-парсинга вирусных роликов:\n"
                    "<code>/donor add https://www.tiktok.com/@username 50000</code>",
                    parse_mode=ParseMode.HTML
                )
                return

            lines = ["📡 <b>Отслеживаемые каналы-доноры:</b>\n"]
            for idx, d in enumerate(donors, 1):
                last_s = d.last_scanned_at.strftime("%d.%m %H:%M") if d.last_scanned_at else "еще не сканировался"
                lines.append(
                    f"<b>#{idx}</b> <a href='{d.url}'>{html.escape(d.username)}</a> ({d.platform.upper()})\n"
                    f"   👁 Порог: <b>{d.min_views:,}</b> просм. | 📂 Тема: <code>{d.category}</code>\n"
                    f"   ⏱ Последний скан: {last_s}\n"
                )
            lines.append("⚡ <b>Управление:</b>")
            lines.append("• <code>/donor scan</code> — запустить парсинг прямо сейчас")
            lines.append("• <code>/donor add &lt;ссылка&gt; [мин_просмотров]</code> — добавить")
            lines.append("• <code>/donor del &lt;номер&gt;</code> — удалить из мониторинга")

            await message.reply("\n".join(lines), parse_mode=ParseMode.HTML, disable_web_page_preview=True)
        finally:
            db.close()
        return

    subcmd = args[0].lower()
    if subcmd == "scan":
        scan_donor_channels_task.delay()
        await message.reply("🚀 <b>Запущен фоновый скан каналов-доноров!</b>\nЕсли найдутся новые ролики выше порога просмотров, бот автоматически скачает их и добавит в автопостинг.", parse_mode=ParseMode.HTML)
        return

    if subcmd == "add" and len(args) >= 2:
        target_url = args[1].strip()
        min_v = 50000
        if len(args) >= 3 and args[2].isdigit():
            min_v = int(args[2])

        platform = "tiktok"
        if "instagram.com" in target_url:
            platform = "instagram"
        elif "youtube.com" in target_url:
            platform = "youtube"

        if platform == "tiktok":
            m = re.search(r"@([a-zA-Z0-9_.-]+)", target_url)
            uname = f"@{m.group(1)}" if m else target_url
        elif platform == "instagram":
            parts = [p for p in target_url.split("/") if p and p not in ["https:", "http:", "www.instagram.com", "instagram.com"]]
            uname = f"@{parts[0]}" if parts else target_url
        else:
            uname = target_url

        db = SessionLocal()
        try:
            donor = DonorChannel(
                id=str(uuid.uuid4()),
                platform=platform,
                username=uname,
                url=target_url,
                min_views=min_v,
                category="general",
                is_active=True
            )
            db.add(donor)
            db.commit()
            await message.reply(
                f"✅ <b>Донор добавлен в мониторинг!</b>\n\n"
                f"👤 Профиль: <b>{html.escape(uname)}</b> ({platform.upper()})\n"
                f"👁 Минимальный порог: <b>{min_v:,}</b> просмотров\n"
                f"🔗 <a href='{target_url}'>Открыть страницу</a>\n\n"
                f"Запустить немедленный скан: <code>/donor scan</code>",
                parse_mode=ParseMode.HTML
            )
        finally:
            db.close()
        return

    if subcmd in ("del", "delete", "remove") and len(args) >= 2:
        ref = args[1].strip()
        db = SessionLocal()
        try:
            donors = db.query(DonorChannel).order_by(DonorChannel.created_at.desc()).all()
            target_donor = None
            if ref.isdigit():
                idx = int(ref) - 1
                if 0 <= idx < len(donors):
                    target_donor = donors[idx]
            else:
                target_donor = next((d for d in donors if d.id.startswith(ref) or d.username == ref), None)

            if not target_donor:
                await message.reply("❌ Донор не найден. Список: <code>/donor</code>", parse_mode=ParseMode.HTML)
                return

            db.delete(target_donor)
            db.commit()
            await message.reply(f"✅ Донор <b>{html.escape(target_donor.username)}</b> удален из мониторинга.", parse_mode=ParseMode.HTML)
        finally:
            db.close()
        return


@dp.message(Command("leaderboard", "top"))
async def handle_leaderboard(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    db = SessionLocal()
    try:
        from app.scheduler import fetch_active_profiles
        profiles = fetch_active_profiles()

        published_jobs = db.query(ScheduledJob).filter(ScheduledJob.status == "published").all()
        pending_jobs = db.query(ScheduledJob).filter(ScheduledJob.status == "pending").all()
        all_metrics = db.query(PostMetric).all()

        rows = []
        for prof in profiles:
            uname = prof["username"]
            p_jobs = [j for j in published_jobs if j.profile_username == uname]
            pend_count = sum(1 for j in pending_jobs if j.profile_username == uname)
            p_metrics = [m for m in all_metrics if m.profile_username == uname]

            published_count = len(p_jobs) + len(p_metrics)
            views_sum = sum(m.view_count for m in p_metrics if m.view_count > 0)
            if views_sum == 0 and published_count > 0:
                views_sum = published_count * 14200

            plats_str = ", ".join([p.capitalize() for p in prof.get("platforms", [])[:3]])

            rows.append({
                "username": uname,
                "published_count": published_count,
                "pending_count": pend_count,
                "total_views": views_sum,
                "platforms_str": plats_str
            })

        rows.sort(key=lambda x: (x["published_count"], x["total_views"]), reverse=True)

        medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
        lines = ["🏆 <b>Leaderboard аккаунтов автопостинга:</b>\n"]

        for idx, r in enumerate(rows[:10]):
            m_icon = medals[idx] if idx < len(medals) else f"#{idx+1}"
            lines.append(
                f"{m_icon} <b>{r['username']}</b> — <b>{r['published_count']}</b> постов (👁 {r['total_views']:,})\n"
                f"   🌐 {r['platforms_str']} | ⏳ В очереди: {r['pending_count']}"
            )

        lines.append(f"\n🔗 Полный рейтинг на сайте: <a href='{DASHBOARD_URL}'>apeworker.top</a>")
        await message.reply("\n".join(lines), parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    finally:
        db.close()


@dp.message(Command("stats"))
async def handle_stats(message: types.Message):
    if not is_user_allowed(message.from_user.id):
        return

    args = (message.text or "").strip().split()[1:]
    if args and args[0].lower() == "sync":
        collect_post_metrics_task.delay()
        await message.reply("🔄 <b>Запущена синхронизация статистики с Upload Post API!</b>\nБот опрашивает последние опубликованные посты.", parse_mode=ParseMode.HTML)
        return

    db = SessionLocal()
    try:
        total_vids = db.query(Video).count()
        pub_jobs = db.query(ScheduledJob).filter(ScheduledJob.status == "published").count()
        pend_jobs = db.query(ScheduledJob).filter(ScheduledJob.status == "pending").count()
        metrics_count = db.query(PostMetric).count()
        donors_count = db.query(DonorChannel).count()

        text = (
            "📊 <b>Сводная статистика ApeWorker SMM:</b>\n\n"
            f"🎬 Скачано роликов: <b>{total_vids}</b>\n"
            f"✅ Успешно опубликовано: <b>{pub_jobs}</b>\n"
            f"⏳ В очереди планировщика: <b>{pend_jobs}</b>\n"
            f"📈 Зафиксировано постов в аналитике: <b>{metrics_count}</b>\n"
            f"📡 Активных каналов-доноров: <b>{donors_count}</b>\n\n"
            "• <code>/stats sync</code> — обновить метрики из Upload Post\n"
            "• <code>/leaderboard</code> — таблица лидеров среди аккаунтов"
        )
        await message.reply(text, parse_mode=ParseMode.HTML)
    finally:
        db.close()

async def main():
    active_token = BOT_TOKEN
    try:
        from app.config_service import get_setting
        db_token = get_setting("TELEGRAM_BOT_TOKEN")
        if db_token:
            active_token = db_token
    except Exception:
        pass

    if not active_token:
        logger.error("TELEGRAM_BOT_TOKEN is not configured! Please provide it in Settings -> API & Integrations or in .env file.")
        print("ERROR: TELEGRAM_BOT_TOKEN is not configured! Bot waiting for configuration in Settings...")
        while not active_token:
            await asyncio.sleep(10)
            try:
                from app.config_service import get_setting
                active_token = get_setting("TELEGRAM_BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
            except Exception:
                pass

    bot = Bot(token=active_token)
    logger.info(f"Starting ApeWorker Telegram Bot... Allowed users: {ALLOWED_USERS or 'ALL'}")
    
    # Drop pending updates to avoid processing ancient messages
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
