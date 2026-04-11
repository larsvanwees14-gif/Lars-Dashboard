import json
import os
import logging
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory

# ── Logging configuratie ──────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Paden ─────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
QUARTERLY_DIR = os.path.join(DATA_DIR, "quarterly")

logger.info("BASE_DIR    : %s", BASE_DIR)
logger.info("FRONTEND_DIR: %s", FRONTEND_DIR)
logger.info("DATA_DIR    : %s", DATA_DIR)


# ── Config laden ──────────────────────────────────────────────────────────────

def _load_config() -> dict:
    config_path = os.path.join(BASE_DIR, "config.yaml")
    try:
        import yaml
        with open(config_path, "r") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        logger.warning("Kon config.yaml niet laden: %s", e)
        return {}


# ── Connector helpers ─────────────────────────────────────────────────────────

def _load_businesses(config: dict):
    """Laad alle business data via Google Sheets connector (met cache fallback)."""
    from backend.connectors.google_sheets import GoogleSheetsConnector
    from backend.connectors.supplement_manual import SupplementManualConnector

    businesses = []

    # Google Sheets businesses (Bol, Retailers, Hears)
    gs_config = config.get("google_sheets", {})
    if gs_config:
        try:
            connector = GoogleSheetsConnector(gs_config)
            businesses.extend(connector.fetch())
        except Exception as e:
            logger.warning("GoogleSheetsConnector fout: %s", e)
            # Fall back to cached data directly
            businesses.extend(_load_businesses_from_cache(gs_config))

    # US Supplement Brand (manual)
    supp_config = config.get("supplement_brand", {
        "business_name": "US Supplement Brand",
        "entity": "LLC",
        "currency": "USD",
    })
    try:
        supp_connector = SupplementManualConnector(supp_config)
        businesses.extend(supp_connector.fetch())
    except Exception as e:
        logger.warning("SupplementManualConnector fout: %s", e)

    return businesses


def _load_businesses_from_cache(gs_config: dict):
    """Laad businesses rechtstreeks uit cache-bestanden als fallback."""
    from backend.connectors.base import BusinessData, MonthData
    from backend.cache import load_cache

    businesses = []
    spreadsheets = gs_config.get("spreadsheets", {})
    for key, sheet_config in spreadsheets.items():
        business_name = sheet_config.get("business_name", key)
        entity = sheet_config.get("entity", "BV")
        cache_key = f"sheets_{key}"
        cached = load_cache(cache_key)
        if cached and "data" in cached:
            months = [
                MonthData(
                    year=m["year"], month=m["month"],
                    revenue=m["revenue"], expenses=m["expenses"],
                    profit=m["profit"], currency=m.get("currency", "EUR"),
                    extra=m.get("extra", {})
                )
                for m in cached["data"].get("months", [])
            ]
            businesses.append(BusinessData(
                name=business_name, entity=entity,
                months=months, source="google_sheets_cached",
                last_updated=cached.get("saved_at")
            ))
        else:
            businesses.append(BusinessData(
                name=business_name, entity=entity,
                source="not_configured", last_updated=None
            ))
    return businesses


def _load_investments(config: dict):
    """Laad alle investment data."""
    from backend.connectors.investments_manual import InvestmentsManualConnector
    from backend.connectors.revolut_manual import RevolutManualConnector
    from backend.connectors.degiro import DegiroConnector

    investments = []

    # Savings + Loans (manual)
    try:
        investments.extend(InvestmentsManualConnector().fetch())
    except Exception as e:
        logger.warning("InvestmentsManualConnector fout: %s", e)

    # Revolut Crypto (manual)
    try:
        investments.extend(RevolutManualConnector().fetch())
    except Exception as e:
        logger.warning("RevolutManualConnector fout: %s", e)

    # DeGiro Stocks
    degiro_config = config.get("degiro", {"cache_ttl_hours": 4})
    try:
        investments.extend(DegiroConnector(degiro_config).fetch())
    except Exception as e:
        logger.warning("DegiroConnector fout: %s", e)

    return investments


# ── Dashboard aggregatie ──────────────────────────────────────────────────────

