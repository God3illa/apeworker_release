from app.config_service import get_setting
import os
import random
import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Dict, List, Optional, Any

import redis
import requests
from sqlalchemy.orm import Session

from app.database import SessionLocal, ScheduledJob, CollectionItem, User

logger = logging.getLogger("apeworker_scheduler")

KYIV_TZ = ZoneInfo("Europe/Kyiv")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
UPLOAD_POST_API_KEY = os.getenv("UPLOAD_POST_API_KEY", "")

# 3 posting windows per day
SLOTS = [
    ("Утро (08:00–10:00)", time(8, 0), time(10, 0)),
    ("День (12:00–14:00)", time(12, 0), time(14, 0)),
    ("Вечер (18:00–21:00)", time(18, 0), time(21, 0)),
]

def get_redis_client():
    return redis.Redis.from_url(REDIS_URL, decode_responses=True)

def fetch_active_profiles() -> List[Dict[str, Any]]:
    """Fetch profiles and their connected active platforms from Upload Post API."""
    api_key = get_setting("UPLOAD_POST_API_KEY")
    if not api_key:
        logger.warning("UPLOAD_POST_API_KEY not configured. Cannot fetch active profiles.")
        return []
    url = "https://api.upload-post.com/api/uploadposts/users"
    headers = {"Authorization": f"Apikey {api_key}"}
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.ok:
            data = res.json()
            profiles = []
            for p in data.get("profiles", []):
                if p.get("blocked", False):
                    continue
                username = p.get("username")
                socials = p.get("social_accounts") or {}
                active_platforms = []
                channel_links = {}
                channel_handles = {}
                for platform_name, details in socials.items():
                    if isinstance(details, dict):
                        active_platforms.append(platform_name)
                        handle = (details.get("handle") or details.get("username") or "").lstrip("@").strip()
                        display_name = details.get("display_name") or handle
                        url = details.get("url") or ""
                        if not url and handle:
                            if platform_name == "tiktok":
                                url = f"https://www.tiktok.com/@{handle}"
                            elif platform_name == "instagram":
                                url = f"https://www.instagram.com/{handle}/"
                            elif platform_name == "youtube":
                                url = f"https://www.youtube.com/@{handle}"
                            elif platform_name == "threads":
                                url = f"https://www.threads.net/@{handle}"
                            elif platform_name in ["x", "twitter"]:
                                url = f"https://x.com/{handle}"
                            elif platform_name == "facebook":
                                url = f"https://www.facebook.com/search/top?q={handle}"
                        if url:
                            channel_links[platform_name] = url
                        if handle or display_name:
                            channel_handles[platform_name] = handle or display_name

                if username and active_platforms:
                    profiles.append({
                        "username": username,
                        "platforms": active_platforms,
                        "channel_links": channel_links,
                        "channel_handles": channel_handles
                    })
            if profiles:
                def sort_key(x):
                    u = x["username"]
                    if u.startswith("Acc_") and u[4:].isdigit():
                        return int(u[4:])
                    return 999
                profiles.sort(key=sort_key)
                return profiles
    except Exception as e:
        logger.error(f"Error fetching profiles from Upload Post: {e}")

    # Fallback default profiles Acc_1 to Acc_15
    return [
        {"username": f"Acc_{i}", "platforms": ["tiktok", "instagram", "youtube", "facebook"]}
        for i in range(1, 16)
    ]

