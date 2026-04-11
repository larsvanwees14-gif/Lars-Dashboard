import os
import traceback
import yaml
import threading
import time
import logging
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

try:
    from backend.connectors.supplement_manual import SupplementManualConnector
    _supplement_module_available = True
except Exception as _e:
    SupplementManualConnector = None  # type: ignore[assignment,misc]
    _supplement_module_available = False
    import logging as _logging
    _logging.getLogger(__name__).warning("SupplementManualConnector kon niet worden geïmporteerd: %s", _e)

try:
    from backend.connectors.asset_history import save_snapshot, get_history
    _asset_history_available = True
except Exception as _e:
    save_snapshot = None  # type: ignore[assignment]
    get_history = None  # type: ignore[assignment]
    _asset_history_available = False
    import logging as _logging
    _logging.getLogger(__name__).warning("asset_history kon niet worden geïmporteerd: %s", _e)

from backend.aggregator import (
    aggregate_all_businesses,
    build_monthly_chart_data,
    calculate_period_change,
    build_net_worth,
    build_entity_view,
    build_bol_detail,
    build_retailers_detail,
    build_hears_detail
)

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
CONFIG_FILE = os.path.join(BASE_DIR, "config.yaml")


def load_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _ing_is_configured(ing_config: dict) -> bool:
    """Controleer of FinTS-server geconfigureerd is (niet leeg)."""
    return bool(ing_config.get("fints_server", "").strip())


def create_app() -> Flask:
    app = Flask(__name__, static_folder=FRONTEND_DIR)
    CORS(app)

    try:
        _setup_app(app)
    except Exception:
        logger.exception(
            "KRITIEKE FOUT tijdens create_app() — app start in fallback-modus:\n%s",
            traceback.format_exc(),
        )

    return app


