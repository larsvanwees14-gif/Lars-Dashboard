"""
Shopify connector — leest maandelijkse Shopify + Google Ads data uit een Google Sheet.
Sheet ID: 1Ch8VATCW0YE0KS9qbbUSXwHE_5Vauy3mbAauEZsr9Ek

Sheet structure (one tab per month, e.g. "Jan", "March"):
  Row 1: empty
  Row 2: [Nett Revenue, value, ...]  ... [Meta, Google, Total Paid]
  Row 3: [Gross Margin Product Level, value, pct, ..., Spend, meta_spend, google_spend, total]
  Row 4: [Nett Margin Product Level, value, pct, ..., Revenue, meta_rev, google_rev, total]
  Row 5: [Nett Margin Business, value, pct, ..., Roas, meta_roas, google_roas, total]
  Row 6: [Acc Roas blended, value, ..., % Paid, ...]
"""
import os
from datetime import datetime
from typing import Optional

from backend.cache import load_cache, save_cache, is_cache_stale

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
SPREADSHEET_ID = "1Ch8VATCW0YE0KS9qbbUSXwHE_5Vauy3mbAauEZsr9Ek"
CACHE_KEY = "shopify_sheets"
CACHE_TTL_HOURS = 0.083  # ~5 minutes

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8, "sep": 9,
    "oct": 10, "nov": 11, "dec": 12,
}

SKIP_TABS = {"template", "break even roas", "break-even", "roas", "info", "settings", "config"}


def _safe_float(value) -> float:
    if value is None:
        return 0.0
    s = str(value).strip()
    if s in ("", "-", "#DIV/0!", "#VALUE!", "#REF!", "#N/A"):
        return 0.0
    s = s.replace("€", "").replace("$", "").replace("%", "")
    # Dutch number format: dots as thousands separator, comma as decimal
    # e.g. "2.363,2" → 2363.2 or "0,00" → 0.00
    if "," in s and "." in s:
        # "2.363,2" style
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    s = s.replace("- ", "-").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def _get(rows, row_idx, col_idx) -> str:
    if row_idx >= len(rows):
        return ""
    row = rows[row_idx]
    if col_idx >= len(row):
        return ""
    return str(row[col_idx]).strip()


class ShopifySheetsConnector:
    def __init__(self, credentials_file: str = None):
        self.credentials_file = credentials_file or os.path.expanduser(
            "~/.lars-dashboard/google_service_account.json"
        )
        self._service = None

    def _get_service(self):
        if self._service:
            return self._service
        if not GOOGLE_AVAILABLE:
            raise RuntimeError("Google API libraries not installed.")

        import json as _json
        env_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if env_creds:
            info = _json.loads(env_creds)
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        elif os.path.exists(self.credentials_file):
            creds = service_account.Credentials.from_service_account_file(self.credentials_file, scopes=SCOPES)
        else:
            raise FileNotFoundError(f"Google service account not found: {self.credentials_file}")
        self._service = build("sheets", "v4", credentials=creds)
        return self._service

    def fetch(self) -> list[dict]:
        """Fetch monthly Shopify data. Returns list of month dicts sorted by (year, month)."""
        if not is_cache_stale(CACHE_KEY, CACHE_TTL_HOURS):
            cached = load_cache(CACHE_KEY)
            if cached and "data" in cached:
                return cached["data"].get("months", [])

        try:
            months = self._fetch_from_sheet()
            save_cache(CACHE_KEY, {"months": months})
            return months
        except Exception:
            cached = load_cache(CACHE_KEY)
            if cached and "data" in cached:
                return cached["data"].get("months", [])
            raise

    def _infer_year(self, month_num: int) -> int:
        """Infer year from month number — months in the future belong to last year."""
        today = datetime.now()
        if month_num > today.month + 1:
            return today.year - 1
        return today.year

    def _fetch_from_sheet(self) -> list[dict]:
        service = self._get_service()

        meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]

        months = []
        for tab in tabs:
            tab_lower = tab.strip().lower()

            # Skip non-month tabs
            if tab_lower in SKIP_TABS:
                continue
            if any(skip in tab_lower for skip in ("template", "break even", "roas")):
                continue

            # Parse tab name as month
            month_num = MONTH_NAMES.get(tab_lower)
            if not month_num:
                continue

            year = self._infer_year(month_num)

            # Fetch rows A1:H8
            result = service.spreadsheets().values().get(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{tab}'!A1:H8"
            ).execute()
            rows = result.get("values", [])

            # Label-gebaseerde detectie: zoek rijen op basis van kolom A inhoud
            # (rijnummers kunnen per tab variëren)
            def find_row(keyword):
                for r in rows:
                    if r and str(r[0]).strip().lower().startswith(keyword.lower()):
                        return r
                return []

            row_revenue  = find_row("Nett Revenue")
            row_business = find_row("Nett Margin Business")
            row_spend    = next((r for r in rows if len(r) > 5 and str(r[5]).strip().lower() == "spend"), [])
            row_roas     = next((r for r in rows if len(r) > 5 and "roas blended" in str(r[5]).strip().lower()), [])

            revenue_raw    = row_revenue[1]  if len(row_revenue)  > 1 else ""
            profit_raw     = row_business[1] if len(row_business) > 1 else ""
            profit_pct_raw = row_business[2] if len(row_business) > 2 else ""
            google_spend_raw = row_spend[6]  if len(row_spend)    > 6 else ""
            google_roas_raw  = row_roas[6]   if len(row_roas)     > 6 else ""

            revenue = _safe_float(revenue_raw)
            profit = _safe_float(profit_raw)
            google_spend = _safe_float(google_spend_raw)
            google_roas = _safe_float(google_roas_raw)

            # Profit margin: use sheet value if available, else calculate
            if profit_pct_raw and profit_pct_raw not in ("#DIV/0!", "#VALUE!"):
                profit_margin = _safe_float(profit_pct_raw)
            elif revenue > 0:
                profit_margin = round(profit / revenue * 100, 1)
            else:
                profit_margin = 0.0

            # Skip months with no real data (revenue and profit both 0, no spend)
            if revenue == 0 and profit == 0 and google_spend == 0:
                continue

            label_months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
            months.append({
                "year": year,
                "month": month_num,
                "label": f"{label_months[month_num - 1]} {year}",
                "revenue": round(revenue, 2),
                "profit": round(profit, 2),
                "google_spend": round(google_spend, 2),
                "roas": round(google_roas, 2),
                "profit_margin": round(profit_margin, 1),
            })

        months.sort(key=lambda m: (m["year"], m["month"]))
        return months
