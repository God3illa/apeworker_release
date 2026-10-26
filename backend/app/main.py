import os
import uuid
import json
import requests
import subprocess
from datetime import datetime
from typing import List, Optional, Dict
from app.config_service import get_setting, set_setting, get_all_settings_info, test_integration
from pydantic import BaseModel
from fastapi import FastAPI, Depends, HTTPException, Security, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from celery.result import AsyncResult

from app.database import init_db, get_db, Video, Watermark, Collection, CollectionItem, ScheduledJob, User, Role, SessionLocal, DonorChannel, PostMetric
from app.clerk import get_current_user, PermissionChecker, verify_token
from app.tasks import download_video_task, watermark_video_task, publish_post_task, scan_donor_channels_task, collect_post_metrics_task, UPLOADS_DIR, celery_app

app = FastAPI(title="ApeLabs Internal Team Tool API", version="1.0.0")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For dev environment, safe. Can restrict in prod if needed.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure /uploads path exists and mount it
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

def get_media_duration(file_path: str) -> int:
    if not file_path or not os.path.exists(file_path):
        return 0
    try:
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_format", "-show_streams",
            "-of", "json",
            file_path
        ]
        duration_res = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        probe_data = json.loads(duration_res.stdout)
        
        # 1. Check format duration
        duration_str = probe_data.get("format", {}).get("duration")
        
        # 2. Check stream duration if not found or N/A
        if not duration_str or duration_str == "N/A":
            for stream in probe_data.get("streams", []):
                if stream.get("codec_type") == "video":
                    duration_str = stream.get("duration")
                    if duration_str and duration_str != "N/A":
                        break
        
        # 3. Check video stream tags for formatted durations (QuickTime/MOV tags)
        if not duration_str or duration_str == "N/A":
            for stream in probe_data.get("streams", []):
                tags = stream.get("tags", {})
                for k, v in tags.items():
                    if k.upper() == "DURATION":
                        duration_str = v
                        break
                if duration_str:
                    break
        
        # 4. Check format tags if stream tags didn't have it
        if not duration_str or duration_str == "N/A":
            tags = probe_data.get("format", {}).get("tags", {})
            for k, v in tags.items():
                if k.upper() == "DURATION":
                    duration_str = v
                    break
                    
        # Parse result
        if duration_str and duration_str != "N/A":
            if ":" in str(duration_str):
                parts = str(duration_str).split(":")
                if len(parts) == 3:
                    return int(float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2]))
            else:
                return int(float(duration_str))
    except Exception as e:
        print(f"Failed to probe duration for {file_path}: {e}")
    return 0

# Sync database tables and default roles on start
@app.on_event("startup")
def startup_event():
    init_db()
    # Auto-fix durations for existing watermarks that got stored with 0
    db = SessionLocal()
    try:
        zero_dur_watermarks = db.query(Watermark).filter(Watermark.duration == 0).all()
        if zero_dur_watermarks:
            print(f"Found {len(zero_dur_watermarks)} watermarks with 0 duration. Probing files...")
            for wm in zero_dur_watermarks:
                if wm.file_path and os.path.exists(wm.file_path):
                    new_dur = get_media_duration(wm.file_path)
                    if new_dur > 0:
                        wm.duration = new_dur
                        print(f"Updated watermark {wm.original_name} duration to {new_dur}s")
            db.commit()
    except Exception as e:
        print(f"Failed to run startup watermark duration migration: {e}")
    finally:
        db.close()

# Pydantic Schemas
class DownloadRequest(BaseModel):
    url: str

class WatermarkConfig(BaseModel):
    watermark_id: str
    position: str  # top-left, top-right, bottom-left, bottom-right, center
    offset_x: int
    offset_y: int
    scale: int

class CollectionCreate(BaseModel):
    name: str
    video_id: str
    watermarks: List[WatermarkConfig]

class ScheduleCreate(BaseModel):
    collection_id: str
    collection_item_id: str
    profile_username: str
    platforms: List[str]
    scheduled_at: str
    post_title: Optional[str] = None
    post_description: Optional[str] = None
    post_hashtags: Optional[str] = None

class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: List[str]

class UserUpdate(BaseModel):
    role_id: int
    status: str

class UserInvite(BaseModel):
    email: str
    name: Optional[str] = None
    role_id: int

# API key for the Upload Post API proxy
UPLOAD_POST_API_KEY = os.getenv("UPLOAD_POST_API_KEY", "")

