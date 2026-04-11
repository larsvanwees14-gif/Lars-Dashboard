"""
Simpele cache module — slaat data op als JSON bestanden.
- load_cache / save_cache / is_cache_stale: voor API-gecachte data (data/cache/)
- load_manual / save_manual: voor handmatig ingevoerde data (data/manual/)
"""
import json
import os
from datetime import datetime

BASE_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE_DIR = os.path.join(BASE_DIR, "cache")
MANUAL_DIR = os.path.join(BASE_DIR, "manual")


def _cache_path(key: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{key}.json")


def _manual_path(key: str) -> str:
    os.makedirs(MANUAL_DIR, exist_ok=True)
    return os.path.join(MANUAL_DIR, f"{key}.json")


def load_cache(key: str) -> dict:
    path = _cache_path(key)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


def save_cache(key: str, data: dict):
    path = _cache_path(key)
    payload = {
        "data": data,
        "saved_at": datetime.now().isoformat()
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def is_cache_stale(key: str, ttl_hours: float = 1) -> bool:
    cached = load_cache(key)
    if not cached:
        return True
    try:
        saved_at = datetime.fromisoformat(cached.get("saved_at", ""))
        age_hours = (datetime.now() - saved_at).total_seconds() / 3600
        return age_hours >= ttl_hours
    except Exception:
        return True


def load_manual(key: str) -> dict:
    path = _manual_path(key)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_manual(key: str, data: dict):
    path = _manual_path(key)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
