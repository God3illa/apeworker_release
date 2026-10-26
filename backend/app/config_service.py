import os
import re
import json
import logging
import requests
import redis
from typing import Dict, Any, Optional, List
from datetime import datetime
from app.database import SessionLocal, SystemSetting

logger = logging.getLogger("apeworker_config")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Predefined metadata for all supported integrations
SUPPORTED_SETTINGS = {
    "UPLOAD_POST_API_KEY": {
        "label": "Upload Post API Key",
        "category": "Social Publishing (Instagram / TikTok / YouTube)",
        "is_secret": True,
        "description": "Ключ API для сервиса upload-post.com. Необходим для автопостинга видео в Instagram, TikTok, YouTube Shorts и сбора статистики просмотров.",
        "placeholder": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "docs_url": "https://upload-post.com",
    },
    "TELEGRAM_BOT_TOKEN": {
        "label": "Telegram Bot Token",
        "category": "Telegram Bot & Notifications",
        "is_secret": True,
        "description": "Токен Telegram-бота, полученный у официального бота @BotFather. Необходим для работы Telegram-интерфейса и отправки уведомлений о статусах задач.",
        "placeholder": "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ...",
        "docs_url": "https://t.me/BotFather",
    },
    "TELEGRAM_ALLOWED_USERS": {
        "label": "Allowed Telegram User IDs",
        "category": "Telegram Bot & Notifications",
        "is_secret": False,
        "description": "Список Telegram ID пользователей через запятую (например: 123456789, 987654321), которым разрешен доступ к боту. Если оставить пустым — бот будет доступен всем.",
        "placeholder": "123456789, 987654321",
        "docs_url": "https://t.me/userinfobot",
    },
    "GEMINI_API_KEY": {
        "label": "Google Gemini API Key",
        "category": "AI Content Generation",
        "is_secret": True,
        "description": "API-ключ Google Gemini (модель gemini-1.5-flash). Используется для умного рерайтинга хуков, генерации кликабельных заголовков и релевантных хештегов.",
        "placeholder": "AIzaSy...",
        "docs_url": "https://aistudio.google.com",
    },
    "DASHBOARD_URL": {
        "label": "Dashboard Public URL",
        "category": "System & Web Links",
        "is_secret": False,
        "description": "Публичный базовый адрес веб-дашборда для формирования ссылок на видео и расписание в Telegram-сообщениях.",
        "placeholder": "https://apeworker.top",
        "docs_url": "https://apeworker.top",
    }
}

def get_redis_client():
    try:
        return redis.Redis.from_url(REDIS_URL, decode_responses=True)
    except Exception as e:
        logger.warning(f"Could not connect to Redis: {e}")
        return None

def get_setting(key: str, default: str = "") -> str:
    """
    Retrieves setting value in order:
    1. Redis cache (fastest)
    2. SQLite database (durable)
    3. OS environment variables (fallback)
    """
    # 1. Try Redis
    try:
        r = get_redis_client()
        if r:
            cached = r.get(f"apeworker:config:{key}")
            if cached is not None and cached.strip() != "":
                return cached.strip()
    except Exception as e:
        logger.debug(f"Redis get error for {key}: {e}")

    # 2. Try DB
    db_val = None
    try:
        db = SessionLocal()
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if setting and setting.value and setting.value.strip():
            db_val = setting.value.strip()
            # Cache in Redis
            try:
                r = get_redis_client()
                if r:
                    r.set(f"apeworker:config:{key}", db_val)
            except Exception:
                pass
        db.close()
    except Exception as e:
        logger.warning(f"DB read error for setting {key}: {e}")

    if db_val is not None:
        return db_val

    # 3. Try Environment
    env_val = os.getenv(key, default)
    return env_val.strip() if env_val else default

def set_setting(key: str, value: str, description: Optional[str] = None) -> bool:
    """
    Saves setting value to SQLite DB and updates Redis cache.
    """
    cleaned_val = value.strip() if value else ""
    try:
        db = SessionLocal()
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if not setting:
            meta = SUPPORTED_SETTINGS.get(key, {})
            setting = SystemSetting(
                key=key,
                value=cleaned_val,
                description=description or meta.get("description", ""),
                updated_at=datetime.utcnow()
            )
            db.add(setting)
        else:
            setting.value = cleaned_val
            if description:
                setting.description = description
            setting.updated_at = datetime.utcnow()
        db.commit()
        db.close()

        # Update Redis
        try:
            r = get_redis_client()
            if r:
                r.set(f"apeworker:config:{key}", cleaned_val)
                # Keep backwards compatibility for Gemini
                if key == "GEMINI_API_KEY":
                    r.set("apeworker:config:gemini_api_key", cleaned_val)
        except Exception as e:
            logger.warning(f"Redis set error for {key}: {e}")

        return True
    except Exception as e:
        logger.error(f"Error saving setting {key}: {e}")
        return False

