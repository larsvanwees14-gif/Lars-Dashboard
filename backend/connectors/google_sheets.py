import os
import re
from datetime import datetime
from typing import Optional

from backend.connectors.base import BaseConnector, BusinessData, MonthData
from backend.cache import load_cache, save_cache, is_cache_stale

# Optioneel: Google API imports
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# Ondersteunde tabblad-naam formaten
TAB_FORMATS = [
    "%b %Y",        # Jan 2025
    "%B %Y",        # January 2025
    "%m-%Y",        # 01-2025
    "%Y-%m",        # 2025-01
    "%b '%y",       # Jan '25
]


MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def parse_tab_name(name: str, default_year: int = None) -> Optional[tuple[int, int]]:
    """Probeert een tabblad-naam te parsen als (jaar, maand). Geeft None terug bij mislukking."""
    name = name.strip()

    # Try standard formats first
    for fmt in TAB_FORMATS:
        try:
            dt = datetime.strptime(name, fmt)
            return (dt.year, dt.month)
        except ValueError:
            continue

    # Try month name only (e.g. "March", "February")
    if default_year and name.lower() in MONTH_NAMES:
        return (default_year, MONTH_NAMES[name.lower()])

    return None


def parse_cell_ref(cell: str) -> tuple[int, int]:
    """Parses a cell reference like 'C4' into (row_index, col_index) 0-based."""
    match = re.match(r'^([A-Za-z]+)(\d+)$', cell.strip())
    if not match:
        raise ValueError(f"Invalid cell reference: {cell}")
    col = col_letter_to_index(match.group(1))
    row = int(match.group(2)) - 1  # 0-based
    return (row, col)


def col_letter_to_index(letter: str) -> int:
    """Converteert kolomletter (A, B, C...) naar 0-gebaseerde index."""
    letter = letter.upper().strip()
    result = 0
    for char in letter:
        result = result * 26 + (ord(char) - ord('A') + 1)
    return result - 1


def safe_float(value) -> float:
    """Converteert een cel-waarde naar float, negeert valutatekens."""
    if value is None or value == "":
        return 0.0
    s = str(value).replace("€", "").replace("$", "").replace(".", "").replace(",", ".").replace("- ", "-").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