def get_next_round_robin_profile(profiles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Select the next profile using Round-Robin preserved in Redis."""
    if not profiles:
        return {"username": "Acc_1", "platforms": ["tiktok", "instagram"]}
    
    try:
        r = get_redis_client()
        last_index = r.get("apeworker:schedule:last_account_index")
        idx = (int(last_index) + 1) if last_index is not None else 0
        idx = idx % len(profiles)
        r.set("apeworker:schedule:last_account_index", idx)
        return profiles[idx]
    except Exception as e:
        logger.warning(f"Error accessing Redis for round-robin: {e}")
        return profiles[0]

def peek_next_round_robin_profile(profiles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Peek the next profile without advancing the round-robin index."""
    if not profiles:
        return {"username": "Acc_1", "platforms": ["tiktok", "instagram"]}
    try:
        r = get_redis_client()
        last_index = r.get("apeworker:schedule:last_account_index")
        idx = (int(last_index) + 1) if last_index is not None else 0
        idx = idx % len(profiles)
        return profiles[idx]
    except Exception as e:
        logger.warning(f"Error accessing Redis for round-robin peek: {e}")
        return profiles[0]

def find_next_slot_for_account(db: Session, account_username: str) -> Dict[str, Any]:
    """Find the next available time slot for this account adhering to the 3-post daily rule."""
    now_kyiv = datetime.now(KYIV_TZ)
    
    cutoff_utc = (now_kyiv - timedelta(days=1)).astimezone(timezone.utc).replace(tzinfo=None)
    jobs = db.query(ScheduledJob).filter(
        ScheduledJob.profile_username == account_username,
        ScheduledJob.status.in_(["pending", "published"]),
        ScheduledJob.scheduled_at >= cutoff_utc
    ).all()

    existing_times_kyiv = []
    for j in jobs:
        if j.scheduled_at:
            dt_utc = j.scheduled_at.replace(tzinfo=timezone.utc)
            existing_times_kyiv.append(dt_utc.astimezone(KYIV_TZ))

    for day_offset in range(30):
        target_date = now_kyiv.date() + timedelta(days=day_offset)
        
        for slot_label, slot_start_time, slot_end_time in SLOTS:
            start_dt = datetime.combine(target_date, slot_start_time, tzinfo=KYIV_TZ)
            end_dt = datetime.combine(target_date, slot_end_time, tzinfo=KYIV_TZ)

            occupied = False
            for job_dt in existing_times_kyiv:
                if job_dt.date() == target_date and slot_start_time <= job_dt.time() < slot_end_time:
                    occupied = True
                    break

            if occupied:
                continue

            min_possible = start_dt
            if target_date == now_kyiv.date():
                min_possible = max(start_dt, now_kyiv + timedelta(minutes=5))
                if min_possible >= end_dt:
                    continue

            tot_seconds = int((end_dt - min_possible).total_seconds())
            if tot_seconds <= 60:
                chosen_dt = min_possible.replace(second=0, microsecond=0)
            else:
                rand_s = random.randint(0, tot_seconds - 60)
                chosen_dt = (min_possible + timedelta(seconds=rand_s)).replace(second=0, microsecond=0)

            chosen_utc = chosen_dt.astimezone(timezone.utc).replace(tzinfo=None)

            return {
                "account": account_username,
                "slot_label": slot_label,
                "scheduled_at_kyiv": chosen_dt,
                "scheduled_at_utc": chosen_utc
            }

    fallback_dt = (now_kyiv + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    return {
        "account": account_username,
        "slot_label": "Утро (08:00–10:00)",
        "scheduled_at_kyiv": fallback_dt,
        "scheduled_at_utc": fallback_dt.astimezone(timezone.utc).replace(tzinfo=None)
    }

def auto_schedule_collection_item(db: Session, item_id: str, user_id: str = "system") -> Optional[Dict[str, Any]]:
    """Schedules a ready CollectionItem to the next Round-Robin account and available slot."""
    item = db.query(CollectionItem).filter(CollectionItem.id == item_id).first()
    if not item:
        logger.error(f"CollectionItem not found: {item_id}")
        return None

    profiles = fetch_active_profiles()
    chosen_profile = get_next_round_robin_profile(profiles)
    username = chosen_profile["username"]
    platforms = chosen_profile["platforms"]

    slot_info = find_next_slot_for_account(db, username)
    scheduled_utc = slot_info["scheduled_at_utc"]

    video = item.collection.video if item.collection else None
    from app.ai_rewriter import rewrite_video_metadata
    raw_title = video.title if video else "Viral Video"
    raw_desc = video.description if video else ""
    raw_tags = video.hashtags if video else []
    
    meta = rewrite_video_metadata(raw_title, raw_desc, raw_tags)
    title = meta["title"]
    description = meta["description"]
    hashtags = " ".join([f"#{h.lstrip('#')}" for h in (meta["hashtags"] or [])])

    job = ScheduledJob(
        user_id=user_id,
        collection_id=item.collection_id,
        collection_item_id=item.id,
        profile_username=username,
        platforms=platforms,
        scheduled_at=scheduled_utc,
        status="pending",
        post_title=title,
        post_description=description,
        post_hashtags=hashtags
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        from app.tasks import publish_post_task
        publish_post_task.apply_async(args=[job.id], eta=scheduled_utc.replace(tzinfo=timezone.utc))
        logger.info(f"ScheduledJob created: {job.id} for {username} at {slot_info['scheduled_at_kyiv']}")
    except Exception as e_cel:
        logger.error(f"Failed to queue Celery ETA task: {e_cel}")

    return {
        "job_id": job.id,
        "account": username,
        "platforms": platforms,
        "channel_links": chosen_profile.get("channel_links", {}),
        "channel_handles": chosen_profile.get("channel_handles", {}),
        "slot_label": slot_info["slot_label"],
        "scheduled_at_kyiv": slot_info["scheduled_at_kyiv"],
        "scheduled_at_utc": scheduled_utc
    }


def reschedule_job(db: Session, job_id: str, new_slot_idx: Optional[int] = None, new_account: Optional[str] = None, add_days: int = 0) -> Optional[Dict[str, Any]]:
    """Reschedules a ScheduledJob to a different account, slot or date with a new Celery ETA."""
    job = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
    if not job or job.status == "published":
        return None

    profiles = fetch_active_profiles()
    
    if new_account:
        prof = next((p for p in profiles if p["username"] == new_account), None)
        if prof:
            job.profile_username = new_account
            job.platforms = prof["platforms"]

    current_kyiv = job.scheduled_at.replace(tzinfo=timezone.utc).astimezone(KYIV_TZ)
    target_date = current_kyiv.date() + timedelta(days=add_days)

    now_kyiv = datetime.now(KYIV_TZ)
    if target_date < now_kyiv.date():
        target_date = now_kyiv.date()

    if new_slot_idx is not None and 0 <= new_slot_idx < len(SLOTS):
        slot_label, slot_start, slot_end = SLOTS[new_slot_idx]
    else:
        slot_label, slot_start, slot_end = SLOTS[0]
        for s_lbl, s_start, s_end in SLOTS:
            if s_start <= current_kyiv.time() < s_end:
                slot_label, slot_start, slot_end = s_lbl, s_start, s_end
                break

    start_dt = datetime.combine(target_date, slot_start, tzinfo=KYIV_TZ)
    end_dt = datetime.combine(target_date, slot_end, tzinfo=KYIV_TZ)

    min_possible = start_dt
    if target_date == now_kyiv.date():
        min_possible = max(start_dt, now_kyiv + timedelta(minutes=5))
        if min_possible >= end_dt:
            target_date = target_date + timedelta(days=1)
            min_possible = datetime.combine(target_date, slot_start, tzinfo=KYIV_TZ)
            end_dt = datetime.combine(target_date, slot_end, tzinfo=KYIV_TZ)

    tot_seconds = int((end_dt - min_possible).total_seconds())
    if tot_seconds <= 60:
        chosen_dt = min_possible.replace(second=0, microsecond=0)
    else:
        rand_s = random.randint(0, tot_seconds - 60)
        chosen_dt = (min_possible + timedelta(seconds=rand_s)).replace(second=0, microsecond=0)

    chosen_utc = chosen_dt.astimezone(timezone.utc).replace(tzinfo=None)
    job.scheduled_at = chosen_utc
    job.status = "pending"
    db.commit()
    db.refresh(job)

    try:
        from app.tasks import publish_post_task
        publish_post_task.apply_async(args=[job.id], eta=chosen_utc.replace(tzinfo=timezone.utc))
        logger.info(f"RescheduledJob {job.id} to {chosen_dt}")
    except Exception as e_cel:
        logger.error(f"Failed to re-queue Celery ETA: {e_cel}")

    prof_info = next((p for p in profiles if p["username"] == job.profile_username), {})
    return {
        "job_id": job.id,
        "account": job.profile_username,
        "platforms": job.platforms,
        "channel_links": prof_info.get("channel_links", {}),
        "channel_handles": prof_info.get("channel_handles", {}),
        "slot_label": slot_label,
        "scheduled_at_kyiv": chosen_dt,
        "scheduled_at_utc": chosen_utc
    }
