"""
Degiro connector — haalt portfolio waarde automatisch op.

Authenticatie: session-based (geen wachtwoord opgeslagen).
Login via 2-staps flow in het dashboard:
  Stap 1: gebruikersnaam + wachtwoord → Degiro stuurt SMS
  Stap 2: SMS-code invoeren → session token opgeslagen

Session token wordt hergebruikt zolang die geldig is (~30 dagen).
Bij expiry: dashboard toont "Opnieuw verbinden" knop.
"""
import json
import os
import logging
from datetime import datetime
from typing import Optional

from backend.connectors.base import BaseConnector, InvestmentData
from backend.cache import load_cache, save_cache, is_cache_stale

CACHE_KEY = "degiro_portfolio"
_DEGIRO_DIR = os.environ.get("DATA_DIR") or os.path.expanduser("~/.lars-dashboard")
if os.environ.get("DATA_DIR"):
    _DEGIRO_DIR = os.path.join(os.environ["DATA_DIR"], "degiro")
SESSION_FILE = os.path.join(_DEGIRO_DIR, "degiro_session.json")
CREDENTIALS_TEMP_FILE = os.path.join(_DEGIRO_DIR, "degiro_temp_creds.json")
IN_APP_TOKEN_FILE = os.path.join(_DEGIRO_DIR, "degiro_in_app_token.json")

logging.getLogger("degiro_connector").setLevel(logging.ERROR)


