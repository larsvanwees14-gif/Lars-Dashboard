from datetime import datetime
from backend.connectors.base import BaseConnector, InvestmentData
from backend.cache import load_manual, save_manual

MANUAL_KEY = "revolut_crypto"


class RevolutManualConnector(BaseConnector):
    """
    Handmatige invoer voor Revolut crypto holdings.
    Revolut Personal heeft geen publieke API, dus dit wordt handmatig bijgehouden.
    """

    def fetch(self) -> list[InvestmentData]:
        data = load_manual(MANUAL_KEY)
        holdings = data.get("holdings", [])

        total_value = sum(h.get("value_eur", 0.0) for h in holdings)
        previous_total = data.get("previous_month_value_eur", total_value)
        monthly_pnl = total_value - previous_total

        last_updated = data.get("last_updated", None)

        return [InvestmentData(
            name="Revolut Crypto",
            category="crypto",
            current_value_eur=total_value,
            monthly_pnl_eur=monthly_pnl,
            source="manual",
            last_updated=last_updated
        )]

    @staticmethod
    def get_holdings() -> list[dict]:
        data = load_manual(MANUAL_KEY)
        return data.get("holdings", [])

    @staticmethod
    def save_holdings(holdings: list[dict]):
        """
        Sla holdings op.
        holdings = [{"symbol": "BTC", "amount": 0.5, "value_eur": 20000}, ...]
        """
        data = load_manual(MANUAL_KEY)
        # Bewaar vorige totaalwaarde voor maandelijkse P&L berekening
        old_holdings = data.get("holdings", [])
        old_total = sum(h.get("value_eur", 0.0) for h in old_holdings)
        if old_total > 0:
            data["previous_month_value_eur"] = old_total

        data["holdings"] = holdings
        data["last_updated"] = datetime.now().isoformat()
        save_manual(MANUAL_KEY, data)
