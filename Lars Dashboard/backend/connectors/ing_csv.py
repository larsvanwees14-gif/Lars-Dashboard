"""
ING CSV Import connector.

ING Nederland laat je rekeningafschriften exporteren als CSV.
Hoe exporteren:
  1. Open Mijn ING (app of website)
  2. Ga naar je rekening → Afschriften → Exporteren
  3. Kies CSV-formaat
  4. Upload het bestand via het dashboard

Dit is een betrouwbare fallback als FinTS niet werkt met ING NL.
"""
import csv
import io
import os
from datetime import datetime
from typing import Optional

from backend.connectors.base import BaseConnector, InvestmentData
from backend.cache import load_manual, save_manual

MANUAL_KEY_PREFIX = "ing_csv"

# ING NL CSV formaat:
# Datum;Naam/Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen;
ING_CSV_DELIMITER = ";"


def parse_ing_csv(file_content: str) -> Optional[float]:
    """
    Parseert een ING CSV export en extraheert het meest recente saldo.
    ING CSV bevat transacties, geen expliciet eindsaldo.
    We berekenen het saldo door de transacties te sommeren.

    Returns: Huidig saldo in EUR, of None als het bestand niet herkend wordt.
    """
    try:
        reader = csv.DictReader(
            io.StringIO(file_content),
            delimiter=ING_CSV_DELIMITER
        )
        rows = list(reader)
        if not rows:
            return None

        # ING CSV heeft "Af Bij" en "Bedrag (EUR)" kolommen
        # Probeer kolommen te detecteren (case-insensitive)
        headers = [h.strip().lower() for h in (rows[0].keys() if rows else [])]

        # Detecteer ING-formaat
        has_af_bij = any("af bij" in h for h in headers)
        has_bedrag = any("bedrag" in h for h in headers)

        if not (has_af_bij and has_bedrag):
            # Niet herkend als ING CSV
            return None

        # Bereken saldo op basis van transacties
        total = 0.0
        for row in rows:
            # Normaliseer kolomnamen
            row_lower = {k.strip().lower(): v.strip() for k, v in row.items()}

            af_bij = ""
            bedrag = 0.0

            for key, val in row_lower.items():
                if "af bij" in key:
                    af_bij = val.upper()
                if "bedrag" in key:
                    try:
                        bedrag = float(val.replace(".", "").replace(",", "."))
                    except ValueError:
                        bedrag = 0.0

            if af_bij == "BIJ":
                total += bedrag
            elif af_bij == "AF":
                total -= bedrag

        return round(total, 2)

    except Exception:
        return None


class IngCsvConnector(BaseConnector):
    """
    Leest ING rekening saldi uit geüploade CSV-bestanden.
    Elk account heeft een eigen geüpload bestand.
    """

    def __init__(self, config: dict):
        self.config = config
        self.account_configs = config.get("accounts", [])

    def fetch(self) -> list[InvestmentData]:
        investments = []

        for acc in self.account_configs:
            iban = acc.get("iban", "unknown")
            label = acc.get("label", f"ING {iban[-4:]}")
            category = acc.get("category", "cash")
            manual_key = f"{MANUAL_KEY_PREFIX}_{iban.replace(' ', '').lower()}"

            stored = load_manual(manual_key)
            balance = stored.get("balance_eur", 0.0)
            last_updated = stored.get("last_updated")
            source = stored.get("source", "csv_not_uploaded")

            investments.append(InvestmentData(
                name=label,
                category=category,
                current_value_eur=balance,
                monthly_pnl_eur=0.0,
                source=source,
                last_updated=last_updated
            ))

        # Fallback als geen accounts geconfigureerd zijn
        if not investments:
            stored = load_manual(f"{MANUAL_KEY_PREFIX}_default")
            investments.append(InvestmentData(
                name="ING Bank",
                category="cash",
                current_value_eur=stored.get("balance_eur", 0.0),
                monthly_pnl_eur=0.0,
                source=stored.get("source", "csv_not_uploaded"),
                last_updated=stored.get("last_updated")
            ))

        return investments

    def process_upload(self, iban: str, file_content: str) -> dict:
        """
        Verwerkt een geüpload ING CSV bestand.
        Returns: {"success": True, "balance": 1234.56} of {"success": False, "error": "..."}
        """
        balance = parse_ing_csv(file_content)

        if balance is None:
            return {
                "success": False,
                "error": "Bestand niet herkend als ING CSV export. "
                         "Controleer of je het juiste formaat hebt geëxporteerd."
            }

        # Zoek de accountlabel op basis van IBAN
        label = "ING Bank"
        for acc in self.account_configs:
            if acc.get("iban") == iban:
                label = acc.get("label", label)
                break

        manual_key = f"{MANUAL_KEY_PREFIX}_{iban.replace(' ', '').lower()}" if iban != "default" else f"{MANUAL_KEY_PREFIX}_default"

        save_manual(manual_key, {
            "balance_eur": balance,
            "iban": iban,
            "label": label,
            "source": "csv_imported",
            "last_updated": datetime.now().isoformat()
        })

        return {"success": True, "balance": balance, "label": label}
