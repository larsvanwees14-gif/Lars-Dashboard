import os
import sys
import logging

# Voeg de project root toe aan het Python pad
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

logger.info("app.py wordt geladen...")

from backend.server import create_app

if __name__ == "__main__":
    logger.info("Flask app aanmaken...")
    app = create_app()

    port = int(os.environ.get("PORT", 5050))
    host = "0.0.0.0"

    logger.info("Server starten op %s:%s", host, port)
    print("\n" + "=" * 50)
    print("  Lars Dashboard wordt gestart...")
    print("  Open: http://{}:{}".format(host, port))
    print("  Stop: Ctrl+C")
    print("=" * 50 + "\n")

    app.run(host=host, port=port, debug=False)
