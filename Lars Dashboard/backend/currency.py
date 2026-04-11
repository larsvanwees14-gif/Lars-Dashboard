import requests
from datetime import date
from backend.cache import load_cache, save_cache, is_cache_stale

CACHE_KEY = "exchange_rates"
API_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR"


def get_usd_to_eur() -> float:
    """Geeft de USD->EUR wisselkoers terug. Gecached voor 24 uur."""
    if not is_cache_stale(CACHE_KEY, ttl_hours=24):
        cached = load_cache(CACHE_KEY)
        if cached and "data" in cached:
            return cached["data"].get("usd_eur", 0.92)

    try:
        resp = requests.get(API_URL, timeout=5)
        resp.raise_for_status()
        rate = resp.json()["rates"]["EUR"]
        save_cache(CACHE_KEY, {"usd_eur": rate, "date": date.today().isoformat()})
        return rate
    except Exception:
        # Fallback als API niet beschikbaar is
        cached = load_cache(CACHE_KEY)
        if cached and "data" in cached:
            return cached["data"].get("usd_eur", 0.92)
        return 0.92


def convert_to_eur(amount: float, currency: str) -> float:
    """Converteert een bedrag naar EUR."""
    currency = currency.upper()
    if currency == "EUR":
        return amount
    if currency == "USD":
        return amount * get_usd_to_eur()
    # Voeg meer valuta toe indien nodig
    return amount


def format_eur(amount: float) -> str:
    """Formatteert een bedrag als EUR string."""
    if amount >= 0:
        return f"€ {amount:,.0f}".replace(",", ".")
    return f"-€ {abs(amount):,.0f}".replace(",", ".")
