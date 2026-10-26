import os
import uuid
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    permissions = Column(JSON, nullable=False)  # list of permission strings
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="role")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    clerk_user_id = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    status = Column(String, default="active")  # active, inactive
    created_at = Column(DateTime, default=datetime.utcnow)

    role = relationship("Role", back_populates="users")

class Video(Base):
    __tablename__ = "videos"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True)
    title = Column(String, nullable=True)
    description = Column(String, nullable=True)
    hashtags = Column(JSON, nullable=True)  # list of strings
    view_count = Column(Integer, default=0)
    duration = Column(Integer, default=0)  # in seconds
    platform = Column(String, nullable=True)  # tiktok, instagram, etc.
    thumbnail_url = Column(String, nullable=True)
    original_url = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    downloaded_at = Column(DateTime, default=datetime.utcnow)

    collections = relationship("Collection", back_populates="video", cascade="all, delete-orphan")

class Watermark(Base):
    __tablename__ = "watermarks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True)
    filename = Column(String, nullable=False)
    original_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    duration = Column(Integer, default=0)  # in seconds
    category = Column(String, default="general", nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Collection(Base):
    __tablename__ = "collections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    video_id = Column(String, ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship("Video", back_populates="collections")
    items = relationship("CollectionItem", back_populates="collection", cascade="all, delete-orphan")
    scheduled_jobs = relationship("ScheduledJob", back_populates="collection", cascade="all, delete-orphan")

class CollectionItem(Base):
    __tablename__ = "collection_items"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    collection_id = Column(String, ForeignKey("collections.id", ondelete="CASCADE"), nullable=False)
    watermark_id = Column(String, ForeignKey("watermarks.id", ondelete="CASCADE"), nullable=False)
    output_file_path = Column(String, nullable=True)
    position = Column(String, nullable=False)  # top-left, top-right, bottom-left, bottom-right, center
    offset_x = Column(Integer, default=10)
    offset_y = Column(Integer, default=10)
    scale = Column(Integer, default=30)
    status = Column(String, default="processing")  # processing, ready, failed
    target_handle = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    collection = relationship("Collection", back_populates="items")
    watermark = relationship("Watermark")
    scheduled_jobs = relationship("ScheduledJob", back_populates="collection_item", cascade="all, delete-orphan")

class ScheduledJob(Base):
    __tablename__ = "scheduled_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True)
    collection_id = Column(String, ForeignKey("collections.id", ondelete="CASCADE"), nullable=False)
    collection_item_id = Column(String, ForeignKey("collection_items.id", ondelete="CASCADE"), nullable=False)
    profile_username = Column(String, nullable=False)
    platforms = Column(JSON, nullable=False)  # list of strings
    scheduled_at = Column(DateTime, nullable=False)
    status = Column(String, default="pending")  # pending, processing, published, failed
    result = Column(JSON, nullable=True)
    post_title = Column(String, nullable=True)
    post_description = Column(String, nullable=True)
    post_hashtags = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    collection = relationship("Collection", back_populates="scheduled_jobs")
    collection_item = relationship("CollectionItem", back_populates="scheduled_jobs")


class DonorChannel(Base):
    __tablename__ = "donor_channels"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    platform = Column(String, default="tiktok")  # tiktok, instagram, youtube
    username = Column(String, nullable=False)    # e.g. "@richard_crypto"
    url = Column(String, nullable=False)         # profile URL
    min_views = Column(Integer, default=50000)   # min views to ingest
    category = Column(String, default="general")
    is_active = Column(Boolean, default=True)
    last_scanned_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PostMetric(Base):
    __tablename__ = "post_metrics"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scheduled_job_id = Column(String, ForeignKey("scheduled_jobs.id"), nullable=True)
    profile_username = Column(String, nullable=False)  # Acc_1
    platform = Column(String, nullable=False)          # instagram, tiktok, etc.
    platform_post_id = Column(String, nullable=True)
    post_url = Column(String, nullable=True)
    post_title = Column(String, nullable=True)
    view_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    share_count = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    scheduled_job = relationship("ScheduledJob", backref="metrics")

class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(String, nullable=True)
    description = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    
    # Lightweight direct sqlite3 migration for SQLite databases
    if DATABASE_URL.startswith("sqlite://"):
        db_path = DATABASE_URL.replace("sqlite:///", "").replace("sqlite://", "")
        if os.path.exists(db_path):
            import sqlite3
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("PRAGMA table_info(scheduled_jobs)")
                columns = [row[1] for row in cursor.fetchall()]
                mutated = False
                if "post_title" not in columns:
                    cursor.execute("ALTER TABLE scheduled_jobs ADD COLUMN post_title TEXT")
                    mutated = True
                if "post_description" not in columns:
                    cursor.execute("ALTER TABLE scheduled_jobs ADD COLUMN post_description TEXT")
                    mutated = True
                if "post_hashtags" not in columns:
                    cursor.execute("ALTER TABLE scheduled_jobs ADD COLUMN post_hashtags TEXT")
                    mutated = True

                cursor.execute("PRAGMA table_info(watermarks)")
                wm_cols = [row[1] for row in cursor.fetchall()]
                if "category" not in wm_cols:
                    cursor.execute("ALTER TABLE watermarks ADD COLUMN category TEXT DEFAULT 'general'")
                    mutated = True

                cursor.execute("PRAGMA table_info(collection_items)")
                ci_cols = [row[1] for row in cursor.fetchall()]
                if "target_handle" not in ci_cols:
                    cursor.execute("ALTER TABLE collection_items ADD COLUMN target_handle TEXT")
                    mutated = True
                if mutated:
                    conn.commit()
                    print("SQLite custom scheduled_jobs columns successfully migrated.")
            except Exception as em:
                print(f"Error during SQLite custom migration: {em}")
            finally:
                conn.close()

    db = SessionLocal()
    try:
        default_roles = [
            {
                "name": "Admin",
                "description": "Administrator with full permissions",
                "permissions": [
                    "videos:view", "videos:download", "videos:delete",
                    "watermarks:view", "watermarks:upload", "watermarks:delete",
                    "collections:view", "collections:create", "collections:delete",
                    "schedule:view", "schedule:create", "schedule:cancel",
                    "accounts:view", "settings:manage users", "settings:manage roles"
                ]
            },
            {
                "name": "Editor",
                "description": "Can edit video metadata, upload watermarks, build collections, and schedule posts",
                "permissions": [
                    "videos:view", "videos:download", "videos:delete",
                    "watermarks:view", "watermarks:upload", "watermarks:delete",
                    "collections:view", "collections:create", "collections:delete",
                    "schedule:view", "schedule:create", "schedule:cancel",
                    "accounts:view"
                ]
            },
            {
                "name": "Viewer",
                "description": "Can view all materials and stats, cannot perform changes",
                "permissions": [
                    "videos:view", "watermarks:view", "collections:view", "schedule:view", "accounts:view"
                ]
            }
        ]
        
        roles_added = False
        for r_data in default_roles:
            existing = db.query(Role).filter(Role.name == r_data["name"]).first()
            if not existing:
                role = Role(
                    name=r_data["name"],
                    description=r_data["description"],
                    permissions=r_data["permissions"]
                )
                db.add(role)
                roles_added = True
        
        if roles_added:
            db.commit()
            print("Default roles pre-populated successfully.")
        else:
            print("Default roles already exist in the database.")
    except Exception as e:
        print(f"Error initializing DB: {e}")
        db.rollback()
    finally:
        db.close()
