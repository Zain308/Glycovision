import jwt

from jwt import PyJWKClient

from fastapi import (
    Depends,
    HTTPException,
)

from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)

from core.config import get_settings


settings = get_settings()


_jwks_url = (
    f"{settings.supabase_url}"
    "/auth/v1/.well-known/jwks.json"
)


_jwk_client = (
    PyJWKClient(
        _jwks_url
    )
    if settings.supabase_url
    else None
)


# ---------------------------------------------------------
# SWAGGER / BEARER AUTH
# ---------------------------------------------------------

bearer_scheme = HTTPBearer(
    auto_error=False
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials
    | None = Depends(
        bearer_scheme
    ),
) -> str:

    """
    Extracts and verifies the Supabase JWT.

    Returns the user's UUID from
    Supabase auth.uid() / JWT sub.
    """

    # -----------------------------------------------------
    # 1. CHECK AUTH HEADER
    # -----------------------------------------------------

    if credentials is None:

        raise HTTPException(
            status_code=401,
            detail=(
                "Missing Authorization header"
            ),
        )


    if (
        credentials.scheme.lower()
        != "bearer"
    ):

        raise HTTPException(
            status_code=401,
            detail=(
                "Authorization scheme must be Bearer"
            ),
        )


    token = (
        credentials.credentials
    )


    if not token:

        raise HTTPException(
            status_code=401,
            detail=(
                "Missing bearer token"
            ),
        )


    # -----------------------------------------------------
    # 2. SERVER CONFIG CHECK
    # -----------------------------------------------------

    if _jwk_client is None:

        raise HTTPException(
            status_code=500,
            detail=(
                "SUPABASE_URL not configured "
                "on the server"
            ),
        )


    # -----------------------------------------------------
    # 3. VERIFY SUPABASE JWT
    # -----------------------------------------------------

    try:

        signing_key = (
            _jwk_client
            .get_signing_key_from_jwt(
                token
            )
        )


        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=[
                "ES256",
                "RS256",
            ],
            audience="authenticated",
            leeway=30,
        )


    except jwt.ExpiredSignatureError:

        raise HTTPException(
            status_code=401,
            detail=(
                "Token expired — "
                "please log in again"
            ),
        )


    except jwt.InvalidTokenError as error:

        raise HTTPException(
            status_code=401,
            detail=(
                f"Invalid token: {error}"
            ),
        )


    # -----------------------------------------------------
    # 4. USER ID
    # -----------------------------------------------------

    user_id = (
        payload.get(
            "sub"
        )
    )


    if not user_id:

        raise HTTPException(
            status_code=401,
            detail=(
                "Token does not contain "
                "a valid user ID"
            ),
        )


    return user_id