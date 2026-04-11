from datetime import datetime
from backend.connectors.base import BaseConnector, BusinessData, MonthData
from backend.cache import load_manual, save_manual

MANUAL_KEY = "supplement_brand"


class SupplementManualConnector(BaseConnector):
    """Handmatige invoer voor het US supplement merk."""

    def __init__(self, config: dict):
        self.config = config
        self.business_name = config.get("business_name", "US Supplement Brand")
        self.entity = config.get("entity", "LLC")
        self.currency = config.get("currency", "USD")

    def fetch(self) -> list[BusinessData]:
        data = load_manual(MANUAL_KEY)
        months_raw = data.get("months", [])

        months = [
            MonthData(
                year=m["year"],
                month=m["month"],
                revenue=m.get("revenue", 0.0),
                expenses=m.get("expenses", 0.0),
                profit=m.get("profit", 0.0),
                currency=self.currency
            )
            for m in months_raw
        ]
        months.sort(key=lambda m: (m.year, m.month))

        last_updated = data.get("last_updated", None)

        return [BusinessData(
            name=self.business_name,
            entity=self.entity,
            currency=self.currency,
            months=months,
            source="manual",
            last_updated=last_updated
        )]

    @staticmethod
    def save_month(year: int, month: int, revenue: float, expenses: float):
        """Slaat één maand op of werkt hem bij."""
        data = load_manual(MANUAL_KEY)
        months = data.get("months", [])

        # Update bestaande maand of voeg nieuwe toe
        for m in months:
            if m["year"] == year and m["month"] == month:
                m["revenue"] = revenue
                m["expenses"] = expenses
                m["profit"] = revenue - expenses
                break
        else:
            months.append({
                "year": year,
                "month": month,
                "revenue": revenue,
                "expenses": expenses,
                "profit": revenue - expenses
            })

        data["months"] = sorted(months, key=lambda m: (m["year"], m["month"]))
        data["last_updated"] = datetime.now().isoformat()
        save_manual(MANUAL_KEY, data)
