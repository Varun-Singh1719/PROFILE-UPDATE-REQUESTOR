"""File upload + download via MongoDB GridFS."""
import uuid
from typing import Optional

import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, File, Query, Request, UploadFile
from fastapi.responses import Response as FastResponse

from core import (
    api_router, db, now_iso, get_current_user,
    JWT_SECRET, JWT_ALGORITHM,
    gridfs_bucket,
)

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


@api_router.post("/upload")
async def upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 5MB)")

    file_id = await gridfs_bucket.upload_from_stream(
        file.filename or "upload",
        data,
        metadata={
            "content_type": file.content_type or "application/octet-stream",
            "uploaded_by": user["id"],
        },
    )

    path = str(file_id)
    await db.files.insert_one({
        "id": str(uuid.uuid4()),
        "storage_path": path,
        "original_filename": file.filename,
        "content_type": file.content_type,
        "size": len(data),
        "uploaded_by": user["id"],
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"path": path, "filename": file.filename, "size": len(data)}


@api_router.get("/files/{path:path}")
async def download(path: str, request: Request, auth: Optional[str] = Query(None)):
    token = request.cookies.get("access_token") or auth
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(401, "Invalid token")

    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "Not found")

    try:
        grid_out = await gridfs_bucket.open_download_stream(ObjectId(path))
        data = await grid_out.read()
    except Exception:
        raise HTTPException(404, "File not found in storage")

    filename = record.get("original_filename", "file")
    return FastResponse(
        content=data,
        media_type=record.get("content_type") or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
