"""
Test script: sla Degiro credentials op en test de verbinding.

Gebruik:
  python3 test_degiro.py --setup    # Credentials instellen
  python3 test_degiro.py            # Verbinding testen
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def setup():
    print()
    print("╔══════════════════════════════════════════╗")
    print("║       Degiro — Credentials instellen     ║")
    print("╚══════════════════════════════════════════╝")
    print()
    print("Vul je Degiro inloggegevens in.")
    print("Deze worden LOKAAL opgeslagen (alleen leesbaar voor jou).")
    print()

    username = input("Degiro gebruikersnaam: ").strip()
    password = input("Degiro wachtwoord: ").strip()

    print()
    print("Heb je 2FA (twee-staps verificatie) ingeschakeld op Degiro? (j/n)")
    has_2fa = input("> ").strip().lower() in ["j", "ja", "y", "yes"]

    totp_secret = ""
    if has_2fa:
        print()
        print("Voer je TOTP secret key in (te vinden bij het instellen van 2FA):")
        print("Dit is NIET de 6-cijferige code, maar de lange sleutel (bijv. JBSWY3DPEHPK3PXP)")
        totp_secret = input("> ").strip()

    from backend.connectors.degiro import DegiroConnector
    DegiroConnector.create_credentials_file(username, password, totp_secret)

    print()
    print("✓ Credentials opgeslagen. Voer nu 'python3 test_degiro.py' uit om te testen.")


def test():
    import yaml

    print()
    print("╔══════════════════════════════════════════╗")
    print("║       Degiro — Verbindingstest           ║")
    print("╚══════════════════════════════════════════╝")
    print()

    with open("config.yaml", "r") as f:
        config = yaml.safe_load(f)

    degiro_config = config.get("degiro", {})
    creds_file = os.path.expanduser(degiro_config.get("credentials_file", "~/.lars-dashboard/degiro_credentials.json"))

    if not os.path.exists(creds_file):
        print("⚠️  Geen credentials gevonden.")
        print(f"   Verwacht bestand: {creds_file}")
        print()
        print("   Voer eerst uit: python3 test_degiro.py --setup")
        return

    print(f"→ Credentials gevonden: {creds_file}")
    print("→ Verbinding maken met Degiro...")
    print()

    from backend.connectors.degiro import DegiroConnector
    result = DegiroConnector.test_connection(degiro_config)

    if result["success"]:
        value = result["portfolio_value_eur"]
        pnl = result["monthly_pnl_eur"]
        pnl_sign = "+" if pnl >= 0 else ""
        print(f"✅ Verbinding geslaagd!")
        print()
        print(f"   Portfolio waarde:  € {value:,.2f}")
        print(f"   Maandelijkse P&L:  {pnl_sign}€ {pnl:,.2f}")
        print()
        print("Het dashboard toont nu automatisch je Degiro portfolio.")
        print("Data wordt elke 4 uur ververst (of via 'Ververs' knop in dashboard).")
    else:
        print(f"❌ Verbinding mislukt:")
        print(f"   {result['error']}")
        print()
        print("Mogelijke oorzaken:")
        print("  • Verkeerde gebruikersnaam of wachtwoord")
        print("  • 2FA ingeschakeld maar TOTP secret niet ingevuld")
        print("  • Degiro-server tijdelijk niet bereikbaar")
        print()
        print("Probeer opnieuw: python3 test_degiro.py --setup")


if __name__ == "__main__":
    if "--setup" in sys.argv:
        setup()
    else:
        test()