def _setup_app(app: Flask) -> None:
    """Configureert alle connectors en routes. Wordt aangeroepen vanuit create_app()."""
    try:
        config = load_config()
    except Exception as e:
        logger.warning("Kon configuratie niet laden, gebruik lege config: %s", e)
        config = {}
    ing_config = config.get("ing", {})

    # ── Initialiseer connectors (fouten worden gelogd maar crashen de app niet) ──

    sheets_connector = None
    try:
        from backend.connectors.google_sheets import GoogleSheetsConnector
        sheets_connector = GoogleSheetsConnector(config.get("google_sheets", {}))
        logger.info("GoogleSheetsConnector geïnitialiseerd")
    except Exception as e:
        logger.warning("GoogleSheetsConnector kon niet worden geïnitialiseerd: %s", e)

    supplement_connector = None
    try:
        if SupplementManualConnector is not None:
            supplement_connector = SupplementManualConnector(config.get("supplement_brand", {}))
            logger.info("SupplementManualConnector geïnitialiseerd")
        else:
            logger.warning("SupplementManualConnector niet beschikbaar (import mislukt)")
    except Exception as e:
        logger.warning("SupplementManualConnector kon niet worden geïnitialiseerd: %s", e)

    revolut_connector = None
    try:
        from backend.connectors.revolut_manual import RevolutManualConnector
        revolut_connector = RevolutManualConnector()
        logger.info("RevolutManualConnector geïnitialiseerd")
    except Exception as e:
        logger.warning("RevolutManualConnector kon niet worden geïnitialiseerd: %s", e)

    degiro_connector = None
    try:
        from backend.connectors.degiro import DegiroConnector
        degiro_connector = DegiroConnector(config.get("degiro", {}))
        logger.info("DegiroConnector geïnitialiseerd")
    except Exception as e:
        logger.warning("DegiroConnector kon niet worden geïnitialiseerd: %s", e)

    ing_connector = None
    ing_mode = "unavailable"
    try:
        if _ing_is_configured(ing_config):
            from backend.connectors.ing_fints import IngFintsConnector
            ing_connector = IngFintsConnector(ing_config)
            ing_mode = "fints"
        else:
            from backend.connectors.ing_csv import IngCsvConnector
            ing_connector = IngCsvConnector(ing_config)
            ing_mode = "csv"
        logger.info("ING connector geïnitialiseerd (mode: %s)", ing_mode)
    except Exception as e:
        logger.warning("ING connector kon niet worden geïnitialiseerd: %s", e)

    investments_connector = None
    try:
        from backend.connectors.investments_manual import InvestmentsManualConnector
        investments_connector = InvestmentsManualConnector()
        logger.info("InvestmentsManualConnector geïnitialiseerd")
    except Exception as e:
        logger.warning("InvestmentsManualConnector kon niet worden geïnitialiseerd: %s", e)

    # ── DeGiro keep-alive: elke 2 uur een lichte API call ──────────────────────
    def degiro_keep_alive():
        keepalive_logger = logging.getLogger("degiro_keepalive")
        while True:
            time.sleep(2 * 3600)  # 2 uur
            if degiro_connector is None:
                continue
            try:
                result = degiro_connector.fetch()
                src = result[0].source if result else "unknown"
                keepalive_logger.info("DeGiro keep-alive ping — source: %s", src)
            except Exception as e:
                keepalive_logger.warning("DeGiro keep-alive failed: %s", e)

    keepalive_thread = threading.Thread(target=degiro_keep_alive, daemon=True)
    keepalive_thread.start()

    def get_all_data():
        from backend.cache import load_manual
        from backend.connectors.base import BusinessData, MonthData

        businesses = (sheets_connector.fetch() if sheets_connector else []) + (supplement_connector.fetch() if supplement_connector else [])

        # Add SP Agency (manual profit data) as a proper business
        spa_data = load_manual("spagency")
        spa_month_list = []
        for m in spa_data.get("months", []):
            profit = float(m.get("profit", 0) or 0)
            if profit != 0:
                spa_month_list.append(MonthData(
                    year=int(m["year"]), month=int(m["month"]),
                    revenue=profit,   # for a service business, fee = revenue
                    expenses=0,
                    profit=profit,
                ))
        if spa_month_list:
            businesses.append(BusinessData(
                name="SP Agency", entity="Holding",
                months=spa_month_list, source="manual",
                last_updated=datetime.now().isoformat()
            ))

        # Add Shopify (Google Sheets)
        try:
            from backend.connectors.shopify_sheets import ShopifySheetsConnector
            shopify_raw = ShopifySheetsConnector().fetch()
            if shopify_raw:
                shopify_months = [
                    MonthData(
                        year=m["year"], month=m["month"],
                        revenue=m["revenue"],
                        expenses=round(m["revenue"] - m["profit"], 2),
                        profit=m["profit"],
                    )
                    for m in shopify_raw
                ]
                businesses.append(BusinessData(
                    name="Shopify", entity="BV",
                    months=shopify_months, source="google_sheets",
                    last_updated=datetime.now().isoformat()
                ))
        except Exception:
            pass

        revolut = revolut_connector.fetch() if revolut_connector else []
        degiro = degiro_connector.fetch() if degiro_connector else []
        manual = investments_connector.fetch() if investments_connector else []
        all_investments = degiro + revolut + manual
        return businesses, all_investments

    # ── Frontend routes ───────────────────────────────────────────────────────
    @app.route("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.route("/<path:filename>")
    def static_files(filename):
        return send_from_directory(FRONTEND_DIR, filename)

    # ── API: Hoofddashboard ───────────────────────────────────────────────────
    @app.route("/api/dashboard")
    def api_dashboard():
        period = request.args.get("period", "mtd")
        try:
            try:
                businesses, investments = get_all_data()
            except Exception:
                logger.exception(
                    "FOUT in get_all_data() — volledige traceback:\n%s",
                    traceback.format_exc(),
                )
                raise

            businesses_data = aggregate_all_businesses(businesses, period)
            net_worth = build_net_worth(investments)
            changes = calculate_period_change(businesses)
            chart_data = build_monthly_chart_data(businesses)
            entity_view = build_entity_view(businesses, period)
            bol_detail = build_bol_detail(businesses)
            retailers_detail = build_retailers_detail(businesses)
            hears_detail = build_hears_detail(businesses)

            # Auto-snapshot: sla portfolio op als deze maand nog geen snapshot heeft
            try:
                if save_snapshot is not None:
                    save_snapshot(net_worth)
            except Exception:
                pass
            asset_history = get_history() if get_history is not None else []

            return jsonify({
                "period": period,
                "net_worth": net_worth,
                "asset_history": asset_history,
                "kpis": businesses_data["total"],
                "kpi_changes": changes,
                "businesses": businesses_data["businesses"],
                "chart_data": chart_data,
                "entities": entity_view,
                "bol_detail": bol_detail,
                "retailers_detail": retailers_detail,
                "hears_detail": hears_detail,
                "last_refresh": datetime.now().isoformat(),
                "ing_mode": ing_mode
            })
        except Exception as e:
            logger.exception(
                "FOUT in /api/dashboard (period=%s) — volledige traceback:\n%s",
                period,
                traceback.format_exc(),
            )
            return jsonify({"error": str(e)}), 500

    # ── API: ING status ───────────────────────────────────────────────────────
    @app.route("/api/ing/status")
    def api_ing_status():
        return jsonify({
            "mode": ing_mode,
            "fints_configured": _ing_is_configured(ing_config),
            "accounts_configured": len(ing_config.get("accounts", [])),
            "accounts": [
                {"iban": acc.get("iban", ""), "label": acc.get("label", ""), "category": acc.get("category", "")}
                for acc in ing_config.get("accounts", [])
            ]
        })

    # ── API: ING CSV upload ───────────────────────────────────────────────────
    @app.route("/api/ing/csv", methods=["POST"])
    def api_ing_csv_upload():
        """Verwerkt een geüpload ING CSV afschrift."""
        if ing_connector is None:
            return jsonify({"error": "ING connector niet beschikbaar. Controleer de configuratie."}), 503
        try:
            if request.files:
                # Multipart file upload
                file = request.files.get("file")
                if not file:
                    return jsonify({"error": "Geen bestand ontvangen"}), 400
                content = file.read().decode("utf-8", errors="replace")
                iban = request.form.get("iban", "default")
            else:
                # JSON body met base64 of plain text
                body = request.json or {}
                content = body.get("content", "")
                iban = body.get("iban", "default")

            result = ing_connector.process_upload(iban, content)
            return jsonify(result)
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    # ── API: ING FinTS handmatig vernieuwen ───────────────────────────────────
    @app.route("/api/ing/refresh", methods=["POST"])
    def api_ing_refresh():
        """Vernieuwt ING-saldo via FinTS (verwijdert cache zodat data opnieuw opgehaald wordt)."""
        if ing_connector is None:
            return jsonify({"error": "ING connector niet beschikbaar. Controleer de configuratie."}), 503
        if ing_mode != "fints":
            return jsonify({"error": "FinTS niet geconfigureerd. Gebruik CSV import."}), 400
        try:
            from backend.cache import save_cache
            save_cache("ing_fints", {})  # Invalideer cache
            investments = ing_connector.fetch()
            return jsonify({
                "status": "ok",
                "accounts": [
                    {"name": inv.name, "balance": inv.current_value_eur, "source": inv.source}
                    for inv in investments
                ]
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── API: Supplement invoer ────────────────────────────────────────────────
    @app.route("/api/supplement", methods=["POST"])
    def api_supplement_save():
        if SupplementManualConnector is None:
            return jsonify({"error": "Supplement connector niet beschikbaar. Controleer de configuratie."}), 503
        body = request.json
        try:
            SupplementManualConnector.save_month(
                year=int(body["year"]),
                month=int(body["month"]),
                revenue=float(body["revenue"]),
                expenses=float(body["expenses"])
            )
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    # ── API: Revolut crypto invoer ────────────────────────────────────────────
    @app.route("/api/revolut", methods=["POST"])
    def api_revolut_save():
        if revolut_connector is None:
            return jsonify({"error": "Revolut connector niet beschikbaar. Controleer de configuratie."}), 503
        body = request.json
        try:
            holdings = body.get("holdings", [])
            from backend.connectors.revolut_manual import RevolutManualConnector
            RevolutManualConnector.save_holdings(holdings)
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/revolut", methods=["GET"])
    def api_revolut_get():
        if revolut_connector is None:
            return jsonify({"holdings": [], "error": "Revolut connector niet beschikbaar."}), 200
        from backend.connectors.revolut_manual import RevolutManualConnector
        holdings = RevolutManualConnector.get_holdings()
        return jsonify({"holdings": holdings})

    # ── API: Manual investments ────────────────────────────────────────────────
    @app.route("/api/investments", methods=["POST"])
    def api_investments_save():
        if investments_connector is None:
            return jsonify({"error": "Investments connector niet beschikbaar. Controleer de configuratie."}), 503
        body = request.json or {}
        try:
            if "savings_balance" in body:
                from backend.connectors.investments_manual import InvestmentsManualConnector
                InvestmentsManualConnector.save_savings(float(body["savings_balance"]))
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/loans", methods=["GET"])
    def api_loans_get():
        if investments_connector is None:
            return jsonify({"items": [], "error": "Investments connector niet beschikbaar."}), 200
        from backend.connectors.investments_manual import InvestmentsManualConnector
        items = InvestmentsManualConnector.get_loan_items()
        return jsonify({"items": items})

    @app.route("/api/loans", methods=["POST"])
    def api_loans_save():
        if investments_connector is None:
            return jsonify({"error": "Investments connector niet beschikbaar. Controleer de configuratie."}), 503
        body = request.json or {}
        try:
            from backend.connectors.investments_manual import InvestmentsManualConnector
            InvestmentsManualConnector.save_loan_items(body.get("items", []))
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    # ── API: SP Agency ────────────────────────────────────────────────────────
    @app.route("/api/spagency", methods=["GET"])
    def api_spagency_get():
        from backend.cache import load_manual
        data = load_manual("spagency")
        return jsonify({"months": data.get("months", [])})

    @app.route("/api/spagency", methods=["POST"])
    def api_spagency_save():
        from backend.cache import load_manual, save_manual
        body = request.json or {}
        try:
            data = load_manual("spagency")
            data["months"] = body.get("months", [])
            save_manual("spagency", data)
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    # ── API: Degiro status ────────────────────────────────────────────────────
    @app.route("/api/degiro/status")
    def api_degiro_status():
        if degiro_connector is None:
            return jsonify({"status": "unavailable", "error": "DeGiro connector niet beschikbaar. Controleer de configuratie."})
        return jsonify(degiro_connector.get_status())

    # ── API: Degiro login stap 1 ──────────────────────────────────────────────
    @app.route("/api/degiro/login/start", methods=["POST"])
    def api_degiro_login_start():
        """Stap 1: gebruikersnaam + wachtwoord. Degiro stuurt SMS als 2FA actief."""
        if degiro_connector is None:
            return jsonify({"status": "error", "message": "DeGiro connector niet beschikbaar. Controleer de configuratie."}), 503
        body = request.json or {}
        username = body.get("username", "").strip()
        password = body.get("password", "").strip()
        if not username or not password:
            return jsonify({"status": "error", "message": "Gebruikersnaam en wachtwoord vereist"}), 400
        result = degiro_connector.login_start(username, password)
        return jsonify(result)

    # ── API: Degiro login stap 2 ──────────────────────────────────────────────
    @app.route("/api/degiro/login/verify", methods=["POST"])
    def api_degiro_login_verify():
        """Stap 2: SMS-code invoeren om login te voltooien."""
        if degiro_connector is None:
            return jsonify({"status": "error", "message": "DeGiro connector niet beschikbaar. Controleer de configuratie."}), 503
        body = request.json or {}
        otp_raw = str(body.get("otp", "")).strip().replace(" ", "")
        if not otp_raw or not otp_raw.isdigit():
            return jsonify({"status": "error", "message": "Voer de 6-cijferige SMS-code in"}), 400
        result = degiro_connector.login_verify(int(otp_raw))
        return jsonify(result)

    # ── API: Degiro login bevestiging (na in-app goedkeuring) ────────────────
    @app.route("/api/degiro/login/confirm", methods=["POST"])
    def api_degiro_login_confirm():
        """Na goedkeuring in de Degiro app: login opnieuw proberen."""
        if degiro_connector is None:
            return jsonify({"status": "error", "message": "DeGiro connector niet beschikbaar. Controleer de configuratie."}), 503
        result = degiro_connector.login_confirm()
        return jsonify(result)

    # ── API: Degiro vernieuwen (cache invalideren) ────────────────────────────
    @app.route("/api/degiro/refresh", methods=["POST"])
    def api_degiro_refresh():
        """Forceert verse Degiro data (verwijdert cache)."""
        if degiro_connector is None:
            return jsonify({"error": "DeGiro connector niet beschikbaar. Controleer de configuratie."}), 503
        try:
            from backend.cache import save_cache
            save_cache("degiro_portfolio", {})
            result = degiro_connector.fetch()
            inv = result[0] if result else None
            if inv:
                return jsonify({
                    "status": "ok" if inv.source not in ("not_connected", "session_expired") else inv.source,
                    "portfolio_value_eur": inv.current_value_eur,
                    "monthly_pnl_eur": inv.monthly_pnl_eur,
                    "source": inv.source
                })
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── API: Quarterly boekhouding ────────────────────────────────────────────
    @app.route("/api/quarterly/upload", methods=["POST"])
    def api_quarterly_upload():
        """Upload een Exact Online PDF rapport voor een entiteit + kwartaal."""
        from backend.connectors.exact_csv import parse_exact_pdf, save_quarterly
        import tempfile

        if "file" not in request.files:
            return jsonify({"error": "Geen bestand geüpload"}), 400

        file = request.files["file"]
        entity = request.form.get("entity", "").strip()
        year = request.form.get("year", "")
        quarter = request.form.get("quarter", "")

        if not entity or not year or not quarter:
            return jsonify({"error": "Entity, year en quarter zijn verplicht"}), 400

        try:
            year = int(year)
        except ValueError:
            return jsonify({"error": "Year moet een getal zijn"}), 400

        # Support "annual" as period
        if quarter == "annual":
            quarter = "annual"
        else:
            try:
                quarter = int(quarter)
            except ValueError:
                return jsonify({"error": "Quarter moet 1-4 of 'annual' zijn"}), 400
            if quarter not in (1, 2, 3, 4):
                return jsonify({"error": "Quarter moet 1-4 zijn"}), 400

        # Sla bestand tijdelijk op en parse het
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                file.save(tmp.name)
                data = parse_exact_pdf(tmp.name)
            os.unlink(tmp.name)

            save_quarterly(entity, year, quarter, data)
            return jsonify({"status": "ok", "data": data})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/quarterly/<entity>")
    def api_quarterly_get(entity):
        """Haal alle kwartaaldata op voor een entiteit."""
        from backend.connectors.exact_csv import load_quarterly
        data = load_quarterly(entity)
        return jsonify(data)

    # ── API: Shopify data (Google Sheet) ──────────────────────────────────────
    @app.route("/api/shopify")
    def api_shopify():
        """Haal Shopify maandelijkse data op uit Google Sheet."""
        try:
            from backend.connectors.shopify_sheets import ShopifySheetsConnector
            creds_file = os.path.expanduser("~/.lars-dashboard/google_service_account.json")
            connector = ShopifySheetsConnector(credentials_file=creds_file)
            months = connector.fetch()
            return jsonify({"months": months, "last_updated": datetime.now().isoformat()})
        except Exception as e:
            return jsonify({"months": [], "error": str(e)}), 200
