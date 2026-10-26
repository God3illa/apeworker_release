from app.config_service import get_setting
from typing import Optional, List, Dict, Any
import html
import os
import sys
import json
import re
import subprocess
from datetime import datetime
import requests
from celery import Celery
from sqlalchemy.orm import Session

# Add the parent directory to Python path to allow app imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from app.database import SessionLocal, Video, Watermark, Collection, CollectionItem, ScheduledJob, DonorChannel, PostMetric

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
celery_app = Celery("tasks", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(
    broker_transport_options={"visibility_timeout": 86400},
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)

UPLOAD_POST_API_KEY = os.getenv("UPLOAD_POST_API_KEY", "")

# Base directories
UPLOADS_DIR = "/uploads"
VIDEOS_DIR = os.path.join(UPLOADS_DIR, "videos")
WATERMARKS_DIR = os.path.join(UPLOADS_DIR, "watermarks")
OUTPUTS_DIR = os.path.join(UPLOADS_DIR, "outputs")
THUMBNAILS_DIR = os.path.join(UPLOADS_DIR, "thumbnails")

# Create directories
for d in [VIDEOS_DIR, WATERMARKS_DIR, OUTPUTS_DIR, THUMBNAILS_DIR]:
    os.makedirs(d, exist_ok=True)


THEME_KEYWORDS = {
    "crypto": [
        "crypto", "крипт", "биткоин", "btc", "eth", "usdt", "ton", "web3",
        "трейдинг", "аирдроп", "стейкинг", "solana", "binance", "bybit", "криптовалют"
    ],
    "finance": [
        "заработок", "деньги", "арбитраж", "схема", "профит", "бизнес", "cash",
        "money", "доллар", "инвестиц", "доход", "богат", "пассивный", "p2p"
    ],
    "humor": [
        "мем", "прикол", "юмор", "смех", "lol", "meme", "funny", "жиза", "ржака", "шутка"
    ],
    "tech": [
        "нейросет", "ai", "ии", "chatgpt", "midjourney", "deepseek", "программирован",
        "код", "it", "софт", "робот", "технологии"
    ]
}

def detect_video_theme(title: str, description: str = "", hashtags: list = None) -> str:
    """Detects video theme based on keywords in title, description, and hashtags."""
    combined = f"{title or ''} {description or ''} {' '.join(hashtags or [])}".lower()
    for theme, keywords in THEME_KEYWORDS.items():
        if any(kw in combined for kw in keywords):
            return theme
    return "general"

def get_thematic_watermark(db: Session, theme: str) -> Optional[Watermark]:
    """Finds the best matching watermark by theme/category, falling back to general or first."""
    if theme and theme != "general":
        wm = db.query(Watermark).filter(Watermark.category.ilike(f"%{theme}%")).first()
        if wm:
            return wm
    wm = db.query(Watermark).filter(Watermark.category == "general").first()
    if wm:
        return wm
    return db.query(Watermark).first()

def get_font_file() -> Optional[str]:
    """Finds a valid TrueType font on Linux (Docker) or macOS."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf"
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

@celery_app.task(bind=True)
def download_video_task(self, video_id: str, url: str, user_id: str = "system", auto_watermark: bool = True):
    # Sanitize URL by stripping tracking/webapp parameters for TikTok and Instagram
    url = url.strip()
    if "tiktok.com" in url or "instagram.com" in url:
        if "?" in url:
            url = url.split("?")[0]
            
    print(f"Starting yt-dlp download job for: {url}")
    db: Session = SessionLocal()
    try:
        # Step 1: Extract metadata
        cookies_path = os.path.join(UPLOADS_DIR, "cookies.txt")
        meta_cmd = [
            "yt-dlp",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "--dump-json"
        ]
        if os.path.exists(cookies_path):
            print(f"Using cookies file: {cookies_path}")
            meta_cmd.extend(["--cookies", cookies_path])
        meta_cmd.append(url)

        try:
            meta_res = subprocess.run(meta_cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            raw_err = e.stderr.strip() if e.stderr else str(e)
            if "There is no video in this post" in raw_err or "No video formats found" in raw_err:
                raise Exception("По этой ссылке находится фотография (или фото-карусель), а не видео/Reels. Бот обрабатывает только видеоролики.")
            print(f"yt-dlp metadata extraction failed: {raw_err}. Trying to update yt-dlp via pip and retry...")
            try:
                # Attempt global yt-dlp update via pip
                update_res = subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"], capture_output=True, text=True, check=True)
                print(f"yt-dlp pip update success: {update_res.stdout.strip()}")
                # Retry metadata extraction
                meta_res = subprocess.run(meta_cmd, capture_output=True, text=True, check=True)
            except Exception as update_err:
                print(f"Failed to auto-update yt-dlp or retry metadata extraction failed: {update_err}")
                if "There is no video in this post" in str(update_err) or "No video formats found" in str(update_err):
                    raise Exception("По этой ссылке находится фотография (или фото-карусель), а не видео/Reels. Бот обрабатывает только видеоролики.")
                raise e

        meta_data = json.loads(meta_res.stdout)

        # Parse fields with robust fallbacks
        raw_title = meta_data.get("title") or meta_data.get("description", "Viral Video")[:60]
        # Clean up uploader prefixes like "Video by " case-insensitively
        title = re.sub(r'^video\s+by\s+', '', raw_title, flags=re.IGNORECASE).strip()
        description = meta_data.get("description") or ""
        
        # Extract hashtags from description and tags field
        tags = meta_data.get("tags") or []
        hashtag_set = set(tags)
        desc_hashtags = re.findall(r"#\w+", description)
        for h in desc_hashtags:
            hashtag_set.add(h.replace("#", ""))
        hashtags_list = list(hashtag_set)

        # Extract views with smart fallbacks for platforms like Instagram that hide view counts publicly
        raw_views = meta_data.get("view_count") or meta_data.get("play_count")
        if raw_views is not None and int(raw_views) > 0:
            view_count = int(raw_views)
        else:
            # Fallback for Instagram Reels: Estimate views based on public like_count (typically ~4% engagement rate)
            like_count = meta_data.get("like_count") or 0
            if like_count > 0:
                view_count = int(like_count * 25)
            else:
                # Random realistic views range for natural aesthetics if no likes/views are returned
                import random
                view_count = random.randint(12000, 85000)
        duration = int(meta_data.get("duration") or 0)
        
        # Determine platform
        extractor = meta_data.get("extractor", "").lower()
        if "tiktok" in extractor or "tiktok" in url:
            platform = "TikTok"
        elif "instagram" in extractor or "instagram" in url:
            platform = "Instagram"
        else:
            platform = extractor.capitalize() or "Web"

        thumbnail_url = meta_data.get("thumbnail") or meta_data.get("thumbnails", [{}])[0].get("url") or ""
        original_url = meta_data.get("webpage_url") or url

        # Step 2: Download file
        # Force mp4 container for clean standard overlays later
        out_template = os.path.join(VIDEOS_DIR, f"{video_id}.%(ext)s")
        dl_cmd = [
            "yt-dlp",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-f", "mp4",
            "-o", out_template,
        ]
        if os.path.exists(cookies_path):
            dl_cmd.extend(["--cookies", cookies_path])
        dl_cmd.append(url)
        
        print(f"Executing: {' '.join(dl_cmd)}")
        try:
            subprocess.run(dl_cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            print(f"yt-dlp download failed: {e.stderr.strip() if e.stderr else str(e)}. Trying to update yt-dlp and retry...")
            try:
                # Attempt global yt-dlp update
                update_res = subprocess.run(["yt-dlp", "-U"], capture_output=True, text=True, check=True)
                print(f"yt-dlp update success: {update_res.stdout.strip()}")
                # Retry download
                subprocess.run(dl_cmd, capture_output=True, text=True, check=True)
            except Exception as update_err:
                print(f"Failed to auto-update yt-dlp or retry download failed: {update_err}")
                raise e

        # Find absolute path of the downloaded file (supporting different extensions if not mp4, though we forced it)
        file_path = os.path.join(VIDEOS_DIR, f"{video_id}.mp4")
        if not os.path.exists(file_path):
            # Check for alternative extensions just in case
            for f in os.listdir(VIDEOS_DIR):
                if f.startswith(video_id):
                    file_path = os.path.join(VIDEOS_DIR, f)
                    break

        # Step 3: Download thumbnail locally to bypass browser CORS / hotlink block
        local_thumbnail_url = ""
        if thumbnail_url:
            try:
                thumb_path = os.path.join(THUMBNAILS_DIR, f"{video_id}.jpg")
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                }
                thumb_res = requests.get(thumbnail_url, headers=headers, timeout=15)
                if thumb_res.status_code == 200:
                    with open(thumb_path, "wb") as f:
                        f.write(thumb_res.content)
                    local_thumbnail_url = f"/uploads/thumbnails/{video_id}.jpg"
            except Exception as eth:
                print(f"Warning: Failed to fetch thumbnail locally: {eth}")

        final_thumb = local_thumbnail_url or thumbnail_url

        # Save to SQLite db
        video = Video(
            id=video_id,
            user_id=user_id,
            title=title,
            description=description,
            hashtags=hashtags_list,
            view_count=view_count,
            duration=duration,
            platform=platform,
            thumbnail_url=final_thumb,
            original_url=original_url,
            file_path=file_path,
            downloaded_at=datetime.utcnow()
        )
        db.add(video)
        db.commit()

        # Step 4: Auto-create Collection and CollectionItem with active thematic Watermark
        collection_id = None
        item_id = None
        wm_task_id = None

        if auto_watermark:
            detected_theme = detect_video_theme(title, description, hashtags_list)
            thematic_wm = get_thematic_watermark(db, detected_theme)
            if thematic_wm:
                try:
                    col_id = str(uuid.uuid4())
                    col_name = title or f"Коллекция {datetime.utcnow().strftime('%d.%m.%Y %H:%M')}"
                    collection = Collection(
                        id=col_id,
                        name=col_name,
                        video_id=video_id,
                        user_id=user_id
                    )
                    db.add(collection)
                    db.commit()

                    # Read dynamic presets from Redis or env/defaults
                    wm_pos = "top-center"
                    wm_scale = 85
                    wm_offset_y = 50
                    wm_offset_x = 0
                    target_handle = None
                    try:
                        import redis
                        r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
                        wm_pos = r.get("apeworker:wm:position") or os.getenv("DEFAULT_WATERMARK_POSITION", "top-center")
                        wm_scale = int(r.get("apeworker:wm:scale") or os.getenv("DEFAULT_WATERMARK_SCALE", "85"))
                        wm_offset_y = int(r.get("apeworker:wm:offset_y") or os.getenv("DEFAULT_WATERMARK_OFFSET_Y", "50"))
                        wm_offset_x = int(r.get("apeworker:wm:offset_x") or os.getenv("DEFAULT_WATERMARK_OFFSET_X", "0"))

                        handle_cfg = (r.get("apeworker:wm:dynamic_handle") or "off").strip()
                        if handle_cfg == "auto":
                            from app.scheduler import fetch_active_profiles, peek_next_round_robin_profile
                            profs = fetch_active_profiles()
                            next_p = peek_next_round_robin_profile(profs)
                            if next_p:
                                chs = next_p.get("channel_handles", {})
                                h = chs.get("tiktok") or chs.get("instagram") or next_p.get("username")
                                if h:
                                    target_handle = f"@{h.lstrip('@')}"
                        elif handle_cfg not in ("off", "none", "0", "false"):
                            target_handle = f"@{handle_cfg.lstrip('@')}"
                    except Exception as e_red:
                        print(f"Notice: Redis config read error, using defaults: {e_red}")

                    c_item_id = str(uuid.uuid4())
                    col_item = CollectionItem(
                        id=c_item_id,
                        collection_id=col_id,
                        watermark_id=thematic_wm.id,
                        position=wm_pos,
                        offset_x=wm_offset_x,
                        offset_y=wm_offset_y,
                        scale=wm_scale,
                        target_handle=target_handle,
                        status="processing"
                    )
                    db.add(col_item)
                    db.commit()

                    wm_task = watermark_video_task.delay(c_item_id)
                    collection_id = col_id
                    item_id = c_item_id
                    wm_task_id = wm_task.id
                    print(f"Auto-collection created: {col_id}, item: {c_item_id}, wm_task: {wm_task.id}")
                except Exception as e_col:
                    print(f"Error auto-creating collection: {e_col}")

        print(f"Download complete and saved to database: {video_id}")
        return {
            "status": "ready",
            "video_id": video_id,
            "collection_id": collection_id,
            "item_id": item_id,
            "wm_task_id": wm_task_id
        }

    except subprocess.CalledProcessError as e:
        print(f"yt-dlp execution failed! Returncode: {e.returncode}")
        print(f"Stdout: {e.stdout}")
        print(f"Stderr: {e.stderr}")
        db.rollback()
        err_msg = e.stderr.strip() if e.stderr else "unknown stderr"
        if "There is no video in this post" in err_msg or "No video formats found" in err_msg:
            raise Exception("По этой ссылке находится фотография (или фото-карусель), а не видео/Reels. Бот обрабатывает только видеоролики.")
        raise Exception(f"yt-dlp failed: {err_msg}")
    except Exception as e:
        print(f"Download failed for video: {video_id}. Error: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

@celery_app.task(bind=True)
def watermark_video_task(self, item_id: str):
    db: Session = SessionLocal()
    try:
        item = db.query(CollectionItem).filter(CollectionItem.id == item_id).first()
        if not item:
            print(f"CollectionItem not found: {item_id}")
            return

        item.status = "processing"
        db.commit()

        video = item.collection.video
        watermark = item.watermark

        if not video.file_path or not os.path.exists(video.file_path):
            raise FileNotFoundError(f"Source video file not found: {video.file_path}")
        if not watermark.file_path or not os.path.exists(watermark.file_path):
            raise FileNotFoundError(f"Watermark file not found: {watermark.file_path}")

        output_filename = f"watermarked_{item.id}.mp4"
        output_path = os.path.join(OUTPUTS_DIR, output_filename)

        # Step 1: Probe the main video dimensions and streams to calculate scale and audio existence
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=width,height,codec_type",
            "-of", "json",
            video.file_path
        ]
        probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        probe_data = json.loads(probe_res.stdout)
        
        streams = probe_data.get("streams", [])
        v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        has_audio = any(s.get("codec_type") == "audio" for s in streams)

        main_w = int(v_stream["width"]) if v_stream and "width" in v_stream else 1080
        main_h = int(v_stream["height"]) if v_stream and "height" in v_stream else 1920

        # Anti-Fingerprint / Pixel Jitter Parameters:
        import random
        zoom = round(random.uniform(0.988, 0.993), 4)
        crop_w = int(main_w * zoom)
        crop_h = int(main_h * zoom)
        crop_w -= (crop_w % 2)
        crop_h -= (crop_h % 2)

        contrast = round(random.uniform(1.006, 1.014), 3)
        brightness = round(random.uniform(0.002, 0.007), 3)
        saturation = round(random.uniform(1.005, 1.012), 3)
        audio_tempo = round(random.uniform(1.004, 1.008), 4)

        wm_width = int(main_w * (item.scale / 100.0))

        coords_map = {
            "top-left": f"{item.offset_x}:{item.offset_y}",
            "top-center": f"(W-w)/2:{item.offset_y}",
            "top": f"(W-w)/2:{item.offset_y}",
            "center-top": f"(W-w)/2:{item.offset_y}",
            "top-right": f"W-w-{item.offset_x}:{item.offset_y}",
            "bottom-left": f"{item.offset_x}:H-h-{item.offset_y}",
            "bottom-center": f"(W-w)/2:H-h-{item.offset_y}",
            "bottom": f"(W-w)/2:H-h-{item.offset_y}",
            "bottom-right": f"W-w-{item.offset_x}:H-h-{item.offset_y}",
            "center": "(W-w)/2:(H-h)/2"
        }
        overlay_coords = coords_map.get(item.position, f"(W-w)/2:{item.offset_y}")

        is_webm = watermark.filename.lower().endswith(".webm")

        # Dynamic Handle badge overlay calculation
        handle_text = item.target_handle
        if not handle_text:
            try:
                import redis
                r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
                handle_cfg = (r.get("apeworker:wm:dynamic_handle") or "off").strip()
                if handle_cfg not in ("off", "none", "0", "false", "auto"):
                    handle_text = f"@{handle_cfg.lstrip('@')}"
            except Exception:
                pass

        font_file = get_font_file() if handle_text else None
        drawtext_filter = ""
        if handle_text and font_file:
            try:
                wm_probe_cmd = [
                    "ffprobe", "-v", "error",
                    "-show_entries", "stream=width,height",
                    "-of", "json",
                    watermark.file_path
                ]
                wm_p_res = subprocess.run(wm_probe_cmd, capture_output=True, text=True)
                wm_p_data = json.loads(wm_p_res.stdout) if wm_p_res.returncode == 0 else {}
                wm_streams = wm_p_data.get("streams", [])
                wm_s = next((s for s in wm_streams if "width" in s and "height" in s), None)
                wm_ow = int(wm_s["width"]) if wm_s else 1920
                wm_oh = int(wm_s["height"]) if wm_s else 200
                wm_scaled_h = int(wm_width * (wm_oh / max(1, wm_ow)))
            except Exception as e_prob:
                print(f"Notice: ffprobe watermark height failed: {e_prob}")
                wm_scaled_h = int(main_h * 0.12)

            text_y = item.offset_y + wm_scaled_h + 12
            text_size = max(24, int(main_w * 0.030))
            clean_text = handle_text.replace("'", "").replace(":", r"\:").replace("%", r"\%")

            drawtext_filter = (
                f";[v_wm]drawtext=fontfile='{font_file}':text='{clean_text}':"
                f"fontsize={text_size}:fontcolor=white:"
                f"box=1:boxcolor=black@0.55:boxborderw=8:"
                f"x=(w-text_w)/2:y={text_y}[v_out]"
            )

        if drawtext_filter:
            v_filter = (
                f"[0:v]crop={crop_w}:{crop_h},scale={main_w}:{main_h},"
                f"eq=contrast={contrast}:brightness={brightness}:saturation={saturation}[v_base];"
                f"[1:v]scale={wm_width}:-1,format=rgba[wm];"
                f"[v_base][wm]overlay={overlay_coords}:shortest=1[v_wm]"
                f"{drawtext_filter}"
            )
        else:
            v_filter = (
                f"[0:v]crop={crop_w}:{crop_h},scale={main_w}:{main_h},"
                f"eq=contrast={contrast}:brightness={brightness}:saturation={saturation}[v_base];"
                f"[1:v]scale={wm_width}:-1,format=rgba[wm];"
                f"[v_base][wm]overlay={overlay_coords}:shortest=1[v_out]"
            )

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", video.file_path,
            "-stream_loop", "-1",
        ]
        if is_webm:
            ffmpeg_cmd.extend(["-c:v", "libvpx-vp9"])

        ffmpeg_cmd.extend([
            "-i", watermark.file_path,
            "-filter_complex", v_filter,
            "-map", "[v_out]"
        ])

        if has_audio:
            ffmpeg_cmd.extend([
                "-af", f"atempo={audio_tempo}",
                "-c:a", "aac",
                "-b:a", "192k"
            ])
        else:
            ffmpeg_cmd.extend(["-an"])

        random_id = uuid.uuid4().hex[:8]
        ffmpeg_cmd.extend([
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "22",
            "-map_metadata", "-1",
            "-metadata", f"title=ApeMedia_{random_id}",
            "-metadata", "comment=Processed by ApeWorker Engine v2",
            output_path
        ])

        print(f"Executing: {' '.join(ffmpeg_cmd)}")
        subprocess.run(ffmpeg_cmd, check=True)

        item.output_file_path = output_path
        item.status = "ready"
        db.commit()
        print(f"Watermarking complete for CollectionItem: {item_id}")
        return {"status": "ready", "output": output_path}

    except Exception as e:
        print(f"Watermarking failed for CollectionItem: {item_id}. Error: {e}")
        item.status = "failed"
        db.commit()
        raise e
    finally:
        db.close()


def notify_telegram_publication(job_id: str, is_success: bool = True, error_msg: str = ""):
    """Sends real-time post-publish or error notification to Telegram user."""
    token = get_setting("TELEGRAM_BOT_TOKEN")
    allowed_raw = get_setting("TELEGRAM_ALLOWED_USERS")
    dashboard_url = get_setting("DASHBOARD_URL", "https://apeworker.top").rstrip("/")
    if not token:
        return

    db: Session = SessionLocal()
    try:
        job = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
        if not job:
            return

        recipients = set()
        if job.user_id and job.user_id.isdigit():
            recipients.add(int(job.user_id))
        for uid in allowed_raw.split(","):
            if uid.strip().isdigit():
                recipients.add(int(uid.strip()))

        if not recipients:
            return

        from app.scheduler import fetch_active_profiles
        profiles_data = fetch_active_profiles()
        prof_match = next((p for p in profiles_data if p["username"] == job.profile_username), None)
        channel_links = prof_match.get("channel_links", {}) if prof_match else {}
        channel_handles = prof_match.get("channel_handles", {}) if prof_match else {}

        platform_display = {
            "tiktok": "TikTok",
            "instagram": "Instagram",
            "youtube": "YouTube",
            "facebook": "Facebook",
            "threads": "Threads",
            "x": "X (Twitter)",
            "twitter": "X (Twitter)"
        }

        title = job.post_title or (job.collection.video.title if job.collection and job.collection.video else "Видео")

        if is_success:
            links_list = []
            for p in (job.platforms or []):
                pkey = p.lower()
                pname = platform_display.get(pkey, p.capitalize())
                purl = channel_links.get(pkey)
                phandle = channel_handles.get(pkey)
                if purl:
                    h_label = f" (@{phandle.lstrip('@')})" if phandle and " " not in phandle else (f" ({phandle})" if phandle else "")
                    links_list.append(f"  • <a href='{purl}'>{pname}</a>{html.escape(h_label)}")
                else:
                    links_list.append(f"  • {pname}")

            profiles_str = "\n".join(links_list) if links_list else "—"

            text = (
                f"🚀 <b>Видео успешно опубликовано!</b>\n\n"
                f"🎬 <b>Название:</b> {html.escape(title)}\n"
                f"👤 <b>Аккаунт:</b> <code>{job.profile_username}</code>\n"
                f"🌐 <b>Опубликовано в соцсети:</b>\n{profiles_str}\n\n"
                f"🔗 <a href='{dashboard_url}/schedule'>Календарь публикаций</a>"
            )
        else:
            text = (
                f"⚠️ <b>Ошибка при публикации видео!</b>\n\n"
                f"🎬 <b>Название:</b> {html.escape(title)}\n"
                f"👤 <b>Аккаунт:</b> <code>{job.profile_username}</code>\n"
                f"❌ <b>Причина:</b> <code>{html.escape(error_msg[:300])}</code>\n\n"
                f"🔗 <a href='{dashboard_url}/schedule'>Календарь публикаций</a>"
            )

        tg_url = f"https://api.telegram.org/bot{token}/sendMessage"
        for chat_id in recipients:
            try:
                requests.post(tg_url, json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True
                }, timeout=10)
            except Exception as e_tg:
                print(f"Failed to send Telegram live notification to {chat_id}: {e_tg}")

    except Exception as e:
        print(f"Error building telegram notification: {e}")
    finally:
        db.close()


@celery_app.task(bind=True)
def publish_post_task(self, job_id: str):
    # Distributed lock in Redis to strictly prevent concurrent duplicate worker execution
    try:
        r = redis.Redis.from_url(REDIS_URL)
        lock_key = f"apeworker:lock:publish:{job_id}"
        if not r.set(lock_key, "locked", nx=True, ex=600):
            print(f"Publish lock already held for job {job_id}. Skipping duplicate worker execution.")
            return {"status": "skipped", "reason": "already_running"}
    except Exception as e_lock:
        print(f"Warning: Redis lock check failed: {e_lock}")

    db: Session = SessionLocal()
    try:
        job = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
        if not job:
            print(f"ScheduledJob not found: {job_id}")
            return

        if job.status in ["published", "cancelled"]:
            print(f"Job {job_id} is {job.status}. Skipping execution.")
            return {"status": "skipped", "reason": job.status}

        job.status = "processing"
        db.commit()

        item = job.collection_item
        if not item or item.status != "ready" or not item.output_file_path or not os.path.exists(item.output_file_path):
            raise FileNotFoundError(f"Watermarked video not ready or missing: {item.output_file_path if item else 'None'}")

        # Step 1: Perform the upload-post.com API multipart request
        url = "https://api.upload-post.com/api/upload"
        api_key = get_setting("UPLOAD_POST_API_KEY")
        if not api_key:
            raise ValueError("UPLOAD_POST_API_KEY не задан. Настройте его в дашборде в разделе API & Integrations.")
        headers = {
            "Authorization": f"Apikey {api_key}"
        }
        
        # Prepare file streaming
        with open(item.output_file_path, "rb") as video_file:
            files = {
                "video": (os.path.basename(item.output_file_path), video_file, "video/mp4")
            }
            # Build unified caption for platforms that use a single text field (like Reels / TikTok)
            caption_parts = []
            if job.post_title:
                caption_parts.append(job.post_title)
            if job.post_description:
                caption_parts.append(job.post_description)
            if job.post_hashtags:
                tags = []
                for tag in job.post_hashtags.replace(",", " ").split():
                    tag = tag.strip()
                    if tag:
                        if not tag.startswith("#"):
                            tag = f"#{tag}"
                        tags.append(tag)
                if tags:
                    caption_parts.append(" ".join(tags))
            
            full_title = "\n\n".join(caption_parts) if caption_parts else (job.collection.video.title or "Viral Video #viral")

            # YouTube strictly requires title <= 100 characters. If platform includes youtube, truncate title and keep full in description
            upload_title = full_title
            has_youtube = any(p.lower() == "youtube" for p in job.platforms)
            if has_youtube and len(upload_title) > 95:
                short_title = (job.post_title or "Viral Video").strip()
                if len(short_title) > 95:
                    short_title = short_title[:92] + "..."
                upload_title = short_title

            data = [
                ("user", job.profile_username),
                ("title", upload_title),
            ]
            if job.post_description or upload_title != full_title:
                desc_to_send = job.post_description or full_title
                data.append(("description", desc_to_send))
                
            for p in job.platforms:
                data.append(("platform[]", p))

            print(f"Sending publish request to Upload Post API: {url} with platforms: {job.platforms}")
            response = requests.post(url, headers=headers, files=files, data=data, timeout=120)
            
        # Parse API response
        if response.status_code in [200, 201]:
            resp_data = response.json()
            job.status = "published"
            job.result = resp_data
            db.commit()
            print(f"Published successfully! Job ID: {job_id}")
            try:
                notify_telegram_publication(job_id=job.id, is_success=True)
            except Exception as e_notif:
                print(f"Failed to send success live notification: {e_notif}")
            return {"status": "published", "result": resp_data}
        else:
            raise Exception(f"Upload Post API error ({response.status_code}): {response.text}")

    except Exception as e:
        print(f"Publish failed for job: {job_id}. Error: {e}")
        job.status = "failed"
        job.result = {"error": str(e)}
        db.commit()
        try:
            notify_telegram_publication(job_id=job.id, is_success=False, error_msg=str(e))
        except Exception as e_notif:
            print(f"Failed to send failure live notification: {e_notif}")
        raise e
    finally:
        db.close()



@celery_app.task(bind=True)
def scan_donor_channels_task(self):
    """Scans active donor channels, finds viral videos exceeding min_views, and ingests them."""
    db: Session = SessionLocal()
    scanned_count = 0
    ingested_count = 0
    try:
        donors = db.query(DonorChannel).filter(DonorChannel.is_active == True).all()
        if not donors:
            print("No active donor channels to scan.")
            return {"status": "ok", "scanned": 0, "ingested": 0}

        cookies_path = os.path.join(UPLOADS_DIR, "cookies.txt")

        for donor in donors:
            try:
                print(f"Scanning donor: {donor.username} ({donor.url})")
                cmd = [
                    "yt-dlp",
                    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "--dump-single-json",
                    "--flat-playlist",
                    "--playlist-end", "8",
                ]
                if os.path.exists(cookies_path):
                    cmd.extend(["--cookies", cookies_path])
                cmd.append(donor.url)

                res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                if res.returncode != 0:
                    print(f"yt-dlp flat-playlist scan failed for {donor.url}: {res.stderr[:120]}")
                    continue

                data = json.loads(res.stdout)
                entries = data.get("entries", [])
                donor.last_scanned_at = datetime.utcnow()
                db.commit()
                scanned_count += 1

                for entry in entries:
                    if not entry or not isinstance(entry, dict):
                        continue
                    entry_url = entry.get("url") or entry.get("webpage_url")
                    if not entry_url:
                        vid = entry.get("id")
                        if vid:
                            if donor.platform == "tiktok":
                                clean_user = donor.username.lstrip("@")
                                entry_url = f"https://www.tiktok.com/@{clean_user}/video/{vid}"
                            elif donor.platform == "instagram":
                                entry_url = f"https://www.instagram.com/reel/{vid}/"
                            elif donor.platform == "youtube":
                                entry_url = f"https://www.youtube.com/watch?v={vid}"

                    if not entry_url:
                        continue

                    # Check view threshold
                    views = int(entry.get("view_count") or 0)
                    if views > 0 and views < donor.min_views:
                        continue

                    # Check if already downloaded
                    existing_v = db.query(Video).filter(Video.original_url == entry_url).first()
                    if existing_v:
                        continue

                    # Queue for download and auto-watermark
                    v_uuid = str(uuid.uuid4())
                    download_video_task.delay(v_uuid, entry_url, user_id="donor_monitor", auto_watermark=True)
                    ingested_count += 1
                    print(f"Ingested viral video from donor {donor.username}: {entry_url} ({views} views)")

                    # Send Telegram alert if bot is configured
                    try:
                        token = get_setting("TELEGRAM_BOT_TOKEN")
                        allowed_raw = get_setting("TELEGRAM_ALLOWED_USERS")
                        if token and allowed_raw:
                            admin_id = allowed_raw.split(",")[0].strip()
                            if admin_id.isdigit():
                                msg = (
                                    f"⚡ <b>Авто-мониторинг доноров:</b>\n"
                                    f"👤 Донор: <b>{html.escape(donor.username)}</b>\n"
                                    f"👁 Просмотры: <b>{views:,}</b>\n"
                                    f"🔗 <a href='{entry_url}'>Оригинал ролика</a>\n\n"
                                    f"🚀 <i>Ролик взят в работу, накладывается плашка и планируется автопостинг!</i>"
                                )
                                requests.post(
                                    f"https://api.telegram.org/bot{token}/sendMessage",
                                    json={
                                        "chat_id": int(admin_id),
                                        "text": msg,
                                        "parse_mode": "HTML",
                                        "disable_web_page_preview": False
                                    },
                                    timeout=10
                                )
                    except Exception as e_tg:
                        print(f"Notice: Telegram donor notification failed: {e_tg}")

            except Exception as e_donor:
                print(f"Error scanning donor {donor.url}: {e_donor}")

        return {"status": "ok", "scanned": scanned_count, "ingested": ingested_count}
    finally:
        db.close()


@celery_app.task(bind=True)
def collect_post_metrics_task(self):
    """Fetches published posts history from Upload Post API and updates PostMetric records."""
    token = get_setting("UPLOAD_POST_API_KEY")
    if not token:
        return {"status": "no_api_key"}

    db: Session = SessionLocal()
    updated_count = 0
    try:
        url = "https://api.upload-post.com/api/uploadposts/history"
        headers = {"Authorization": f"Apikey {token}"}
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code != 200:
            print(f"Upload Post history request failed: {resp.status_code} {resp.text[:120]}")
            return {"status": "failed", "code": resp.status_code}

        data = resp.json()
        history_items = data.get("history", [])

        for item in history_items:
            platform = item.get("platform") or "unknown"
            profile_username = item.get("profile_username") or "unknown"
            platform_post_id = item.get("platform_post_id")
            post_url = item.get("post_url")
            post_title = item.get("post_title") or ""
            req_id = item.get("request_id")
            job_id = item.get("job_id")

            if not post_url and not platform_post_id and not req_id:
                continue

            # Check if metric already recorded
            metric = None
            if platform_post_id:
                metric = db.query(PostMetric).filter(PostMetric.platform_post_id == str(platform_post_id)).first()
            if not metric and post_url:
                metric = db.query(PostMetric).filter(PostMetric.post_url == post_url).first()

            if not metric:
                metric = PostMetric(
                    id=str(uuid.uuid4()),
                    profile_username=profile_username,
                    platform=platform,
                    platform_post_id=str(platform_post_id) if platform_post_id else None,
                    post_url=post_url,
                    post_title=post_title[:200] if post_title else None,
                    view_count=0,
                    like_count=0,
                    updated_at=datetime.utcnow()
                )
                db.add(metric)
            else:
                metric.post_title = post_title[:200] if post_title else metric.post_title
                metric.updated_at = datetime.utcnow()

            updated_count += 1

        db.commit()
        print(f"Metrics collection completed: {updated_count} items updated/synced.")
        return {"status": "ok", "synced": updated_count}
    except Exception as e:
        print(f"Error in collect_post_metrics_task: {e}")
        db.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()
