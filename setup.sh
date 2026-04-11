#!/bin/bash
# ============================================================
#  Lars Dashboard — Eenmalige installatie
# ============================================================

set -e

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
CREDS_DIR="$HOME/.lars-dashboard"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Lars Dashboard — Setup             ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Stap 1: Python check ─────────────────────────────────────
echo "→ Python controleren..."
if ! command -v python3 &> /dev/null; then
    echo "✗ Python 3 niet gevonden. Download via: https://www.python.org"
    exit 1
fi
PYTHON_VERSION=$(python3 --version 2>&1)
echo "✓ $PYTHON_VERSION gevonden"

# ── Stap 2: pip packages installeren ─────────────────────────
echo ""
echo "→ Python packages installeren..."
pip3 install -r "$DASHBOARD_DIR/requirements.txt" --quiet
echo "✓ Packages geïnstalleerd"

# ── Stap 3: Mappen aanmaken ───────────────────────────────────
echo ""
echo "→ Mappen aanmaken..."
mkdir -p "$CREDS_DIR"
chmod 700 "$CREDS_DIR"
mkdir -p "$DASHBOARD_DIR/data/cache"
mkdir -p "$DASHBOARD_DIR/data/manual"
mkdir -p "$DASHBOARD_DIR/data/manual/revolut_imports"
echo "✓ Mappen aangemaakt"

# ── Stap 4: Start-knop aanmaken ───────────────────────────────
echo ""
echo "→ Start Dashboard.command aanmaken..."
START_FILE="$DASHBOARD_DIR/Start Dashboard.command"
cat > "$START_FILE" << 'STARTSCRIPT'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
echo "Lars Dashboard wordt gestart..."
python3 app.py
STARTSCRIPT
chmod +x "$START_FILE"
echo "✓ Start Dashboard.command aangemaakt"

# ── Stap 5: Google Sheets instructies ────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Volgende stap: Google Sheets koppelen                   ║"
echo "║                                                          ║"
echo "║  1. Ga naar: console.cloud.google.com                    ║"
echo "║  2. Maak een nieuw project aan (bijv. 'lars-dashboard')  ║"
echo "║  3. Activeer de 'Google Sheets API'                      ║"
echo "║  4. Maak een 'Service Account' aan                       ║"
echo "║  5. Download het JSON sleutelbestand                     ║"
echo "║  6. Sla het op als:                                      ║"
echo "║     ~/.lars-dashboard/google_service_account.json        ║"
echo "║  7. Deel je spreadsheets met het service account email   ║"
echo "║  8. Vul de spreadsheet IDs in via config.yaml            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Setup voltooid! Dubbelklik op 'Start Dashboard.command' om te beginnen."
echo ""
