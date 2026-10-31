"""Explicitly development-only JWT authentication; fail closed on configuration errors."""
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt

from .config import uuid_text
from .errors import RiskError

PERMISSIONS = {"risk:run", "risk:read"}


@dataclass(frozen=True)
class Auth:
    secret: str = field(repr=False)
    issuer: str
    audience: str
    tenants: tuple[str,...]

    @classmethod
    def from_env(cls, tenants, env=None):
        env=os.environ if env is None else env
        if (env.get("RISK_AUTH_MODE") != "development-jwt" or
            len(env.get("RISK_JWT_SECRET","").encode()) < 32 or
            not env.get("RISK_JWT_ISSUER") or not env.get("RISK_JWT_AUDIENCE")):
            raise ValueError("INVALID_DEVELOPMENT_AUTH_CONFIGURATION")
        return cls(env["RISK_JWT_SECRET"],env["RISK_JWT_ISSUER"],env["RISK_JWT_AUDIENCE"],tenants)

    def verify(self, header, permission):
        if not isinstance(header,str) or not header.startswith("Bearer ") or len(header)>8192:
            raise RiskError("UNAUTHENTICATED",401)
        try:
            claims=jwt.decode(header[7:],self.secret,algorithms=["HS256"],issuer=self.issuer,audience=self.audience,
                options={"require":["exp","iat","sub","tenantId","permissions"]})
            tenant=uuid_text(claims["tenantId"])
            permissions=claims["permissions"]
            if (not isinstance(claims["sub"],str) or not 1 <= len(claims["sub"]) <= 200
                or type(claims["exp"]) is not int or type(claims["iat"]) is not int
                or not isinstance(permissions,list) or not permissions or
                any(not isinstance(p,str) or p not in PERMISSIONS for p in permissions)):
                raise ValueError()
        except (jwt.PyJWTError,ValueError,TypeError,KeyError):
            raise RiskError("UNAUTHENTICATED",401) from None
        if tenant not in self.tenants or permission not in permissions:
            raise RiskError("FORBIDDEN",403)
        return tenant

    def token(self, tenant, permissions=tuple(sorted(PERMISSIONS)), lifetime=900):
        tenant=uuid_text(tenant)
        if tenant not in self.tenants or not set(permissions) <= PERMISSIONS or not permissions:
            raise ValueError("INVALID_TOKEN_SCOPE")
        now=datetime.now(timezone.utc)
        return jwt.encode({"sub":"local-operator","tenantId":tenant,"permissions":list(permissions),
            "iss":self.issuer,"aud":self.audience,"iat":int(now.timestamp()),
            "exp":int((now+timedelta(seconds=lifetime)).timestamp()),"jti":str(uuid4())},self.secret,algorithm="HS256")