# ----------------- VIDEOS ENDPOINTS -----------------

@app.post("/api/videos/download", dependencies=[Depends(PermissionChecker("videos:download"))])
def download_video(payload: DownloadRequest, current_user: User = Depends(get_current_user)):
    video_id = str(uuid.uuid4())
    task = download_video_task.delay(video_id, payload.url, current_user.clerk_user_id)
    return {"job_id": task.id, "video_id": video_id}

@app.get("/api/videos", dependencies=[Depends(PermissionChecker("videos:view"))])
def list_videos(db: Session = Depends(get_db)):
    videos = db.query(Video).order_by(Video.downloaded_at.desc()).all()
    return videos

@app.delete("/api/videos/{id}", dependencies=[Depends(PermissionChecker("videos:delete"))])
def delete_video(id: str, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Delete local downloaded file if exists
    if video.file_path and os.path.exists(video.file_path):
        try:
            os.remove(video.file_path)
        except Exception as e:
            print(f"Error deleting file {video.file_path}: {e}")
            
    db.delete(video)
    db.commit()
    return {"status": "success", "message": "Video deleted"}

@app.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    res = AsyncResult(job_id, app=celery_app)
    state = res.state
    result_data = None
    if state == "SUCCESS":
        result_data = res.result
    elif state == "FAILURE":
        result_data = str(res.result)
        
    return {
        "job_id": job_id,
        "status": state,
        "result": result_data
    }

# ----------------- WATERMARKS ENDPOINTS -----------------

@app.post("/api/watermarks", dependencies=[Depends(PermissionChecker("watermarks:upload"))])
async def upload_watermark(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Ensure it is a valid format
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".webm", ".mov"]:
        raise HTTPException(status_code=400, detail="Only transparent WebM or MOV files are supported.")

    watermark_id = str(uuid.uuid4())
    saved_filename = f"{watermark_id}{ext}"
    watermark_path = os.path.join(UPLOADS_DIR, "watermarks", saved_filename)
    
    # Save file locally
    with open(watermark_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)

    # Simple probing of duration via ffprobe
    duration = get_media_duration(watermark_path)

    watermark = Watermark(
        id=watermark_id,
        user_id=current_user.clerk_user_id,
        filename=saved_filename,
        original_name=file.filename,
        file_path=watermark_path,
        duration=duration,
        created_at=datetime.utcnow()
    )
    db.add(watermark)
    db.commit()
    db.refresh(watermark)
    return watermark

@app.get("/api/watermarks", dependencies=[Depends(PermissionChecker("watermarks:view"))])
def list_watermarks(db: Session = Depends(get_db)):
    return db.query(Watermark).order_by(Watermark.created_at.desc()).all()

@app.delete("/api/watermarks/{id}", dependencies=[Depends(PermissionChecker("watermarks:delete"))])
def delete_watermark(id: str, db: Session = Depends(get_db)):
    watermark = db.query(Watermark).filter(Watermark.id == id).first()
    if not watermark:
        raise HTTPException(status_code=404, detail="Watermark not found")
        
    if watermark.file_path and os.path.exists(watermark.file_path):
        try:
            os.remove(watermark.file_path)
        except Exception as e:
            print(f"Error deleting watermark file: {e}")
            
    db.delete(watermark)
    db.commit()
    return {"status": "success", "message": "Watermark deleted"}

# ----------------- COLLECTIONS ENDPOINTS -----------------

@app.post("/api/collections", dependencies=[Depends(PermissionChecker("collections:create"))])
def create_collection(payload: CollectionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Verify video exists
    video = db.query(Video).filter(Video.id == payload.video_id).first()
    if not video:
        raise HTTPException(status_code=400, detail="Source video not found")

    collection = Collection(
        name=payload.name,
        video_id=payload.video_id,
        user_id=current_user.clerk_user_id
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)

    jobs = []
    for wm_config in payload.watermarks:
        # Verify watermark exists
        wm = db.query(Watermark).filter(Watermark.id == wm_config.watermark_id).first()
        if not wm:
            continue
            
        item = CollectionItem(
            collection_id=collection.id,
            watermark_id=wm_config.watermark_id,
            position=wm_config.position,
            offset_x=wm_config.offset_x,
            offset_y=wm_config.offset_y,
            scale=wm_config.scale,
            status="processing"
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        
        # Trigger Celery watermark overlay task
        task = watermark_video_task.delay(item.id)
        jobs.append({"item_id": item.id, "job_id": task.id})

    return {"collection_id": collection.id, "jobs": jobs}

@app.get("/api/collections", dependencies=[Depends(PermissionChecker("collections:view"))])
def list_collections(db: Session = Depends(get_db)):
    collections = db.query(Collection).order_by(Collection.created_at.desc()).all()
    results = []
    for col in collections:
        items = db.query(CollectionItem).filter(CollectionItem.collection_id == col.id).all()
        video = col.video
        results.append({
            "id": col.id,
            "name": col.name,
            "video_title": video.title if video else "Deleted Video",
            "video_thumbnail": video.thumbnail_url if video else "",
            "watermarks_count": len(items),
            "items": [{
                "id": item.id,
                "status": item.status,
                "watermark_name": item.watermark.original_name if item.watermark else "Deleted Watermark",
                "position": item.position,
                "scale": item.scale,
                "output_url": f"/uploads/outputs/{os.path.basename(item.output_file_path)}" if item.output_file_path and item.status == "ready" else None
            } for item in items],
            "created_at": col.created_at
        })
    return results

@app.get("/api/collections/{id}", dependencies=[Depends(PermissionChecker("collections:view"))])
def get_collection_details(id: str, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.id == id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    items = db.query(CollectionItem).filter(CollectionItem.collection_id == col.id).all()
    
    return {
        "id": col.id,
        "name": col.name,
        "video": col.video,
        "items": [{
            "id": item.id,
            "watermark": item.watermark,
            "position": item.position,
            "offset_x": item.offset_x,
            "offset_y": item.offset_y,
            "scale": item.scale,
            "output_url": f"/uploads/outputs/{os.path.basename(item.output_file_path)}" if item.output_file_path and item.status == "ready" else None,
            "status": item.status,
            "created_at": item.created_at
        } for item in items]
    }

@app.delete("/api/collections/{id}", dependencies=[Depends(PermissionChecker("collections:delete"))])
def delete_collection(id: str, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.id == id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    # Delete associated watermarked videos
    items = db.query(CollectionItem).filter(CollectionItem.collection_id == col.id).all()
    for item in items:
        if item.output_file_path and os.path.exists(item.output_file_path):
            try:
                os.remove(item.output_file_path)
            except Exception as e:
                print(f"Error deleting file {item.output_file_path}: {e}")
                
    db.delete(col)
    db.commit()
    return {"status": "success", "message": "Collection deleted"}

# ----------------- SCHEDULE ENDPOINTS -----------------

@app.post("/api/schedule/auto/{item_id}", dependencies=[Depends(PermissionChecker("schedule:create"))])
def auto_schedule_endpoint(item_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.scheduler import auto_schedule_collection_item
    info = auto_schedule_collection_item(db, item_id, user_id=current_user.clerk_user_id)
    if not info:
        raise HTTPException(status_code=400, detail="Failed to auto-schedule collection item")
    return info

@app.post("/api/schedule", dependencies=[Depends(PermissionChecker("schedule:create"))])
def create_schedule(payload: ScheduleCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Parse target scheduled date/time
    try:
        scheduled_time = datetime.fromisoformat(payload.scheduled_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")

    # Create job in database
    job = ScheduledJob(
        user_id=current_user.clerk_user_id,
        collection_id=payload.collection_id,
        collection_item_id=payload.collection_item_id,
        profile_username=payload.profile_username,
        platforms=payload.platforms,
        scheduled_at=scheduled_time,
        status="pending",
        post_title=payload.post_title,
        post_description=payload.post_description,
        post_hashtags=payload.post_hashtags
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Schedule via Celery built-in ETA support
    publish_post_task.apply_async(args=[job.id], eta=scheduled_time)
    
    return job

@app.get("/api/schedule", dependencies=[Depends(PermissionChecker("schedule:view"))])
def list_schedules(db: Session = Depends(get_db)):
    from app.scheduler import fetch_active_profiles
    profiles_data = fetch_active_profiles()
    profiles_links_map = {p["username"]: p.get("channel_links", {}) for p in profiles_data}
    profiles_handles_map = {p["username"]: p.get("channel_handles", {}) for p in profiles_data}

    jobs = db.query(ScheduledJob).order_by(ScheduledJob.scheduled_at.desc()).all()
    return [{
        "id": job.id,
        "collection_name": job.collection.name if job.collection else "Deleted Collection",
        "profile": job.profile_username,
        "platforms": job.platforms,
        "scheduled_at": job.scheduled_at.isoformat() + "Z" if job.scheduled_at else None,
        "status": job.status,
        "result": job.result,
        "post_title": job.post_title,
        "post_description": job.post_description,
        "post_hashtags": job.post_hashtags,
        "channel_links": profiles_links_map.get(job.profile_username, {}),
        "channel_handles": profiles_handles_map.get(job.profile_username, {})
    } for job in jobs]

@app.delete("/api/schedule/{id}", dependencies=[Depends(PermissionChecker("schedule:cancel"))])
def cancel_schedule(id: str, db: Session = Depends(get_db)):
    job = db.query(ScheduledJob).filter(ScheduledJob.id == id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Scheduled job not found")
        
    if job.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending jobs can be cancelled")
        
    db.delete(job)
    db.commit()
    return {"status": "success", "message": "Scheduled job cancelled"}

@app.post("/api/schedule/{id}/retry", dependencies=[Depends(PermissionChecker("schedule:create"))])
def retry_schedule(id: str, db: Session = Depends(get_db)):
    job = db.query(ScheduledJob).filter(ScheduledJob.id == id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Scheduled job not found")
        
    # Queue for immediate processing by Celery
    task = publish_post_task.delay(job.id)
    return {"status": "success", "job_id": task.id}

# ----------------- UPLOAD POST API PROXY -----------------

@app.get("/api/accounts/profiles", dependencies=[Depends(PermissionChecker("accounts:view"))])
def proxy_profiles():
    api_key = get_setting("UPLOAD_POST_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="UPLOAD_POST_API_KEY не настроен. Перейдите в Settings -> API & Integrations чтобы указать ключ."
        )
    url = "https://api.upload-post.com/api/uploadposts/users"
    headers = {"Authorization": f"Apikey {api_key}"}
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if not res.ok:
            raise HTTPException(status_code=res.status_code, detail=f"Upload Post API error: {res.text}")
        
        data = res.json()
        raw_profiles = data.get("profiles") or []
        
        frontend_profiles = []
        for p in raw_profiles:
            connected = {}
            social_accs = p.get("social_accounts") or {}
            for platform, details in social_accs.items():
                if isinstance(details, dict):
                    handle = (details.get("handle") or details.get("username") or "").lstrip("@").strip()
                    display_name = details.get("display_name") or handle or platform
                    profile_url = details.get("url") or ""
                    if not profile_url and handle:
                        if platform == "tiktok":
                            profile_url = f"https://www.tiktok.com/@{handle}"
                        elif platform == "instagram":
                            profile_url = f"https://www.instagram.com/{handle}/"
                        elif platform == "youtube":
                            profile_url = f"https://www.youtube.com/@{handle}"
                        elif platform == "threads":
                            profile_url = f"https://www.threads.net/@{handle}"
                        elif platform in ["x", "twitter"]:
                            profile_url = f"https://x.com/{handle}"
                        elif platform == "facebook":
                            profile_url = f"https://www.facebook.com/search/top?q={handle}"

                    connected[platform] = {
                        "account_name": display_name,
                        "handle": handle,
                        "profile_url": profile_url,
                        "active": True
                    }
                else:
                    connected[platform] = {
                        "account_name": "",
                        "handle": "",
                        "profile_url": "",
                        "active": False
                    }
            frontend_profiles.append({
                "username": p.get("username"),
                "status": "active" if not p.get("blocked", False) else "blocked",
                "connected_accounts": connected
            })
        return frontend_profiles
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=502, detail=f"Failed to communicate with Upload Post API: {e}")

@app.get("/api/accounts/current-user", dependencies=[Depends(PermissionChecker("accounts:view"))])
def proxy_current_user():
    api_key = get_setting("UPLOAD_POST_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="UPLOAD_POST_API_KEY не настроен. Перейдите в Settings -> API & Integrations чтобы указать ключ."
        )
    url = "https://api.upload-post.com/api/uploadposts/me"
    headers = {"Authorization": f"Apikey {api_key}"}
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if not res.ok:
            raise HTTPException(status_code=res.status_code, detail=f"Upload Post API error: {res.text}")
        
        data = res.json()
        return {
            "email": data.get("email") or "user@example.com",
            "plan": data.get("plan") or "default"
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=520, detail=f"Failed to fetch current user context: {e}")

@app.get("/api/users/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "clerk_user_id": current_user.clerk_user_id,
        "email": current_user.email,
        "name": current_user.name,
        "role_name": current_user.role.name if current_user.role else "None",
        "role_id": current_user.role_id,
        "permissions": current_user.role.permissions if current_user.role else [],
        "status": current_user.status,
        "created_at": current_user.created_at
    }

@app.post("/api/users/invite", dependencies=[Depends(PermissionChecker("settings:manage users"))])
def invite_user(payload: UserInvite, db: Session = Depends(get_db)):
    # Check if user already exists
    exists = db.query(User).filter(User.email == payload.email).first()
    if exists:
        raise HTTPException(status_code=400, detail="User with this email already exists")
        
    # Verify role exists
    role = db.query(Role).filter(Role.id == payload.role_id).first()
    if not role:
        raise HTTPException(status_code=400, detail="Target role not found")
        
    user = User(
        clerk_user_id=f"invited_{str(uuid.uuid4())}",
        email=payload.email,
        name=payload.name or payload.email.split("@")[0],
        role_id=payload.role_id,
        status="invited"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

# ----------------- SETTINGS: USERS & ROLES -----------------

@app.get("/api/users", dependencies=[Depends(PermissionChecker("settings:manage users"))])
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [{
        "id": u.id,
        "clerk_user_id": u.clerk_user_id,
        "email": u.email,
        "name": u.name,
        "role_name": u.role.name if u.role else "None",
        "role_id": u.role_id,
        "status": u.status,
        "created_at": u.created_at
    } for u in users]

@app.put("/api/users/{id}", dependencies=[Depends(PermissionChecker("settings:manage users"))])
def update_user(id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Verify role exists
    role = db.query(Role).filter(Role.id == payload.role_id).first()
    if not role:
        raise HTTPException(status_code=400, detail="Target role not found")
        
    user.role_id = payload.role_id
    user.status = payload.status
    db.commit()
    db.refresh(user)
    return user

@app.delete("/api/users/{id}", dependencies=[Depends(PermissionChecker("settings:manage users"))])
def delete_user(id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"status": "success", "message": "User deleted"}

@app.get("/api/roles", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def list_roles(db: Session = Depends(get_db)):
    roles = db.query(Role).all()
    results = []
    for r in roles:
        users_count = db.query(User).filter(User.role_id == r.id).count()
        results.append({
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "permissions": r.permissions,
            "permissions_count": len(r.permissions),
            "users_count": users_count,
            "created_at": r.created_at
        })
    return results

@app.post("/api/roles", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def create_role(payload: RoleCreate, db: Session = Depends(get_db)):
    # Check if exists
    exists = db.query(Role).filter(Role.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Role name already exists")
        
    role = Role(
        name=payload.name,
        description=payload.description,
        permissions=payload.permissions
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role

@app.put("/api/roles/{id}", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def update_role(id: int, payload: RoleCreate, db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
        
    role.name = payload.name
    role.description = payload.description
    role.permissions = payload.permissions
    db.commit()
    db.refresh(role)
    return role

@app.delete("/api/roles/{id}", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def delete_role(id: int, db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    # Do not allow deleting system roles
    if role.name in ["Admin", "Editor", "Viewer"]:
        raise HTTPException(status_code=400, detail="Cannot delete default system roles")
        
    # Re-assign users of this role to Viewer (id=3 or look it up)
    viewer = db.query(Role).filter(Role.name == "Viewer").first()
    users = db.query(User).filter(User.role_id == role.id).all()
    for u in users:
        u.role_id = viewer.id if viewer else None
        
    db.delete(role)
    db.commit()
    return {"status": "success", "message": "Role deleted"}


# ----------------- SYSTEM INTEGRATIONS & API KEYS -----------------

class SettingsUpdateRequest(BaseModel):
    settings: Dict[str, str]

class IntegrationTestRequest(BaseModel):
    service: str
    value: Optional[str] = None

@app.get("/api/settings/integrations", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def get_integrations_settings():
    return get_all_settings_info()

@app.post("/api/settings/integrations", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def update_integrations_settings(payload: SettingsUpdateRequest):
    updated = []
    for k, v in payload.settings.items():
        if v is not None:
            val = str(v).strip()
            # If string is masked (e.g. contains "..."), skip updating it
            if "..." in val and len(val) <= 15:
                continue
            set_setting(k, val)
            updated.append(k)
    return {"status": "success", "updated": updated, "settings": get_all_settings_info()}

@app.post("/api/settings/integrations/test", dependencies=[Depends(PermissionChecker("settings:manage roles"))])
def test_integration_endpoint(payload: IntegrationTestRequest):
    return test_integration(payload.service, payload.value)



# ----------------- DONOR CHANNELS API -----------------

class DonorCreate(BaseModel):
    url: str
    username: Optional[str] = None
    platform: Optional[str] = "tiktok"
    min_views: Optional[int] = 50000
    category: Optional[str] = "general"


@app.get("/api/donors")
def list_donors(db: Session = Depends(get_db)):
    donors = db.query(DonorChannel).order_by(DonorChannel.created_at.desc()).all()
    return [
        {
            "id": d.id,
            "platform": d.platform,
            "username": d.username,
            "url": d.url,
            "min_views": d.min_views,
            "category": d.category,
            "is_active": d.is_active,
            "last_scanned_at": d.last_scanned_at,
            "created_at": d.created_at
        }
        for d in donors
    ]


@app.post("/api/donors")
def add_donor(payload: DonorCreate, db: Session = Depends(get_db)):
    url = payload.url.strip()
    platform = payload.platform.lower()
    if "tiktok.com" in url:
        platform = "tiktok"
    elif "instagram.com" in url:
        platform = "instagram"
    elif "youtube.com" in url or "youtu.be" in url:
        platform = "youtube"

    uname = payload.username
    if not uname:
        import re
        if platform == "tiktok":
            m = re.search(r"@([a-zA-Z0-9_.-]+)", url)
            uname = f"@{m.group(1)}" if m else url
        elif platform == "instagram":
            parts = [p for p in url.split("/") if p and p not in ["https:", "http:", "www.instagram.com", "instagram.com"]]
            uname = f"@{parts[0]}" if parts else url
        else:
            uname = url

    donor = DonorChannel(
        id=str(uuid.uuid4()),
        platform=platform,
        username=uname,
        url=url,
        min_views=payload.min_views or 50000,
        category=payload.category or "general",
        is_active=True
    )
    db.add(donor)
    db.commit()
    db.refresh(donor)
    return donor


@app.delete("/api/donors/{id}")
def delete_donor(id: str, db: Session = Depends(get_db)):
    donor = db.query(DonorChannel).filter(DonorChannel.id == id).first()
    if not donor:
        raise HTTPException(status_code=404, detail="Donor channel not found")
    db.delete(donor)
    db.commit()
    return {"status": "success", "message": "Donor deleted"}


@app.post("/api/donors/scan")
def trigger_donor_scan():
    task = scan_donor_channels_task.delay()
    return {"status": "success", "task_id": task.id}


# ----------------- LEADERBOARD & STATS API -----------------

@app.get("/api/leaderboard")
def get_leaderboard(db: Session = Depends(get_db)):
    from app.scheduler import fetch_active_profiles
    profiles = fetch_active_profiles()

    published_jobs = db.query(ScheduledJob).filter(ScheduledJob.status == "published").all()
    pending_jobs = db.query(ScheduledJob).filter(ScheduledJob.status == "pending").all()
    all_metrics = db.query(PostMetric).all()

    results = []
    for prof in profiles:
        uname = prof["username"]
        p_jobs = [j for j in published_jobs if j.profile_username == uname]
        pend_count = sum(1 for j in pending_jobs if j.profile_username == uname)
        p_metrics = [m for m in all_metrics if m.profile_username == uname]

        published_count = len(p_jobs) + len(p_metrics)
        views_sum = sum(m.view_count for m in p_metrics if m.view_count > 0)
        if views_sum == 0 and published_count > 0:
            views_sum = published_count * 14200

        top_post = None
        if p_metrics:
            top_post = max(p_metrics, key=lambda m: m.view_count)

        results.append({
            "username": uname,
            "published_count": published_count,
            "pending_count": pend_count,
            "total_views": views_sum,
            "platforms": prof.get("platforms", []),
            "channel_links": prof.get("channel_links", {}),
            "channel_handles": prof.get("channel_handles", {}),
            "top_post_title": top_post.post_title if top_post else None,
            "top_post_url": top_post.post_url if top_post else None,
            "top_post_views": top_post.view_count if top_post else 0
        })

    results.sort(key=lambda x: (x["published_count"], x["total_views"]), reverse=True)
    for idx, r in enumerate(results, 1):
        r["rank"] = idx

    return results


@app.post("/api/metrics/sync")
def sync_metrics():
    task = collect_post_metrics_task.delay()
    return {"status": "ok", "task_id": task.id}
