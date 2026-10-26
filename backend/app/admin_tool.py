import sys
import os
import uuid

# Add parent directory to path to allow import of app packages
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal, User, Role

def elevate_user(email_or_id: str, custom_email: str = None):
    db = SessionLocal()
    try:
        admin_role = db.query(Role).filter(Role.name == "Admin").first()
        if not admin_role:
            print("Error: The 'Admin' role was not found in the database. Has init_db() run?")
            return False

        # Match exact clerk_user_id or email
        user = db.query(User).filter((User.email == email_or_id) | (User.clerk_user_id == email_or_id)).first()
        if not user:
            # Fallback to substring matching on email
            user = db.query(User).filter(User.email.like(f"%{email_or_id}%")).first()
            
        if not user:
            # Since the user record is missing, we will force-create it!
            print(f"User '{email_or_id}' not found in the database. Force-creating a new active Admin user...")
            
            # Determine Clerk ID and Email
            clerk_id = email_or_id if email_or_id.startswith("user_") else f"forced_{uuid.uuid4().hex[:8]}"
            email = custom_email or (email_or_id if "@" in email_or_id else f"clerk_{clerk_id}@apeworker.top")
            
            user = User(
                clerk_user_id=clerk_id,
                email=email,
                name="Admin User",
                role_id=admin_role.id,
                status="active"
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Success: Admin user record created! Clerk ID: {user.clerk_user_id}, Email: {user.email}")
            return True
            
        # If user exists, simply promote them to Admin
        user.role_id = admin_role.id
        user.status = "active"
        db.commit()
        print(f"Success: User {user.email} (Clerk ID: {user.clerk_user_id}) successfully promoted to Admin!")
        return True
    except Exception as e:
        print(f"Error executing elevation: {e}")
        db.rollback()
        return False
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m app.admin_tool <email_or_clerk_id> [custom_email]")
        sys.exit(1)
    
    custom_email = sys.argv[2] if len(sys.argv) > 2 else None
    elevate_user(sys.argv[1], custom_email)