def mask_secret(value: str) -> str:
    """Masks a secret value for safe display in UI."""
    if not value:
        return ""
    val_str = str(value).strip()
    if len(val_str) <= 8:
        return "********"
    return f"{val_str[:4]}...{val_str[-4:]}"

def get_all_settings_info() -> List[Dict[str, Any]]:
    """Returns list of all settings with metadata and masked values for UI."""
    result = []
    for key, meta in SUPPORTED_SETTINGS.items():
        val = get_setting(key, "")
        is_set = bool(val and val.strip())

        # Determine source
        source = "not_set"
        try:
            db = SessionLocal()
            db_row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
            if db_row and db_row.value and db_row.value.strip():
                source = "database"
            elif os.getenv(key, "").strip():
                source = "environment"
            db.close()
        except Exception:
            if is_set:
                source = "active"

        result.append({
            "key": key,
            "label": meta["label"],
            "category": meta["category"],
            "is_secret": meta["is_secret"],
            "is_set": is_set,
            "masked_value": mask_secret(val) if meta["is_secret"] else val,
            "raw_value": val if not meta["is_secret"] else "",
            "description": meta["description"],
            "placeholder": meta["placeholder"],
            "docs_url": meta["docs_url"],
            "source": source
        })
    return result

def test_integration(service: str, override_value: Optional[str] = None) -> Dict[str, Any]:
    """Tests the validity of a given service configuration."""
    service = service.lower().strip()
    
    if service in ["upload_post", "upload_post_api_key"]:
        key = override_value.strip() if override_value else get_setting("UPLOAD_POST_API_KEY")
        if not key:
            return {"ok": False, "message": "Ключ UPLOAD_POST_API_KEY не задан."}
        try:
            url = "https://api.upload-post.com/api/uploadposts/users/current_user"
            resp = requests.get(url, headers={"Authorization": f"Apikey {key}"}, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                email = data.get("email") or "OK"
                plan = data.get("plan", "Standard")
                return {
                    "ok": True,
                    "message": f"Успешное подключение! Аккаунт: {email} (Тариф: {plan})",
                    "data": data
                }
            elif resp.status_code in (401, 403):
                return {"ok": False, "message": "Ошибка 401/403: Неверный или отозванный API-ключ Upload Post."}
            else:
                return {"ok": False, "message": f"Upload Post API вернул статус {resp.status_code}: {resp.text[:120]}"}
        except Exception as e:
            return {"ok": False, "message": f"Сетевая ошибка при запросе к Upload Post: {str(e)}"}

    elif service in ["telegram", "telegram_bot_token"]:
        token = override_value.strip() if override_value else get_setting("TELEGRAM_BOT_TOKEN")
        if not token:
            return {"ok": False, "message": "Токен TELEGRAM_BOT_TOKEN не задан."}
        try:
            url = f"https://api.telegram.org/bot{token}/getMe"
            resp = requests.get(url, timeout=10)
            data = resp.json()
            if data.get("ok"):
                user_info = data.get("result", {})
                username = user_info.get("username", "UnknownBot")
                first_name = user_info.get("first_name", "")
                return {
                    "ok": True,
                    "message": f"Успешное подключение к Telegram! Бот: @{username} ({first_name})",
                    "data": user_info
                }
            else:
                return {"ok": False, "message": f"Telegram API вернул ошибку: {data.get('description', 'Invalid token')}"}
        except Exception as e:
            return {"ok": False, "message": f"Сетевая ошибка при проверке бота: {str(e)}"}

    elif service in ["gemini", "gemini_api_key"]:
        key = override_value.strip() if override_value else get_setting("GEMINI_API_KEY")
        if not key:
            return {"ok": False, "message": "Ключ GEMINI_API_KEY не задан."}
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={key}"
            payload = {
                "contents": [{"parts": [{"text": "Say OK"}]}],
                "generationConfig": {"maxOutputTokens": 5}
            }
            resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=10)
            if resp.status_code == 200:
                return {"ok": True, "message": "Успешное подключение к Google Gemini API (модель gemini-1.5-flash активна)!"}
            else:
                return {"ok": False, "message": f"Gemini API вернул код {resp.status_code}: {resp.text[:120]}"}
        except Exception as e:
            return {"ok": False, "message": f"Сетевая ошибка при запросе к Gemini: {str(e)}"}

    return {"ok": False, "message": f"Неизвестный сервис для тестирования: {service}"}
