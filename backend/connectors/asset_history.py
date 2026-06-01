"""
Asset History — slaat maandelijkse snapshots op van de portfolio.
Bij eerste dashboard load van de maand wordt automatisch een snapshot opgeslagen.
"""
import json
import os
from datetime import datetime

_DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
HISTORY_FILE = os.path.join(_DATA_DIR, "manual", "asset_history.json")


def load_history() -> list:
    """Laad alle snapshots."""
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r") as f:
            data = json.load(f)
        return data.get("snapshots", [])
    except Exception:
        return []


def save_snapshot(net_worth: dict) -> bool:
    """
    Sla een snapshot op voor de huidige maand als die nog niet bestaat.
    Returns True als een nieuwe snapshot is opgeslagen.
    """
    now = datetime.now()
    year = now.year
    month = now.month

    snapshots = load_history()

    # Check of deze maand al een snapshot heeft
    existing = [s for s in snapshots if s.get("year") == year and s.get("month") == month]
    if existing:
        # Update bestaande snapshot met nieuwste waarden
        snap = existing[0]
        _update_snap(snap, net_worth, now)
        _save(snapshots)
        return False

    # Nieuwe snapshot aanmaken
    snap = {
        "date": now.strftime("%Y-%m-%d"),
        "year": year,
        "month": month,
    }
    _update_snap(snap, net_worth, now)
    snapshots.append(snap)
    snapshots.sort(key=lambda s: (s["year"], s["month"]))
    _save(snapshots)
    return True


def _update_snap(snap: dict, net_worth: dict, now: datetime):
    """Vul snapshot met huidige waarden uit net_worth breakdown."""
    snap["total"] = round(net_worth.get("total_eur", 0), 0)
    snap["updated_at"] = now.isoformat()

    breakdown = net_worth.get("breakdown", [])
    category_map = {"stocks": 0.0, "crypto": 0.0, "savings": 0.0, "loans": 0.0}
    for item in breakdown:
        cat = item.get("category", "")
        if cat in category_map:
            category_map[cat] = round(item.get("value_eur", 0), 2)

    snap.update(category_map)


def _save(snapshots: list):
    """Schrijf snapshots naar bestand."""
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump({"snapshots": snapshots}, f, indent=2)


def get_history() -> list:
    """Return alle snapshots gesorteerd op datum."""
    snapshots = load_history()
    snapshots.sort(key=lambda s: (s.get("year", 0), s.get("month", 0)))
    return snapshots
