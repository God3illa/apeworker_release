import os
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db, User, Role

KEYCLOAK_JWKS_URL = os.getenv(
    "KEYCLOAK_JWKS_URL",
    "https://auth.apeworker.top/realms/apeworker/protocol/openid-connect/certs"
)

# Initialize JWT Key Client for fetching and caching Keycloak public keys
try:
    jwks_client = PyJWKClient(KEYCLOAK_JWKS_URL)
except Exception as e:
    print(f"Warning: Could not initialize Keycloak JWK Client: {e}")
    jwks_client = None

security = HTTPBearer(auto_error=False)

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is missing"
        )
    token = credentials.credentials
    try:
        if not jwks_client:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Keycloak JWKS Client not initialized"
            )
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_exp": True, "verify_aud": False}
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}"
        )

def get_current_user(payload: dict = Depends(verify_token), db: Session = Depends(get_db)):
    clerk_user_id = payload.get("sub")
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload: missing 'sub'"
        )

    # Sync/fetch user from database
    user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
    
    if not user:
        # Extract metadata from Clerk claims
        email = payload.get("email")
        if not email:
            email = payload.get("primary_email_address") or payload.get("emails", [f"clerk_{clerk_user_id}@apeworker.top"])[0]
            if isinstance(email, dict):
                email = email.get("email_address", f"clerk_{clerk_user_id}@apeworker.top")
        
        name = payload.get("name") or payload.get("first_name", "ApeWorker")
        
        # Check if they are pre-invited in our system by email
        invited_user = db.query(User).filter(User.email == email).first()
        if invited_user:
            invited_user.clerk_user_id = clerk_user_id
            invited_user.name = name
            invited_user.status = "active"
            try:
                db.commit()
                db.refresh(invited_user)
                return invited_user
            except Exception as e:
                db.rollback()
                # If a parallel request already committed this update, retrieve it
                user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
                if user:
                    return user
                raise e

        # If not pre-invited, restrict registration unless they are the first user (who becomes Admin)
        is_first = db.query(User).count() == 0
        if not is_first:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Registration is restricted. Please ask your workspace administrator to invite you."
            )
        
        role_name = "Admin"
        default_role = db.query(Role).filter(Role.name == role_name).first()
        
        user = User(
            clerk_user_id=clerk_user_id,
            email=email,
            name=name,
            role_id=default_role.id if default_role else None,
            status="active"
        )
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except Exception as e:
            db.rollback()
            # If a parallel request already inserted the user, retrieve it
            user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
            if not user:
                raise e

    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is pending invitation or deactivated"
        )
        
    return user

class PermissionChecker:
    def __init__(self, required_permission: str):
        self.required_permission = required_permission

    def __call__(self, current_user: User = Depends(get_current_user)):
        if not current_user.role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User has no role assigned"
            )
        
        if self.required_permission not in current_user.role.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required: {self.required_permission}"
            )
        return current_user