class GoogleSheetsConnector(BaseConnector):
    """
    Leest financiële data uit Google Spreadsheets.
    Elk spreadsheet heeft 1 tabblad per maand (bijv. 'Jan 2025').
    """

    def __init__(self, config: dict):
        self.config = config
        self.spreadsheets = config.get("spreadsheets", {})
        self.credentials_file = os.path.expanduser(
            config.get("credentials_file", "~/.lars-dashboard/google_service_account.json")
        )
        self._service = None

    def _get_service(self):
        if self._service:
            return self._service
        if not GOOGLE_AVAILABLE:
            raise RuntimeError("Google API libraries niet geïnstalleerd. Voer 'pip install google-api-python-client google-auth' uit.")

        # Support credentials via environment variable (Railway / cloud deployment)
        import json as _json
        env_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if env_creds:
            info = _json.loads(env_creds)
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        elif os.path.exists(self.credentials_file):
            creds = service_account.Credentials.from_service_account_file(self.credentials_file, scopes=SCOPES)
        else:
            raise FileNotFoundError(
                f"Google service account niet gevonden: {self.credentials_file}\n"
                "Stel GOOGLE_SERVICE_ACCOUNT_JSON in als omgevingsvariabele."
            )
        self._service = build("sheets", "v4", credentials=creds)
        return self._service

    def _read_sheet(self, spreadsheet_id: str, sheet_config: dict) -> list[MonthData]:
        """Routes to the right read method based on config."""
        if "overview_tab" in sheet_config:
            return self._read_sheet_overview_blocks(spreadsheet_id, sheet_config)
        if "fixed_cells" in sheet_config:
            return self._read_sheet_fixed_cells(spreadsheet_id, sheet_config)
        return self._read_sheet_columns(spreadsheet_id, sheet_config)

    def _read_sheet_overview_blocks(self, spreadsheet_id: str, sheet_config: dict) -> list[MonthData]:
        """Reads repeating monthly blocks from an Overview tab.
        Each block starts with 'Month' label, followed by Revenue, Gross Margin, etc."""
        service = self._get_service()
        tab = sheet_config.get("overview_tab", "Overview")

        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{tab}'!A1:J200"
        ).execute()
        rows = result.get("values", [])

        months = []
        current_month = None
        block = {}

        # Auto-detect label column: check if row labels are in col A or col B
        label_col = 0  # default col A
        for row in rows:
            if len(row) > 1 and str(row[1]).strip() == "Month":
                label_col = 1  # col B
                break
            if len(row) > 0 and str(row[0]).strip() == "Month":
                label_col = 0  # col A
                break

        for row in rows:
            if len(row) <= label_col:
                continue

            label = str(row[label_col]).strip()
            val = row[label_col + 1] if len(row) > label_col + 1 else ""
            pct = row[label_col + 2] if len(row) > label_col + 2 else ""

            # Fee Lars sometimes on its own row (different column layout)
            fee_label = ""
            fee_val = ""
            if label_col == 1 and len(row) > 5:
                fee_label = str(row[5]).strip()
                fee_val = row[6] if len(row) > 6 else ""
            elif label_col == 0 and len(row) > 0:
                # Fee Lars can be on its own row in col A
                fee_label = label
                fee_val = row[1] if len(row) > 1 else ""

            if label == "Month":
                if current_month and block:
                    months.append(self._build_overview_month(current_month, block))
                current_month = str(val).strip()
                block = {}
            elif label in ("Nett Revenue", "Revenue"):
                block["revenue"] = safe_float(val)
            elif "Gross Margin" in label:
                block["gross_margin"] = safe_float(val)
                block["gross_margin_pct"] = safe_float(pct)
            elif "Nett Margin Product" in label:
                block["nett_margin_product"] = safe_float(val)
                block["nett_margin_product_pct"] = safe_float(pct)
            elif label == "Nett Margin Business":
                block["profit"] = safe_float(val)
                block["profit_pct"] = safe_float(pct)

            # Fee Lars detection — scan all cells in this row.
            # Priority: "Profit Fee Lars" (Lars's net profit after his own costs)
            #           > "Fee Lars" / "Profit Lars" (invoice amount, fallback)
            for ci in range(len(row)):
                cell_str = str(row[ci]).strip()
                if cell_str == "Profit Fee Lars" and ci + 1 < len(row):
                    # Highest priority — always overwrite
                    block["fee_lars"] = safe_float(row[ci + 1])
                elif cell_str in ("Profit Lars", "Fee Lars") and ci + 1 < len(row):
                    # Only use as fallback if "Profit Fee Lars" not yet found
                    if "fee_lars" not in block:
                        block["fee_lars"] = safe_float(row[ci + 1])

        # Don't forget the last block
        if current_month and block:
            months.append(self._build_overview_month(current_month, block))

        return sorted(months, key=lambda m: (m.year, m.month))

    def _build_overview_month(self, month_name: str, block: dict) -> MonthData:
        """Converts a month name + data block into a MonthData."""
        month_num = MONTH_NAMES.get(month_name.lower(), 0)
        # Determine year: maanden na de huidige maand = vorig jaar
        today_year = datetime.now().year
        today_month = datetime.now().month
        if month_num > today_month:
            year = today_year - 1
        else:
            year = today_year

        revenue = block.get("revenue", 0)
        # profit = Nett Margin Business (full business profit — what the company earns)
        profit = block.get("profit", 0)
        # fee_lars lives in extra["fee_lars"] = what Lars personally earns from the brand
        expenses = revenue - profit if revenue else 0

        # Build extra: exclude "revenue" and "profit" (profit is on MonthData directly)
        extra = {k: v for k, v in block.items() if k not in ("revenue", "profit")}

        return MonthData(
            year=year,
            month=month_num,
            revenue=revenue,
            expenses=expenses,
            profit=profit,
            currency="EUR",
            extra=extra
        )

    def _read_sheet_fixed_cells(self, spreadsheet_id: str, sheet_config: dict) -> list[MonthData]:
        """Reads fixed cell positions per month tab (e.g. C4=revenue, C7=profit)."""
        service = self._get_service()
        sheets_meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        tabs = [s["properties"]["title"] for s in sheets_meta.get("sheets", [])]

        cells = sheet_config.get("fixed_cells", {})
        default_year = sheet_config.get("default_year", datetime.now().year)

        months = []
        for tab in tabs:
            parsed = parse_tab_name(tab, default_year=default_year)
            if not parsed:
                continue
            year, month = parsed

            range_notation = f"'{tab}'!A1:Z20"
            result = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=range_notation
            ).execute()
            rows = result.get("values", [])

            def get_cell_raw(cell_ref: str) -> str:
                row_idx, col_idx = parse_cell_ref(cell_ref)
                if row_idx < len(rows) and col_idx < len(rows[row_idx]):
                    return str(rows[row_idx][col_idx])
                return ""

            def get_cell(cell_ref: str) -> float:
                return safe_float(get_cell_raw(cell_ref))

            revenue = get_cell(cells.get("revenue", "C4"))
            profit = get_cell(cells.get("profit", "C7"))
            expenses = revenue - profit if revenue else 0.0

            # Read all extra KPIs into a dict
            extra = {}
            for key, cell_ref in cells.items():
                if key in ("revenue", "profit"):
                    continue
                raw = get_cell_raw(cell_ref)
                if "%" in raw or key.endswith("_pct"):
                    # Store as percentage string
                    extra[key] = raw.replace(",", ".").replace("%", "").strip()
                    try:
                        extra[key] = float(extra[key])
                    except ValueError:
                        extra[key] = 0.0
                else:
                    extra[key] = safe_float(raw)

            # Scan for overhead totals (section shifts per month tab, so detect dynamically)
            try:
                oh_result = service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{tab}'!A95:C220"
                ).execute()
                oh_rows = oh_result.get("values", [])
                for oh_row in oh_rows:
                    if len(oh_row) < 2:
                        continue
                    label = str(oh_row[1]).strip() if len(oh_row) > 1 else str(oh_row[0]).strip()
                    val_str = oh_row[2] if len(oh_row) > 2 else ""
                    if label == "Total (Normal)":
                        extra["overhead_normal"] = safe_float(val_str)
                    elif label == "Total (Investment)":
                        extra["overhead_investment"] = safe_float(val_str)
                if "overhead_normal" in extra or "overhead_investment" in extra:
                    extra["overhead_total"] = extra.get("overhead_normal", 0) + extra.get("overhead_investment", 0)
            except Exception:
                pass

            months.append(MonthData(
                year=year,
                month=month,
                revenue=revenue,
                expenses=expenses,
                profit=profit,
                currency="EUR",
                extra=extra
            ))

        return sorted(months, key=lambda m: (m.year, m.month))

    def _read_sheet_columns(self, spreadsheet_id: str, sheet_config: dict) -> list[MonthData]:
        """Original: reads columns and sums rows per month tab."""
        service = self._get_service()
        sheets_meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        tabs = [s["properties"]["title"] for s in sheets_meta.get("sheets", [])]

        col_revenue = col_letter_to_index(sheet_config.get("columns", {}).get("revenue", "B"))
        col_expenses = col_letter_to_index(sheet_config.get("columns", {}).get("expenses", "C"))
        col_profit = col_letter_to_index(sheet_config.get("columns", {}).get("profit", "D"))
        data_row_start = sheet_config.get("data_row_start", 2)

        months = []
        for tab in tabs:
            parsed = parse_tab_name(tab)
            if not parsed:
                continue
            year, month = parsed

            range_notation = f"'{tab}'!A{data_row_start}:Z"
            result = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=range_notation
            ).execute()
            rows = result.get("values", [])

            total_revenue = 0.0
            total_expenses = 0.0
            total_profit = 0.0

            for row in rows:
                def get_col(r, idx):
                    return r[idx] if idx < len(r) else ""

                total_revenue += safe_float(get_col(row, col_revenue))
                total_expenses += safe_float(get_col(row, col_expenses))
                total_profit += safe_float(get_col(row, col_profit))

            if total_profit == 0 and total_revenue != 0:
                total_profit = total_revenue - total_expenses

            months.append(MonthData(
                year=year,
                month=month,
                revenue=total_revenue,
                expenses=total_expenses,
                profit=total_profit,
                currency="EUR"
            ))

        return sorted(months, key=lambda m: (m.year, m.month))

    def fetch(self) -> list[BusinessData]:
        businesses = []
        now = datetime.now().isoformat()

        for key, sheet_config in self.spreadsheets.items():
            spreadsheet_id = sheet_config.get("id", "")
            business_name = sheet_config.get("business_name", key)
            entity = sheet_config.get("entity", "BV")
            cache_key = f"sheets_{key}"

            if not spreadsheet_id or spreadsheet_id.startswith("VULL_"):
                # Placeholder - nog niet geconfigureerd
                businesses.append(BusinessData(
                    name=business_name,
                    entity=entity,
                    source="not_configured",
                    last_updated=now
                ))
                continue

            if not is_cache_stale(cache_key, ttl_hours=0.08):  # ~5 min cache
                cached = load_cache(cache_key)
                if cached and "data" in cached:
                    months = [MonthData(
                        year=m["year"], month=m["month"], revenue=m["revenue"],
                        expenses=m["expenses"], profit=m["profit"],
                        currency=m.get("currency", "EUR"), extra=m.get("extra", {})
                    ) for m in cached["data"]["months"]]
                    businesses.append(BusinessData(
                        name=business_name,
                        entity=entity,
                        months=months,
                        source="google_sheets",
                        last_updated=cached["saved_at"]
                    ))
                    continue

            try:
                months = self._read_sheet(spreadsheet_id, sheet_config)
                save_cache(cache_key, {
                    "months": [
                        {"year": m.year, "month": m.month, "revenue": m.revenue,
                         "expenses": m.expenses, "profit": m.profit, "currency": m.currency,
                         "extra": m.extra}
                        for m in months
                    ]
                })
                businesses.append(BusinessData(
                    name=business_name,
                    entity=entity,
                    months=months,
                    source="google_sheets",
                    last_updated=now
                ))
            except Exception as e:
                businesses.append(BusinessData(
                    name=business_name,
                    entity=entity,
                    source="error",
                    last_updated=str(e)
                ))

        return businesses
