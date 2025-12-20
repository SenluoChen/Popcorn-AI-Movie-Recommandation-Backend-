from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


def _local_data_dir() -> Path:
    raw = os.environ.get("LOCAL_DATA_PATH")
    if not raw or not str(raw).strip():
        raw = "/opt/data"
    return Path(str(raw)).expanduser().resolve() / "index"


def _ensure_index_downloaded() -> None:
    """Download faiss.index + meta.json from S3 if missing.

    Env:
      - INDEX_BUCKET (required)
      - INDEX_PREFIX (optional, default "index")
    """

    index_dir = _local_data_dir()
    index_dir.mkdir(parents=True, exist_ok=True)

    index_path = index_dir / "faiss.index"
    meta_path = index_dir / "meta.json"

    if index_path.exists() and meta_path.exists():
        return

    bucket = os.environ.get("INDEX_BUCKET")
    if not bucket:
        raise RuntimeError("Missing INDEX_BUCKET env var")

    prefix = os.environ.get("INDEX_PREFIX") or "index"
    prefix = prefix.strip("/")

    import boto3

    s3 = boto3.client("s3")

    s3.download_file(bucket, f"{prefix}/faiss.index", str(index_path))
    s3.download_file(bucket, f"{prefix}/meta.json", str(meta_path))


class SearchRequest(BaseModel):
    vector: list[float] = Field(..., description="Query embedding vector")
    topK: int = Field(50, ge=1, le=200)


def _load_assets() -> tuple[Any, dict[str, Any]]:
    _ensure_index_downloaded()

    data_dir = _local_data_dir()
    index_path = data_dir / "faiss.index"
    meta_path = data_dir / "meta.json"

    if not index_path.exists() or not meta_path.exists():
        raise FileNotFoundError("Missing index assets (faiss.index/meta.json)")

    import faiss

    index = faiss.read_index(str(index_path))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if not isinstance(meta, dict) or "items" not in meta:
        raise ValueError("meta.json must be an object with an 'items' field")
    return index, meta


app = FastAPI()

_INDEX = None
_META: dict[str, Any] | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
def _startup() -> None:
    global _INDEX, _META
    _INDEX, _META = _load_assets()


@app.post("/search")
def search(req: SearchRequest) -> dict[str, Any]:
    if _INDEX is None or _META is None:
        raise HTTPException(status_code=500, detail="Index not loaded")

    items = _META.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=500, detail="Invalid meta.json")

    dim = int(_META.get("dim") or 0)
    if dim <= 0:
        raise HTTPException(status_code=500, detail="Invalid vector dim in meta.json")

    q = np.asarray(req.vector, dtype=np.float32)
    if q.ndim != 1 or q.shape[0] != dim:
        raise HTTPException(status_code=400, detail=f"vector must have length {dim}")
    if not np.all(np.isfinite(q)):
        raise HTTPException(status_code=400, detail="vector contains non-finite values")

    # L2 normalize for cosine similarity
    norm = float(np.linalg.norm(q))
    if norm == 0:
        raise HTTPException(status_code=400, detail="vector norm is 0")
    q = (q / norm).reshape(1, dim)

    k = int(min(max(1, req.topK), len(items)))
    distances, indices = _INDEX.search(q, k)

    results: list[dict[str, Any]] = []
    for score, idx in zip(distances[0].tolist(), indices[0].tolist()):
        if idx < 0 or idx >= len(items):
            continue
        m = items[idx] if isinstance(items[idx], dict) else {}
        results.append(
            {
                "imdbId": m.get("imdbId"),
                "title": m.get("title"),
                "year": m.get("year"),
                "productionCountry": m.get("productionCountry"),
                "score": float(score),
                "similarity": float(score),
            }
        )

    return {"results": results}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.environ.get("PORT") or "8008"), reload=False)