def _build_dashboard(period: str, config: dict) -> dict:
    """Bouw het volledige dashboard payload."""
    from backend.aggregator import (
        aggregate_all_businesses,
        build_monthly_chart_data,
        calculate_period_change,
        build_net_worth,
        build_entity_view,
        build_bol_detail,
        build_retailers_detail,
        build_hears_detail,
    )
    from backend.connectors.asset_history import get_history, save_snapshot

    businesses = _load_businesses(config)
    investments = _load_investments(config)

    # Aggregeer businesses
    agg = aggregate_all_businesses(businesses, period)
    chart_data = build_monthly_chart_data(businesses)
    period_change = calculate_period_change(businesses)
    net_worth = build_net_worth(investments)
    entities = build_entity_view(businesses, period)

    # Sla asset snapshot op (eenmalig per maand)
    try:
        save_snapshot(net_worth)
    except Exception as e:
        logger.warning("save_snapshot fout: %s", e)

    # Asset history
    asset_history_raw = get_history()
    asset_history = [
        {
            "date": s.get("date", ""),
            "year": s.get("year"),
            "month": s.get("month"),
            "total": s.get("total", 0),
            "stocks": s.get("stocks", 0),
            "crypto": s.get("crypto", 0),
            "savings": s.get("savings", 0),
            "loans": s.get("loans", 0),
        }
        for s in asset_history_raw
    ]

    # Detail views
    bol_detail = build_bol_detail(businesses)
    retailers_detail = build_retailers_detail(businesses)
    hears_detail = build_hears_detail(businesses)

    # KPIs
    total = agg["total"]
    kpis = {
        "revenue_mtd": total["revenue"],
        "profit_mtd": total["profit"],
        "roi_pct": total["margin"],
    }

    return {
        "last_refresh": datetime.now().isoformat() + "Z",
        "period": period,
        "net_worth": net_worth,
        "kpis": kpis,
        "kpi_changes": period_change,
        "businesses": agg["businesses"],
        "chart_data": chart_data,
        "asset_history": asset_history,
        "bol_detail": bol_detail,
        "retailers_detail": retailers_detail,
        "hears_detail": hears_detail,
        "investments": {"items": agg["businesses"]},
        "entities": entities,
    }


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> Flask:
    logger.info("create_app() gestart")

    config = _load_config()
    app = Flask(__name__, static_folder=FRONTEND_DIR)

    # ── GET / ─────────────────────────────────────────────────────────────────
    @app.route("/")
    def index():
        logger.info("GET /")
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            logger.info("index.html gevonden, serveren vanuit %s", FRONTEND_DIR)
            return send_from_directory(FRONTEND_DIR, "index.html")
        logger.warning("index.html NIET gevonden op %s — fallback HTML", index_path)
        return (
            "<html><body>"
            "<h1>Lars Dashboard</h1>"
            "<p>App draait. Frontend niet gevonden op: <code>{}</code></p>"
            "</body></html>".format(index_path),
            200,
        )

    # ── GET /api/health ───────────────────────────────────────────────────────
    @app.route("/api/health")
    def api_health():
        logger.info("GET /api/health")
        return jsonify({
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
        })

    # ── GET /api/dashboard ────────────────────────────────────────────────────
    @app.route("/api/dashboard")
    def api_dashboard():
        period = request.args.get("period", "mtd")
        if period not in ("mtd", "prev", "ytd", "yoy"):
            period = "mtd"
        logger.info("GET /api/dashboard?period=%s", period)
        try:
            data = _build_dashboard(period, config)
            return jsonify(data)
        except Exception as e:
            logger.exception("Fout bij opbouwen dashboard")
            return jsonify({"error": str(e)}), 500

    # ── POST /api/supplement ──────────────────────────────────────────────────
    @app.route("/api/supplement", methods=["POST"])
    def api_supplement_post():
        """Sla US supplement brand maanddata op."""
        from backend.connectors.supplement_manual import SupplementManualConnector
        body = request.get_json(force=True, silent=True) or {}
        try:
            year = int(body.get("year", datetime.now().year))
            month = int(body.get("month", datetime.now().month))
            revenue = float(body.get("revenue", 0))
            expenses = float(body.get("expenses", 0))
            SupplementManualConnector.save_month(year, month, revenue, expenses)
            logger.info("Supplement opgeslagen: %d-%02d rev=%.2f exp=%.2f", year, month, revenue, expenses)
            return jsonify({"ok": True, "year": year, "month": month,
                            "revenue": revenue, "expenses": expenses,
                            "profit": revenue - expenses})
        except Exception as e:
            logger.exception("Fout bij opslaan supplement")
            return jsonify({"error": str(e)}), 500

    # ── GET /api/revolut ──────────────────────────────────────────────────────
    @app.route("/api/revolut", methods=["GET"])
    def api_revolut_get():
        """Haal Revolut crypto holdings op."""
        from backend.connectors.revolut_manual import RevolutManualConnector
        try:
            holdings = RevolutManualConnector.get_holdings()
            return jsonify({"holdings": holdings})
        except Exception as e:
            logger.exception("Fout bij ophalen Revolut")
            return jsonify({"holdings": [], "error": str(e)}), 500

    # ── POST /api/revolut ─────────────────────────────────────────────────────
    @app.route("/api/revolut", methods=["POST"])
    def api_revolut_post():
        """Sla Revolut crypto holdings op."""
        from backend.connectors.revolut_manual import RevolutManualConnector
        body = request.get_json(force=True, silent=True) or {}
        try:
            holdings = body.get("holdings", [])
            RevolutManualConnector.save_holdings(holdings)
            logger.info("Revolut holdings opgeslagen: %d items", len(holdings))
            return jsonify({"ok": True, "holdings": holdings})
        except Exception as e:
            logger.exception("Fout bij opslaan Revolut")
            return jsonify({"error": str(e)}), 500

    # ── GET /api/investments ──────────────────────────────────────────────────
    @app.route("/api/investments", methods=["GET"])
    def api_investments_get():
        """Haal investment data op (savings, loans, stocks, crypto)."""
        try:
            investments = _load_investments(config)
            from backend.aggregator import build_net_worth
            net_worth = build_net_worth(investments)
            return jsonify(net_worth)
        except Exception as e:
            logger.exception("Fout bij ophalen investments")
            return jsonify({"error": str(e)}), 500

    # ── POST /api/investments ─────────────────────────────────────────────────
    @app.route("/api/investments", methods=["POST"])
    def api_investments_post():
        """Sla savings balance op."""
        from backend.connectors.investments_manual import InvestmentsManualConnector
        body = request.get_json(force=True, silent=True) or {}
        try:
            savings = body.get("savings")
            if savings is not None:
                InvestmentsManualConnector.save_savings(float(savings))
                logger.info("Savings opgeslagen: %.2f", float(savings))
            return jsonify({"ok": True})
        except Exception as e:
            logger.exception("Fout bij opslaan investments")
            return jsonify({"error": str(e)}), 500

    # ── GET /api/spagency ─────────────────────────────────────────────────────
    @app.route("/api/spagency", methods=["GET"])
    def api_spagency_get():
        """Haal SP Agency maanddata op."""
        from backend.cache import load_manual
        try:
            data = load_manual("spagency")
            return jsonify({"months": data.get("months", [])})
        except Exception as e:
            logger.exception("Fout bij ophalen SP Agency")
            return jsonify({"months": [], "error": str(e)}), 500

    # ── POST /api/spagency ────────────────────────────────────────────────────
    @app.route("/api/spagency", methods=["POST"])
    def api_spagency_post():
        """Sla SP Agency maanddata op."""
        from backend.cache import load_manual, save_manual
        body = request.get_json(force=True, silent=True) or {}
        try:
            months = body.get("months", [])
            data = load_manual("spagency")
            data["months"] = months
            data["last_updated"] = datetime.now().isoformat()
            save_manual("spagency", data)
            logger.info("SP Agency opgeslagen: %d maanden", len(months))
            return jsonify({"ok": True, "months": months})
        except Exception as e:
            logger.exception("Fout bij opslaan SP Agency")
            return jsonify({"error": str(e)}), 500

    # ── GET /api/loans ────────────────────────────────────────────────────────
    @app.route("/api/loans", methods=["GET"])
    def api_loans_get():
        """Haal loan items op."""
        from backend.connectors.investments_manual import InvestmentsManualConnector
        try:
            items = InvestmentsManualConnector.get_loan_items()
            return jsonify({"items": items})
        except Exception as e:
            logger.exception("Fout bij ophalen loans")
            return jsonify({"items": [], "error": str(e)}), 500

    # ── POST /api/loans ───────────────────────────────────────────────────────
    @app.route("/api/loans", methods=["POST"])
    def api_loans_post():
        """Sla loan items op."""
        from backend.connectors.investments_manual import InvestmentsManualConnector
        body = request.get_json(force=True, silent=True) or {}
        try:
            items = body.get("items", [])
            InvestmentsManualConnector.save_loan_items(items)
            logger.info("Loans opgeslagen: %d items", len(items))
            return jsonify({"ok": True, "items": items})
        except Exception as e:
            logger.exception("Fout bij opslaan loans")
            return jsonify({"error": str(e)}), 500

    # ── GET /api/shopify ──────────────────────────────────────────────────────
    @app.route("/api/shopify", methods=["GET"])
    def api_shopify_get():
        """Haal Shopify maanddata op (Google Sheets of cache)."""
        from backend.connectors.shopify_sheets import ShopifySheetsConnector
        from backend.cache import load_cache
        try:
            connector = ShopifySheetsConnector()
            months = connector.fetch()
            return jsonify({"months": months})
        except Exception as e:
            logger.warning("ShopifySheetsConnector fout, probeer cache: %s", e)
            # Fallback: laad rechtstreeks uit cache
            try:
                cached = load_cache("shopify_sheets")
                if cached and "data" in cached:
                    return jsonify({"months": cached["data"].get("months", [])})
            except Exception:
                pass
            return jsonify({"months": [], "error": str(e)})

    # ── POST /api/degiro/login/start ──────────────────────────────────────────
    @app.route("/api/degiro/login/start", methods=["POST"])
    def api_degiro_login_start():
        """Start DeGiro login (stap 1: gebruikersnaam + wachtwoord)."""
        from backend.connectors.degiro import DegiroConnector
        body = request.get_json(force=True, silent=True) or {}
        username = body.get("username", "")
        password = body.get("password", "")
        if not username or not password:
            return jsonify({"status": "error", "message": "Gebruikersnaam en wachtwoord zijn verplicht."}), 400
        try:
            degiro_config = config.get("degiro", {"cache_ttl_hours": 4})
            connector = DegiroConnector(degiro_config)
            result = connector.login_start(username, password)
            logger.info("DeGiro login start: status=%s", result.get("status"))
            return jsonify(result)
        except Exception as e:
            logger.exception("Fout bij DeGiro login start")
            return jsonify({"status": "error", "message": str(e)}), 500

    # ── POST /api/degiro/login/confirm ────────────────────────────────────────
    @app.route("/api/degiro/login/confirm", methods=["POST"])
    def api_degiro_login_confirm():
        """Bevestig DeGiro in-app login (polling na push notificatie)."""
        from backend.connectors.degiro import DegiroConnector
        try:
            degiro_config = config.get("degiro", {"cache_ttl_hours": 4})
            connector = DegiroConnector(degiro_config)
            result = connector.login_confirm()
            logger.info("DeGiro login confirm: status=%s", result.get("status"))
            return jsonify(result)
        except Exception as e:
            logger.exception("Fout bij DeGiro login confirm")
            return jsonify({"status": "error", "message": str(e)}), 500

    # ── POST /api/degiro/login/verify ─────────────────────────────────────────
    @app.route("/api/degiro/login/verify", methods=["POST"])
    def api_degiro_login_verify():
        """Verifieer DeGiro TOTP-code (stap 2 van 2FA login)."""
        from backend.connectors.degiro import DegiroConnector
        body = request.get_json(force=True, silent=True) or {}
        otp = body.get("otp", "")
        if not otp:
            return jsonify({"status": "error", "message": "OTP-code is verplicht."}), 400
        try:
            degiro_config = config.get("degiro", {"cache_ttl_hours": 4})
            connector = DegiroConnector(degiro_config)
            result = connector.login_verify(str(otp))
            logger.info("DeGiro login verify: status=%s", result.get("status"))
            return jsonify(result)
        except Exception as e:
            logger.exception("Fout bij DeGiro login verify")
            return jsonify({"status": "error", "message": str(e)}), 500

    # ── GET /api/degiro/status ────────────────────────────────────────────────
    @app.route("/api/degiro/status", methods=["GET"])
    def api_degiro_status():
        """Haal DeGiro verbindingsstatus op."""
        from backend.connectors.degiro import _load_session
        from backend.cache import load_cache
        try:
            session = _load_session()
            cached = load_cache("degiro_portfolio")
            connected = session is not None
            last_updated = None
            portfolio_value = None
            if cached and "data" in cached and cached["data"]:
                last_updated = cached.get("saved_at")
                portfolio_value = cached["data"].get("current_value_eur")
            return jsonify({
                "connected": connected,
                "last_updated": last_updated,
                "portfolio_value_eur": portfolio_value,
                "session_saved_at": session.get("saved_at") if session else None,
            })
        except Exception as e:
            logger.exception("Fout bij ophalen DeGiro status")
            return jsonify({"connected": False, "error": str(e)}), 500

    # ── POST /api/degiro/refresh ──────────────────────────────────────────────
    @app.route("/api/degiro/refresh", methods=["POST"])
    def api_degiro_refresh():
        """Ververs DeGiro portfolio data (forceert nieuwe API-aanroep)."""
        from backend.connectors.degiro import DegiroConnector
        from backend.cache import save_cache
        try:
            # Invalideer cache zodat verse data opgehaald wordt
            save_cache("degiro_portfolio", {})
            degiro_config = config.get("degiro", {"cache_ttl_hours": 4})
            connector = DegiroConnector(degiro_config)
            investments = connector.fetch()
            if investments and investments[0].source not in ("not_connected", "session_expired"):
                inv = investments[0]
                logger.info("DeGiro vernieuwd: %.2f EUR", inv.current_value_eur)
                return jsonify({
                    "ok": True,
                    "value_eur": inv.current_value_eur,
                    "monthly_pnl_eur": inv.monthly_pnl_eur,
                    "source": inv.source,
                })
            return jsonify({"ok": False, "message": "Niet verbonden met DeGiro. Log eerst in."})
        except Exception as e:
            logger.exception("Fout bij vernieuwen DeGiro")
            return jsonify({"ok": False, "error": str(e)}), 500

    # ── GET /api/quarterly/<entity_slug> ──────────────────────────────────────
    @app.route("/api/quarterly/<entity_slug>", methods=["GET"])
    def api_quarterly_get(entity_slug):
        """Haal kwartaaldata op voor een entiteit."""
        entity_dir = os.path.join(QUARTERLY_DIR, entity_slug)
        if not os.path.isdir(entity_dir):
            return jsonify([])
        try:
            quarters = []
            for fname in sorted(os.listdir(entity_dir)):
                if not fname.endswith(".json"):
                    continue
                fpath = os.path.join(entity_dir, fname)
                with open(fpath, "r") as f:
                    qdata = json.load(f)
                # Parse period from filename: "2025_Annual.json", "2026_Q1.json"
                stem = fname[:-5]  # strip .json
                parts = stem.split("_")
                year = int(parts[0]) if parts else 0
                period_label = parts[1] if len(parts) > 1 else stem
                quarter_num = 0
                if period_label.startswith("Q"):
                    try:
                        quarter_num = int(period_label[1:])
                    except ValueError:
                        pass
                # sort_key: year*10 for Annual, year*10+quarter for Q1-Q4
                sort_key = year * 10 if period_label == "Annual" else year * 10 + quarter_num
                quarters.append({
                    "year": year,
                    "quarter": quarter_num,
                    "period_label": f"Q{quarter_num} {year}" if quarter_num else f"Annual {year}",
                    "filename": fname,
                    "sort_key": sort_key,
                    **qdata,
                })
            quarters.sort(key=lambda q: q["sort_key"])
            return jsonify(quarters)
        except Exception as e:
            logger.exception("Fout bij ophalen kwartaaldata voor %s", entity_slug)
            return jsonify({"error": str(e)}), 500

    # ── POST /api/quarterly/upload ────────────────────────────────────────────
    @app.route("/api/quarterly/upload", methods=["POST"])
    def api_quarterly_upload():
        """Upload kwartaal JSON-bestand voor een entiteit."""
        try:
            entity_slug = request.form.get("entity_slug", "")
            quarter = request.form.get("quarter", "")
            if not entity_slug or not quarter:
                return jsonify({"error": "entity_slug en quarter zijn verplicht."}), 400

            uploaded_file = request.files.get("file")
            if not uploaded_file:
                return jsonify({"error": "Geen bestand meegestuurd."}), 400

            # Valideer JSON
            try:
                content = json.loads(uploaded_file.read())
            except json.JSONDecodeError as e:
                return jsonify({"error": f"Ongeldig JSON-bestand: {e}"}), 400

            entity_dir = os.path.join(QUARTERLY_DIR, entity_slug)
            os.makedirs(entity_dir, exist_ok=True)
            fname = f"{quarter}.json"
            fpath = os.path.join(entity_dir, fname)
            with open(fpath, "w") as f:
                json.dump(content, f, indent=2)

            logger.info("Kwartaalbestand opgeslagen: %s/%s", entity_slug, fname)
            return jsonify({"ok": True, "entity": entity_slug, "quarter": quarter})
        except Exception as e:
            logger.exception("Fout bij uploaden kwartaaldata")
            return jsonify({"error": str(e)}), 500

    # ── Static frontend assets ────────────────────────────────────────────────
    @app.route("/<path:filename>")
    def static_files(filename):
        return send_from_directory(FRONTEND_DIR, filename)

    logger.info(
        "create_app() klaar — routes geregistreerd: /, /api/health, /api/dashboard, "
        "/api/supplement, /api/revolut, /api/investments, /api/spagency, /api/loans, "
        "/api/shopify, /api/degiro/*, /api/quarterly/*"
    )
    return app
