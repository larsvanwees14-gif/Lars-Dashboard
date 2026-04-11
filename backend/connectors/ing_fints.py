"""
ING Bank connector via FinTS/HBCI protocol.

FinTS is primair een Duits bankprotocol. Of dit werkt met ING Nederland
hangt af van of ING NL een FinTS-endpoint aanbiedt.

Als de verbinding mislukt, wordt automatisch teruggevallen op de handmatige
invoer of de CSV-import connector.
"""
import json
import os
from datetime import datetime
from typing import Optional

from backend.connectors.base import BaseConnector, InvestmentData
from backend.cache import load_cache, save_cache, is_cache_stale

# Bekende ING FinTS endpoints
# ING Duitsland (ING-DiBa / ING DE):
ING_DE_SERVER = "https://fints.ing.de/fints"
ING_DE_BLZ = "50010517"

# ING Nederland: geen bekend publiek FinTS-endpoint beschikbaar.
# Stel in via config.yaml als je een endpoint kent.


class IngFintsConnector(BaseConnector):
    """
    Haalt ING rekeningsaldi op via FinTS (HBCI) protocol.

    Configuratie in config.yaml:
        ing:
          fints_server: "https://fints.ing.de/fints"   # server URL
          fints_blz: "50010517"                          # banknummer
          credentials_file: "~/.lars-dashboard/ing_credentials.json"
          cache_ttl_hours: 4
          accounts:
            - iban: "NL00INGB0000000000"
              label: "ING Betaalrekening"
              category: "cash"
    """

    CACHE_KEY = "ing_fints"

    def __init__(self, config: dict):
        self.config = config
        self.server = config.get("fints_server", ING_DE_SERVER)
        self.blz = config.get("fints_blz", ING_DE_BLZ)
        self.credentials_file = os.path.expanduser(
            config.get("credentials_file", "~/.lars-dashboard/ing_credentials.json")
        )
        self.cache_ttl = config.get("cache_ttl_hours", 4)
        self.account_configs = config.get("accounts", [])

    def _load_credentials(self) -> Optional[dict]:
        """Laadt ING inloggegevens uit beveiligd bestand."""
        if not os.path.exists(self.credentials_file):
            return None
        try:
            with open(self.credentials_file, "r") as f:
                return json.load(f)
        except Exception:
            return None

    def _connect_and_fetch(self) -> list[InvestmentData]:
        """Verbindt via FinTS en haalt saldi op."""
        try:
            from fints.client import FinTS3PinTanClient
        except ImportError:
            raise RuntimeError(
                "python-fints niet geïnstalleerd. Voer uit: pip install fints"
            )

        creds = self._load_credentials()
        if not creds:
            raise FileNotFoundError(
                f"ING inloggegevens niet gevonden: {self.credentials_file}\n"
                "Maak het bestand aan met je ING gebruikersnaam en PIN."
            )

        username = creds.get("username", "")
        pin = creds.get("pin", "")

        if not username or not pin:
            raise ValueError("ING credentials bestand mist 'username' of 'pin' veld.")

        # Verbinden via FinTS
        client = FinTS3PinTanClient(
            bank_identifier=self.blz,
            user_id=username,
            pin=pin,
            server=self.server,
            product_id=None  # Geen product registratie nodig voor persoonlijk gebruik
        )

        investments = []
        account_config_map = {
            acc["iban"]: acc
            for acc in self.account_configs
        }

        with client:
            # Haal lijst van rekeningen op
            accounts = client.get_sepa_accounts()

            for account in accounts:
                iban = account.iban
                # Zoek de configuratie voor dit IBAN
                acc_cfg = account_config_map.get(iban, {})

                # Sla rekeningen over die niet geconfigureerd zijn (tenzij geen config = alle tonen)
                if self.account_configs and iban not in account_config_map:
                    continue

                # Haal saldo op
                balance_response = client.get_balance(account)
                balance_eur = float(balance_response.amount.amount)

                label = acc_cfg.get("label", f"ING {iban[-4:]}")
                category = acc_cfg.get("category", "cash")

                investments.append(InvestmentData(
                    name=label,
                    category=category,
                    current_value_eur=balance_eur,
                    monthly_pnl_eur=0.0,
                    source="fints",
                    last_updated=datetime.now().isoformat()
                ))

        return investments

    def fetch(self) -> list[InvestmentData]:
        """Haalt ING saldi op. Gebruikt cache als die recent genoeg is."""
        # Controleer cache
        if not is_cache_stale(self.CACHE_KEY, ttl_hours=self.cache_ttl):
            cached = load_cache(self.CACHE_KEY)
            if cached and "data" in cached:
                return [
                    InvestmentData(**inv)
                    for inv in cached["data"]["investments"]
                ]

        # Probeer live verbinding
        try:
            investments = self._connect_and_fetch()
            # Sla op in cache
            save_cache(self.CACHE_KEY, {
                "investments": [
                    {
                        "name": inv.name,
                        "category": inv.category,
                        "current_value_eur": inv.current_value_eur,
                        "monthly_pnl_eur": inv.monthly_pnl_eur,
                        "source": inv.source,
                        "last_updated": inv.last_updated
                    }
                    for inv in investments
                ]
            })
            return investments

        except FileNotFoundError as e:
            # Credentials niet gevonden - verwacht bij eerste gebruik
            return self._error_investments("credentials_missing", str(e))
        except Exception as e:
            # Verbindingsfout - probeer cache als fallback
            cached = load_cache(self.CACHE_KEY)
            if cached and "data" in cached:
                # Geef gecachte data terug met waarschuwing
                investments = [InvestmentData(**inv) for inv in cached["data"]["investments"]]
                for inv in investments:
                    inv.source = "fints_cached"
                return investments
            return self._error_investments("connection_error", str(e))

    def _error_investments(self, error_type: str, message: str) -> list[InvestmentData]:
        """Geeft lege investment objecten terug met foutinformatie."""
        # Gebruik geconfigureerde accounts als placeholder
        if self.account_configs:
            return [
                InvestmentData(
                    name=acc.get("label", f"ING rekening"),
                    category=acc.get("category", "cash"),
                    current_value_eur=0.0,
                    monthly_pnl_eur=0.0,
                    source=error_type,
                    last_updated=message[:120]  # Eerste 120 tekens van foutmelding
                )
                for acc in self.account_configs
            ]
        # Geen accounts geconfigureerd
        return [
            InvestmentData(
                name="ING Bank",
                category="cash",
                current_value_eur=0.0,
                monthly_pnl_eur=0.0,
                source=error_type,
                last_updated=message[:120]
            )
        ]

    @staticmethod
    def create_credentials_file(username: str, pin: str,
                                 credentials_path: str = "~/.lars-dashboard/ing_credentials.json"):
        """
        Helpermethod: slaat ING inloggegevens op in beveiligd bestand.
        Aanroepen via de terminal of setup script.
        """
        path = os.path.expanduser(credentials_path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"username": username, "pin": pin}, f)
        # Beperk leesbaarheid tot alleen de eigenaar
        os.chmod(path, 0o600)
        print(f"✓ ING credentials opgeslagen in: {path}")

    @staticmethod
    def test_connection(config: dict) -> dict:
        """
        Test de FinTS verbinding zonder het dashboard te starten.
        Gebruik: python3 -c "from backend.connectors.ing_fints import IngFintsConnector; ..."
        """
        connector = IngFintsConnector(config)
        try:
            result = connector._connect_and_fetch()
            return {
                "success": True,
                "accounts_found": len(result),
                "accounts": [{"name": r.name, "balance": r.current_value_eur} for r in result]
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
