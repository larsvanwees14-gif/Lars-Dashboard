"""
Test script: controleer of FinTS werkt met jouw ING account.

Gebruik:
  python3 test_ing.py

Voordat je dit runt:
  1. Sla je inloggegevens op:
     python3 -c "
     from backend.connectors.ing_fints import IngFintsConnector
     IngFintsConnector.create_credentials_file('jouw_gebruikersnaam', 'jouw_pin')
     "
  2. Vul je IBAN(s) in via config.yaml
  3. Zet fints_server en fints_blz in config.yaml (zie opmerkingen in het bestand)
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import yaml

def test():
    # Laad config
    with open("config.yaml", "r") as f:
        config = yaml.safe_load(f)

    ing_config = config.get("ing", {})
    server = ing_config.get("fints_server", "")
    blz = ing_config.get("fints_blz", "")

    print("=" * 50)
    print("  ING FinTS verbindingstest")
    print("=" * 50)
    print()

    if not server or not blz:
        print("⚠️  FinTS server of BLZ niet geconfigureerd in config.yaml.")
        print()
        print("   Voor ING Nederland: er is geen bekend publiek FinTS endpoint.")
        print("   Voor ING Duitsland:")
        print("     fints_server: \"https://fints.ing.de/fints\"")
        print("     fints_blz: \"50010517\"")
        print()
        print("   Als je het ING NL endpoint niet kent, gebruik dan de")
        print("   CSV-import optie in het dashboard.")
        return

    print(f"→ Server: {server}")
    print(f"→ BLZ: {blz}")
    print()

    from backend.connectors.ing_fints import IngFintsConnector
    result = IngFintsConnector.test_connection(ing_config)

    if result["success"]:
        print(f"✅ Verbinding geslaagd! {result['accounts_found']} rekening(en) gevonden:")
        for acc in result.get("accounts", []):
            print(f"   • {acc['name']}: € {acc['balance']:,.2f}")
        print()
        print("Dashboard toont nu automatisch je ING saldi.")
    else:
        print(f"❌ Verbinding mislukt:")
        print(f"   {result['error']}")
        print()
        print("Mogelijke oorzaken:")
        print("  • ING Nederland ondersteunt FinTS niet (gebruik CSV-import)")
        print("  • Verkeerde server URL of BLZ")
        print("  • Verkeerde gebruikersnaam of PIN")
        print("  • ING heeft de verbinding geblokkeerd na te veel pogingen")
        print()
        print("Alternatief: gebruik de CSV-import in het dashboard.")
        print("  1. Open Mijn ING → Rekening → Afschriften → Exporteren")
        print("  2. Kies CSV-formaat")
        print("  3. Klik 'CSV importeren' in het dashboard")

if __name__ == "__main__":
    test()
