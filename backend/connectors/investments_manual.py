from datetime import datetime
from backend.connectors.base import BaseConnector, InvestmentData
from backend.cache import load_manual, save_manual

MANUAL_KEY = "investments"


class InvestmentsManualConnector(BaseConnector):
    """Manual entry for savings and loans."""

    def fetch(self) -> list[InvestmentData]:
        data = load_manual(MANUAL_KEY)
        results = []

        # Savings
        savings = data.get("savings", {})
        results.append(InvestmentData(
            name="Savings",
            category="savings",
            current_value_eur=savings.get("balance_eur", 0.0),
            source="manual",
            last_updated=savings.get("last_updated")
        ))

        # Loans (money lent to others — asset)
        loans = data.get("loans", {})
        results.append(InvestmentData(
            name="Loans",
            category="loans",
            current_value_eur=loans.get("balance_eur", 0.0),
            source="manual",
            last_updated=loans.get("last_updated")
        ))

        return results

    @staticmethod
    def save_savings(balance_eur: float):
        data = load_manual(MANUAL_KEY)
        data["savings"] = {
            "balance_eur": balance_eur,
            "last_updated": datetime.now().isoformat()
        }
        save_manual(MANUAL_KEY, data)

    @staticmethod
    def get_loan_items() -> list[dict]:
        """Returns individual loan items."""
        data = load_manual(MANUAL_KEY)
        return data.get("loan_items", [])

    @staticmethod
    def save_loan_items(items: list[dict]):
        """Save loan items and update total. Each item: {name, amount_eur, deadline}."""
        data = load_manual(MANUAL_KEY)
        clean_items = [
            {
                "name": it.get("name", ""),
                "amount_eur": float(it.get("amount_eur", 0)),
                "deadline": it.get("deadline", ""),
            }
            for it in items if it.get("name")
        ]
        data["loan_items"] = clean_items
        data["loans"] = {
            "balance_eur": sum(it["amount_eur"] for it in clean_items),
            "last_updated": datetime.now().isoformat()
        }
        save_manual(MANUAL_KEY, data)