def _load_session() -> Optional[dict]:
    """Laad opgeslagen Degiro session."""
    if not os.path.exists(SESSION_FILE):
        return None
    try:
        with open(SESSION_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _save_session(session_id: str, account_id: int):
    """Sla session token op (chmod 600)."""
    os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
    with open(SESSION_FILE, "w") as f:
        json.dump({
            "session_id": session_id,
            "account_id": account_id,
            "saved_at": datetime.now().isoformat()
        }, f)
    os.chmod(SESSION_FILE, 0o600)


def _clear_session():
    """Verwijder opgeslagen session (bij uitloggen of expiry)."""
    if os.path.exists(SESSION_FILE):
        os.remove(SESSION_FILE)


def _save_temp_credentials(username: str, password: str):
    """Sla tijdelijke credentials op voor stap 2 van login (worden na login verwijderd)."""
    os.makedirs(os.path.dirname(CREDENTIALS_TEMP_FILE), exist_ok=True)
    with open(CREDENTIALS_TEMP_FILE, "w") as f:
        json.dump({"username": username, "password": password}, f)
    os.chmod(CREDENTIALS_TEMP_FILE, 0o600)


def _load_temp_credentials() -> Optional[dict]:
    if not os.path.exists(CREDENTIALS_TEMP_FILE):
        return None
    try:
        with open(CREDENTIALS_TEMP_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _clear_temp_credentials():
    if os.path.exists(CREDENTIALS_TEMP_FILE):
        os.remove(CREDENTIALS_TEMP_FILE)


class DegiroConnector(BaseConnector):
    """
    Haalt Degiro portfolio waarde op.
    Authenticatie via session token (verkregen via 2-staps login in dashboard).
    """

    def __init__(self, config: dict):
        self.config = config
        self.cache_ttl = config.get("cache_ttl_hours", 4)

    def _build_api(self, credentials_kwargs: dict):
        """Bouwt een Degiro API client."""
        from degiro_connector.trading.api import API
        from degiro_connector.trading.models.trading_pb2 import Credentials
        credentials = Credentials(**credentials_kwargs)
        return API(credentials=credentials)

    def _save_in_app_token(self, token: str, full_response: dict):
        """Sla in-app token en volledige response op voor polling."""
        os.makedirs(os.path.dirname(IN_APP_TOKEN_FILE), exist_ok=True)
        with open(IN_APP_TOKEN_FILE, "w") as f:
            json.dump({"in_app_token": token, "response": full_response}, f)
        os.chmod(IN_APP_TOKEN_FILE, 0o600)

    def _load_in_app_token(self) -> Optional[dict]:
        if not os.path.exists(IN_APP_TOKEN_FILE):
            return None
        try:
            with open(IN_APP_TOKEN_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return None

    def _clear_in_app_token(self):
        if os.path.exists(IN_APP_TOKEN_FILE):
            os.remove(IN_APP_TOKEN_FILE)

    def _get_int_account(self, api) -> int:
        """Haalt int_account op via get_client_details na connect (v3 API)."""
        try:
            details = api.get_client_details()
            if details and "data" in details:
                return int(details["data"].get("intAccount", 0))
            if details and "intAccount" in details:
                return int(details.get("intAccount", 0))
        except Exception:
            pass
        return 0

    def _fetch_portfolio(self, api) -> InvestmentData:
        """Haalt portfolio data op met een verbonden API object (raw response)."""
        from degiro_connector.trading.models.trading_pb2 import Update

        request_list = Update.RequestList()
        request_list.values.extend([
            Update.Request(option=Update.Option.Value("PORTFOLIO"), last_updated=0),
            Update.Request(option=Update.Option.Value("TOTALPORTFOLIO"), last_updated=0),
        ])

        update_raw = api.get_update(request_list=request_list, raw=True)

        # Als update_raw None of leeg is, is de sessie waarschijnlijk verlopen
        if not update_raw or (not update_raw.get("portfolio") and not update_raw.get("totalPortfolio")):
            raise ConnectionError("Session expired or no data returned")

        total_value = 0.0
        total_pnl = 0.0
        daily_pnl = 0.0
        free_space = 0.0
        total_cash = 0.0
        total_deposit = 0.0

        if update_raw:
            # Individual positions: value + P&L
            portfolio = update_raw.get("portfolio", {})
            for position in portfolio.get("value", []):
                pos_values = {v["name"]: v.get("value") for v in position.get("value", [])}
                if pos_values.get("positionType") == "PRODUCT":
                    pos_value = float(pos_values.get("value", 0) or 0)
                    size = float(pos_values.get("size", 0) or 0)
                    price = float(pos_values.get("price", 0) or 0)
                    break_even = float(pos_values.get("breakEvenPrice", 0) or 0)
                    realized = float(pos_values.get("realizedProductPl", 0) or 0)

                    total_value += pos_value

                    # Total P&L = unrealized + realized per position
                    # unrealized = (current_price - break_even) * size
                    if size and break_even:
                        total_pnl += (price - break_even) * size + realized

                    # Daily P&L from todayPlBase
                    # todayPlBase = negative start-of-day value
                    today_pl = pos_values.get("todayPlBase")
                    if isinstance(today_pl, dict):
                        daily_pnl += float(today_pl.get("EUR", 0) or 0) + pos_value

            # Cash & free space from totalPortfolio
            total_portfolio = update_raw.get("totalPortfolio", {})
            for item in total_portfolio.get("value", []):
                name = item.get("name")
                val = item.get("value")
                if name == "totalCash":
                    total_cash = float(val or 0)
                elif name == "freeSpaceNew" and isinstance(val, dict):
                    free_space = float(val.get("EUR", 0) or 0)

            total_value += total_cash

        monthly_pnl = self._calculate_monthly_pnl(total_value)

        return InvestmentData(
            name="Stocks",
            category="stocks",
            current_value_eur=round(total_value, 2),
            monthly_pnl_eur=round(monthly_pnl, 2),
            total_pnl_eur=round(total_pnl, 2),
            daily_pnl_eur=round(daily_pnl, 2),
            free_space_eur=round(free_space, 2),
            source="degiro_api",
            last_updated=datetime.now().isoformat()
        )

    def _calculate_monthly_pnl(self, current_value: float) -> float:
        """Berekent maandelijkse P&L t.o.v. begin van de maand."""
        cached = load_cache(CACHE_KEY)
        if not cached or "data" not in cached:
            return 0.0
        try:
            saved_at = datetime.fromisoformat(cached.get("saved_at", ""))
            today = datetime.now()
            if saved_at.month != today.month or saved_at.year != today.year:
                return current_value - cached["data"].get("current_value_eur", current_value)
            return cached["data"].get("monthly_pnl_eur", 0.0)
        except Exception:
            return 0.0

    # ── Login stap 1 ──────────────────────────────────────────────────────────

    def login_start(self, username: str, password: str) -> dict:
        """
        Stap 1 van login: probeer in te loggen met username + password.
        Praat direct met de DeGiro API voor betere foutafhandeling.

        Returns:
            {"status": "otp_required"} — 2FA vereist, voer code in
            {"status": "logged_in"}    — Login gelukt zonder 2FA
            {"status": "error", "message": "..."} — Fout
        """
        import requests as req
        from degiro_connector.core.constants.headers import HEADERS

        try:
            session = req.Session()
            session.headers.update(HEADERS)

            url = "https://trader.degiro.nl/login/secure/login"
            payload = {
                "username": username,
                "password": password,
                "isPassCodeReset": False,
                "isRedirectToMobile": False,
                "queryParams": {},
            }

            resp = session.post(url, json=payload)
            data = {}
            try:
                data = resp.json()
            except Exception:
                pass

            # 2FA vereist
            status_text = data.get("statusText", "")

            # In-app bevestiging (push notificatie in DeGiro app)
            if status_text == "inAppTOTPNeeded":
                _save_temp_credentials(username, password)
                # Log de volledige response zodat we alle velden kennen
                logging.getLogger(__name__).warning("DeGiro inAppTOTPNeeded response: %s", json.dumps(data))
                # Sla de volledige response op voor polling
                self._save_in_app_token(data.get("inAppToken", ""), data)
                return {"status": "app_confirm_required", "message": "Open de Degiro app en keur het inlogverzoek goed"}

            # TOTP code vereist (authenticator app / SMS)
            if data.get("status") == 6 or status_text in ("totpNeeded", "TOTPNeeded"):
                _save_temp_credentials(username, password)
                return {"status": "otp_required", "message": "Voer de verificatiecode in"}

            # Foute credentials
            if data.get("statusText") == "badCredentials" or data.get("status") == 3:
                return {"status": "error", "message": "Onjuiste gebruikersnaam of wachtwoord."}

            # Te veel pogingen
            if data.get("statusText") == "accountBlocked" or data.get("status") == 5:
                return {"status": "error", "message": "Account tijdelijk geblokkeerd door te veel pogingen. Wacht even."}

            # Succes: session ID ontvangen
            if "sessionId" in data:
                session_id = data["sessionId"]

                # Haal int_account op via de library
                api = self._build_api({"username": username, "password": password})
                api.connection_storage.session_id = session_id
                account_id = self._get_int_account(api)

                _save_session(session_id, account_id)
                _clear_temp_credentials()
                return {"status": "logged_in"}

            # Onbekende response
            status_text = data.get("statusText", "")
            if resp.status_code >= 400:
                return {"status": "error", "message": f"Login mislukt (HTTP {resp.status_code}). Controleer je gegevens."}

            return {"status": "error", "message": f"Onverwachte response van Degiro: {status_text or resp.status_code}"}

        except req.ConnectionError:
            return {"status": "error", "message": "Kan geen verbinding maken met Degiro. Controleer je internetverbinding."}
        except Exception as e:
            return {"status": "error", "message": f"Fout bij inloggen: {str(e)[:150]}"}

    # ── Login bevestiging (na in-app goedkeuring) ───────────────────────────

    def login_confirm(self) -> dict:
        """
        Na goedkeuring in de Degiro app: login opnieuw proberen met in_app_token.
        Gebaseerd op degiro-connector v3.0.35 polling flow:
        - Stuur login request met in_app_token
        - Status 3 = nog niet goedgekeurd (pending)
        - sessionId in response = goedgekeurd
        """
        import requests as req
        from degiro_connector.core.constants.headers import HEADERS

        creds = _load_temp_credentials()
        if not creds:
            return {"status": "error", "message": "Sessie verlopen. Begin opnieuw met inloggen."}

        token_data = self._load_in_app_token()

        try:
            session = req.Session()
            session.headers.update(HEADERS)

            # POST naar /login/secure/login/in-app met het inAppToken
            url = "https://trader.degiro.nl/login/secure/login/in-app"
            payload = {
                "username": creds["username"],
                "password": creds["password"],
                "isPassCodeReset": False,
                "isRedirectToMobile": False,
                "queryParams": {},
            }

            # Voeg in_app_token toe
            if token_data and token_data.get("in_app_token"):
                payload["inAppToken"] = token_data["in_app_token"]

            resp = session.post(url, json=payload)
            data = {}
            try:
                data = resp.json()
            except Exception:
                pass

            logging.getLogger(__name__).info("login_confirm response: %s", data)

            if "sessionId" in data:
                session_id = data["sessionId"]

                api = self._build_api({"username": creds["username"], "password": creds["password"]})
                api.connection_storage.session_id = session_id
                account_id = self._get_int_account(api)

                _save_session(session_id, account_id)
                _clear_temp_credentials()
                self._clear_in_app_token()
                save_cache(CACHE_KEY, {})

                return {"status": "logged_in"}

            # Status 3 of inAppTOTPNeeded = nog niet goedgekeurd
            status_val = data.get("status")
            status_text = data.get("statusText", "")

            if status_val == 3 or status_text == "inAppTOTPNeeded":
                # Bewaar eventueel nieuw token
                new_token = data.get("inAppToken", data.get("redirect", ""))
                if new_token:
                    self._save_in_app_token(new_token, data)
                return {"status": "pending", "message": "Nog niet goedgekeurd. Keur het verzoek goed in de Degiro app."}

            if status_text == "badCredentials":
                _clear_temp_credentials()
                self._clear_in_app_token()
                return {"status": "error", "message": "Sessie verlopen. Begin opnieuw met inloggen."}

            return {"status": "error", "message": f"Onverwachte response: {status_text or resp.status_code}"}

        except Exception as e:
            return {"status": "error", "message": f"Fout: {str(e)[:150]}"}

    # ── Login stap 2 (TOTP code) ─────────────────────────────────────────────

    def login_verify(self, otp_code: int) -> dict:
        """
        Stap 2 van login: verifieer met TOTP-code (authenticator app).
        Praat direct met de DeGiro API voor betere foutafhandeling.

        Returns:
            {"status": "logged_in"} — Session opgeslagen
            {"status": "error", "message": "..."} — Verkeerde code of andere fout
        """
        import requests as req
        from degiro_connector.core.constants.headers import HEADERS

        creds = _load_temp_credentials()
        if not creds:
            return {"status": "error", "message": "Sessie verlopen. Begin opnieuw met inloggen."}

        try:
            session = req.Session()
            session.headers.update(HEADERS)

            url = "https://trader.degiro.nl/login/secure/login/totp"
            payload = {
                "username": creds["username"],
                "password": creds["password"],
                "oneTimePassword": str(otp_code),
                "isPassCodeReset": False,
                "isRedirectToMobile": False,
                "queryParams": {},
            }

            resp = session.post(url, json=payload)
            data = {}
            try:
                data = resp.json()
            except Exception:
                pass

            if "sessionId" in data:
                session_id = data["sessionId"]

                # Haal int_account op
                api = self._build_api({
                    "username": creds["username"],
                    "password": creds["password"],
                    "one_time_password": otp_code
                })
                api.connection_storage.session_id = session_id
                account_id = self._get_int_account(api)

                _save_session(session_id, account_id)
                _clear_temp_credentials()

                # Invalideer cache zodat verse data opgehaald wordt
                save_cache(CACHE_KEY, {})

                return {"status": "logged_in"}

            # Verkeerde code
            if data.get("statusText") == "badCredentials" or data.get("status") == 3:
                return {"status": "error", "message": "Verkeerde code. Probeer opnieuw."}

            if resp.status_code >= 400:
                return {"status": "error", "message": f"Verificatie mislukt (HTTP {resp.status_code}). Controleer de code."}

            return {"status": "error", "message": f"Onverwachte response: {data.get('statusText', resp.status_code)}"}

        except req.ConnectionError:
            return {"status": "error", "message": "Kan geen verbinding maken met Degiro."}
        except Exception as e:
            return {"status": "error", "message": f"Fout bij verificatie: {str(e)[:150]}"}

    # ── Helpers: cache fallback + auto re-login ───────────────────────────────

    def _stale_or_expired(self) -> list[InvestmentData]:
        """Geeft gecachte data terug als fallback, of session_expired als er geen cache is."""
        cached = load_cache(CACHE_KEY)
        if cached and "data" in cached and cached["data"]:
            d = cached["data"]
            return [InvestmentData(
                name=d.get("name", "Stocks"),
                category=d.get("category", "stocks"),
                current_value_eur=d.get("current_value_eur", 0.0),
                monthly_pnl_eur=d.get("monthly_pnl_eur", 0.0),
                total_pnl_eur=d.get("total_pnl_eur", 0.0),
                daily_pnl_eur=d.get("daily_pnl_eur", 0.0),
                free_space_eur=d.get("free_space_eur", 0.0),
                source="degiro_stale",
                last_updated=cached.get("saved_at")
            )]
        _clear_session()
        return [InvestmentData(
            name="Stocks",
            category="stocks",
            source="session_expired",
            last_updated="Sessie verlopen — klik 'Opnieuw verbinden'"
        )]

    def _try_auto_relogin(self) -> Optional[InvestmentData]:
        """
        Probeert automatisch opnieuw in te loggen via DEGIRO_USERNAME + DEGIRO_PASSWORD env vars.
        Werkt alleen als DeGiro geen 2FA vereist voor deze sessie.
        Geeft InvestmentData terug bij succes, None als het niet lukt of env vars ontbreken.
        """
        username = os.environ.get("DEGIRO_USERNAME")
        password = os.environ.get("DEGIRO_PASSWORD")
        if not username or not password:
            return None
        try:
            result = self.login_start(username, password)
            if result.get("status") == "logged_in":
                # Succes: nu verse data ophalen
                fresh = self.fetch()
                return fresh[0] if fresh else None
        except Exception:
            pass
        return None

    # ── Portfolio ophalen ─────────────────────────────────────────────────────

    def fetch(self) -> list[InvestmentData]:
        """Haalt portfolio op. Hergebruikt gecachte data of vraagt verse data."""
        # Check cache
        if not is_cache_stale(CACHE_KEY, ttl_hours=self.cache_ttl):
            cached = load_cache(CACHE_KEY)
            if cached and "data" in cached and cached["data"]:
                d = cached["data"]
                return [InvestmentData(
                    name=d.get("name", "Stocks"),
                    category=d.get("category", "stocks"),
                    current_value_eur=d.get("current_value_eur", 0.0),
                    monthly_pnl_eur=d.get("monthly_pnl_eur", 0.0),
                    total_pnl_eur=d.get("total_pnl_eur", 0.0),
                    daily_pnl_eur=d.get("daily_pnl_eur", 0.0),
                    free_space_eur=d.get("free_space_eur", 0.0),
                    source="degiro_cached",
                    last_updated=cached.get("saved_at")
                )]

        # Check of we een session hebben
        session = _load_session()
        if not session:
            # Probeer auto re-login via env vars
            auto = self._try_auto_relogin()
            if auto:
                return [auto]
            # Geen session, geen env vars → toon cache of not_connected
            cached = load_cache(CACHE_KEY)
            if cached and "data" in cached and cached["data"]:
                d = cached["data"]
                return [InvestmentData(
                    name=d.get("name", "Stocks"),
                    category=d.get("category", "stocks"),
                    current_value_eur=d.get("current_value_eur", 0.0),
                    monthly_pnl_eur=d.get("monthly_pnl_eur", 0.0),
                    total_pnl_eur=d.get("total_pnl_eur", 0.0),
                    daily_pnl_eur=d.get("daily_pnl_eur", 0.0),
                    free_space_eur=d.get("free_space_eur", 0.0),
                    source="degiro_stale",
                    last_updated=cached.get("saved_at")
                )]
            return [InvestmentData(
                name="Stocks",
                category="stocks",
                source="not_connected",
                last_updated="Klik 'Verbinden' om Degiro te koppelen"
            )]

        # Haal live data op met session
        try:
            from degiro_connector.trading.api import API
            from degiro_connector.trading.models.trading_pb2 import Credentials

            account_id = session.get("account_id", 0)
            credentials = Credentials(
                username="",
                password="",
                int_account=account_id
            )
            api = API(credentials=credentials)

            # Zet bestaande session direct
            api.connection_storage.session_id = session["session_id"]

            # Als account_id 0 is (legacy sessie), haal het op via API
            if not account_id:
                account_id = self._get_int_account(api)
                if account_id:
                    api._credentials.int_account = account_id
                    _save_session(session["session_id"], account_id)
                else:
                    # Sessie verlopen — probeer auto re-login via env vars
                    auto = self._try_auto_relogin()
                    if auto:
                        return [auto]
                    # Geen auto re-login mogelijk — val terug op cache
                    return self._stale_or_expired()

            investment = self._fetch_portfolio(api)

            # Cache opslaan
            save_cache(CACHE_KEY, {
                "name": investment.name,
                "category": investment.category,
                "current_value_eur": investment.current_value_eur,
                "monthly_pnl_eur": investment.monthly_pnl_eur,
                "total_pnl_eur": investment.total_pnl_eur,
                "daily_pnl_eur": investment.daily_pnl_eur,
                "free_space_eur": investment.free_space_eur,
            })

            return [investment]

        except Exception as e:
            # Bij elke fout: probeer auto re-login, anders cache fallback
            auto = self._try_auto_relogin()
            if auto:
                return [auto]
            return self._stale_or_expired()

    def get_status(self) -> dict:
        """Geeft verbindingsstatus terug voor het dashboard."""
        session = _load_session()
        if not session:
            return {"connected": False, "status": "not_connected"}
        return {
            "connected": True,
            "status": "connected",
            "account_id": session.get("account_id"),
            "connected_since": session.get("saved_at")
        }
