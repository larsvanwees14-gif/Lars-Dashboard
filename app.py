import os
import sys
import time
import threading
import webbrowser
import schedule

# Voeg de project root toe aan het Python pad
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.server import create_app

def open_browser():
    """Open de browser na een korte vertraging zodat Flask klaar is."""
    time.sleep(1.5)
    webbrowser.open("http://localhost:5050")

def run_scheduler():
    """Draait de dagelijkse auto-refresh in de achtergrond."""
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == "__main__":
    app = create_app()

    # Open browser automatisch (alleen als niet in debug reload)
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        threading.Thread(target=open_browser, daemon=True).start()
        threading.Thread(target=run_scheduler, daemon=True).start()

    print("\n" + "="*50)
    print("  Lars Dashboard wordt gestart...")
    print("  Open: http://localhost:5050")
    print("  Stop: Ctrl+C")
    print("="*50 + "\n")

    port = int(os.environ.get("PORT", 5050))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    app.run(host=host, port=port, debug=False)
