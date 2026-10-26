import os
import re
import json
import logging
import requests
import redis
from typing import Dict, Any, Optional

logger = logging.getLogger("apeworker_ai")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

def get_redis_client():
    return redis.Redis.from_url(REDIS_URL, decode_responses=True)

def get_ai_api_key() -> Optional[str]:
    """Retrieves AI API key from config service, Redis or environment variables."""
    try:
        from app.config_service import get_setting
        key = get_setting("GEMINI_API_KEY")
        if key:
            return key
    except Exception:
        pass
    try:
        r = get_redis_client()
        key = r.get("apeworker:config:gemini_api_key")
        if key:
            return key.strip()
    except Exception as e:
        logger.warning(f"Could not read AI key from Redis: {e}")
    return os.getenv("GEMINI_API_KEY", "").strip() or None

def set_ai_api_key(key: str) -> bool:
    """Stores AI API key in Redis."""
    try:
        r = get_redis_client()
        r.set("apeworker:config:gemini_api_key", key.strip())
        return True
    except Exception as e:
        logger.error(f"Failed to store AI key in Redis: {e}")
        return False

def clean_raw_title(raw_title: str) -> str:
    """Removes platform artifacts, handles, URLs, and excess hashtags."""
    if not raw_title:
        return "Вирусный ролик"
    # Remove URLs
    text = re.sub(r'https?://\S+', '', raw_title)
    # Remove @mentions
    text = re.sub(r'@\w+', '', text)
    # Remove hashtags from title body
    text = re.sub(r'#\w+', '', text)
    # Clean whitespace and weird punctuation
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) > 3 else "Вирусный ролик"

def fallback_rewrite(raw_title: str, raw_description: str = "", existing_hashtags: list = None) -> Dict[str, Any]:
    """Rule-based smart rewriter used when AI API key is missing or unavailable."""
    base_title = clean_raw_title(raw_title)
    if len(base_title) > 85:
        base_title = base_title[:82].rstrip() + "..."
    
    # Generate engaging description
    desc = raw_description.strip() if raw_description else base_title
    if len(desc) > 300:
        desc = desc[:297].rstrip() + "..."
        
    cta = "Оцени видео от 1 до 10 в комментариях! 👇"
    full_desc = f"{desc}\n\n{cta}" if desc else cta
    
    # Curate viral tags
    tags = list(existing_hashtags) if existing_hashtags else []
    default_tags = ["viral", "reels", "shorts", "trending", "fyp"]
    for t in default_tags:
        if t not in tags:
            tags.append(t)
            
    return {
        "title": base_title,
        "description": full_desc,
        "hashtags": tags[:8],
        "ai_powered": False
    }

def rewrite_video_metadata(raw_title: str, raw_description: str = "", hashtags: list = None) -> Dict[str, Any]:
    """
    Rewrites video title, description, and hashtags using Gemini AI (or fallback).
    Ensures title is strictly <= 90 characters for YouTube Shorts / TikTok compatibility.
    """
    api_key = get_ai_api_key()
    if not api_key:
        logger.info("No Gemini API key configured. Using smart rule-based fallback.")
        return fallback_rewrite(raw_title, raw_description, hashtags)

    prompt = f"""
Ты профессиональный SMM-копирайтер вирусных коротких видео (Reels, TikTok, YouTube Shorts).
Твоя задача — адаптировать метаданные ролика для максимального CTR и удержания внимания.

Исходные данные:
Название: {raw_title}
Описание: {raw_description}
Текущие хэштеги: {', '.join(hashtags or [])}

Требования:
1. "title": Короткий, цепляющий хук / заголовок ролика на русском языке. СТРОГО до 85 символов! Используй интригу, вопрос или эмоциональный триггер. Добавь 1 подходящий эмодзи.
2. "description": Вовлекающий текст (2-3 предложения) на русском языке с призывом оставить комментарий или подписаться (CTA).
3. "hashtags": Массив из 5-7 вирусных хэштегов (без знака #, на латинице или кириллице) по теме видео.

Верни строго чистый JSON без markdown-блоков (без ```json):
{{
  "title": "...",
  "description": "...",
  "hashtags": ["...", "..."]
}}
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 500
        }
    }

    try:
        res = requests.post(url, headers=headers, json=payload, timeout=12)
        if res.ok:
            data = res.json()
            candidates = data.get("candidates", [])
            if candidates:
                raw_text = candidates[0]["content"]["parts"][0]["text"].strip()
                # Strip markdown json codeblocks if any
                clean_json_str = re.sub(r'^```json\s*|\s*```$', '', raw_text, flags=re.MULTILINE).strip()
                parsed = json.loads(clean_json_str)
                
                title = parsed.get("title", "").strip()
                if not title or len(title) > 90:
                    title = title[:87] + "..." if title else clean_raw_title(raw_title)
                    
                desc = parsed.get("description", "").strip()
                out_tags = parsed.get("hashtags", [])
                
                logger.info(f"AI rewrite successful: {title}")
                return {
                    "title": title,
                    "description": desc,
                    "hashtags": out_tags[:8],
                    "ai_powered": True
                }
        else:
            logger.warning(f"Gemini API returned error {res.status_code}: {res.text[:200]}")
    except Exception as e:
        logger.error(f"Error during AI metadata rewrite: {e}")

    return fallback_rewrite(raw_title, raw_description, hashtags)
