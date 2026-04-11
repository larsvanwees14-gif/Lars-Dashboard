import os
import logging
from datetime import datetime
from flask import Flask, jsonify, send_from_directory

# ── Logging configuratie ──────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Paden ─────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

logger.info("BASE_DIR    : %s", BASE_DIR)
logger.info("FRONTEND_DIR: %s", FRONTEND_DIR)


def create_app() -> Flask:
    logger.info("create_app() gestart")

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
        logger.info("GET /api/dashboard")
        return jsonify({"error": "not implemented yet"}), 200

    logger.info("create_app() klaar — routes geregistreerd: /, /api/health, /api/dashboard")
    return app
