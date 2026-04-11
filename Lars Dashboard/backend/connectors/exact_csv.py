"""
Exact Online rapportage parser — leest Balans + W&V uit PDF of tekst.
Ondersteunt het gecombineerde "Balans / Winst- en verliesrekening" rapport.
"""
import json
import os
import re
from typing import Optional

_DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
QUARTERLY_DIR = os.path.join(_DATA_DIR, "quarterly")


def _parse_amount(text: str) -> float:
    """Parse Exact Online bedrag: '184.569,84' → 184569.84"""
    text = text.strip().replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def _find_line_amount(lines: list, keyword: str, section: str = None) -> float:
    """Zoek een bedrag bij een keyword in de tekst."""
    in_section = section is None
    for line in lines:
        if section and section.lower() in line.lower():
            in_section = True
        if not in_section:
            continue

        if keyword.lower() in line.lower():
            # Zoek bedragen in de regel (formaat: 123.456,78)
            amounts = re.findall(r'[\d.]+,\d{2}', line)
            if amounts:
                return _parse_amount(amounts[-1])
    return 0.0


def _find_totaal(lines: list, keyword: str) -> tuple:
    """Zoek 'Totaal: <keyword>' en return (debet, credit) bedragen."""
    for line in lines:
        if f"Totaal: {keyword}" in line or f"totaal: {keyword.lower()}" in line.lower():
            amounts = re.findall(r'[\d.]+,\d{2}', line)
            if len(amounts) >= 2:
                return _parse_amount(amounts[0]), _parse_amount(amounts[1])
            elif len(amounts) == 1:
                # Check of het debet of credit is op basis van positie
                return _parse_amount(amounts[0]), 0.0
    return 0.0, 0.0


def parse_exact_pdf(pdf_path: str) -> dict:
    """Parse een Exact Online Balans/W&V PDF rapport."""
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        raise ImportError("PyPDF2 is vereist: pip install PyPDF2")

    reader = PdfReader(pdf_path)
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() + "\n"

    return parse_exact_text(full_text)


def parse_exact_text(text: str) -> dict:
    """Parse de tekst van een Exact Online rapport."""
    lines = text.split("\n")

    # ── BALANS ────────────────────────────────────────────────────────────────

    balans = {}

    # Voorraden
    balans["voorraden"] = _find_line_amount(lines, "Voorraden en onderhanden werk", "VLOTTENDE ACTIVA")
    if not balans["voorraden"]:
        balans["voorraden"] = _find_line_amount(lines, "0350")

    # Debiteuren
    d, c = _find_totaal(lines, "Debiteuren")
    balans["debiteuren"] = d or c

    # Liquide middelen
    d, c = _find_totaal(lines, "Liquide middelen")
    balans["liquide_middelen"] = d or c

    # Individuele bankrekeningen
    balans["bankrekening"] = _find_line_amount(lines, "akelijke bankrek")
    balans["spaarrekening"] = _find_line_amount(lines, "spaarrek") or _find_line_amount(lines, "1411")

    # Eigen vermogen / Bedrijfsvermogen
    d, c = _find_totaal(lines, "BEDRIJFSVERMOGEN")
    balans["eigen_vermogen"] = c or d
    if not balans["eigen_vermogen"]:
        d, c = _find_totaal(lines, "Bedrijfsvermogen")
        balans["eigen_vermogen"] = c or d

    # Langlopende schulden
    d, c = _find_totaal(lines, "LANGLOPENDE SCHULDEN")
    balans["langlopende_schulden"] = c or d

    # Crediteuren
    d, c = _find_totaal(lines, "Schulden aan leveranciers")
    balans["crediteuren"] = c or d

    # BTW / Belastingen
    d, c = _find_totaal(lines, "Belastingen en premies")
    balans["belastingen_schuld"] = c if c > d else -(d - c)

    # Resultaat
    for line in lines:
        if "Resultaat van geselecteerde perioden" in line:
            amounts = re.findall(r'[\d.]+,\d{2}', line)
            if amounts:
                balans["resultaat"] = _parse_amount(amounts[-1])
                break
    if "resultaat" not in balans:
        balans["resultaat"] = 0.0

    # ── WINST & VERLIES ──────────────────────────────────────────────────────

    wv = {}

    # Omzet (credit = omzet, debet = kortingen)
    d, c = _find_totaal(lines, "Omzet")
    wv["omzet"] = c if c > 0 else d  # neem het grootste bedrag

    # Omzet breakdown
    wv["omzet_bol"] = _find_line_amount(lines, "omz et bol")
    if not wv["omzet_bol"]:
        wv["omzet_bol"] = _find_line_amount(lines, "omzet bol")
    wv["omzet_zzp"] = _find_line_amount(lines, "omz et zzp")
    if not wv["omzet_zzp"]:
        wv["omzet_zzp"] = _find_line_amount(lines, "omzet zzp")

    # Bruto marge
    d, c = _find_totaal(lines, "BRUTOMARGE")
    wv["brutomarge"] = c or d

    # Kostencategorieën
    wv["kosten_bol"] = _find_line_amount(lines, "osten bol.com")
    wv["fulfilment_kosten"] = _find_line_amount(lines, "fulfilment")
    wv["inkopen"] = _find_line_amount(lines, "Ink open buiten EU")
    if not wv["inkopen"]:
        wv["inkopen"] = _find_line_amount(lines, "nkopen buiten EU")
    wv["verzendkosten"] = _find_line_amount(lines, "erzend/tr ansport") or _find_line_amount(lines, "verzend")
    wv["werk_door_derden"] = _find_line_amount(lines, "erk door derden") or _find_line_amount(lines, "Werk door derden")

    # Bedrijfskosten
    wv["advertentiekosten"] = _find_line_amount(lines, "dv ertentie") or _find_line_amount(lines, "Advertentie")
    wv["huur"] = _find_line_amount(lines, "Huur")
    wv["kantoorkosten"] = _find_line_amount(lines, "antoorbenodigdheden") or 0
    wv["porti"] = _find_line_amount(lines, "4620") or _find_line_amount(lines, "Porti")
    wv["automatisering"] = _find_line_amount(lines, "utomatisering") or _find_line_amount(lines, "Automatisering")
    wv["verzekeringen"] = _find_line_amount(lines, "ssur antie") or _find_line_amount(lines, "Assurantie")
    wv["administratiekosten"] = _find_line_amount(lines, "dministr atiekosten") or _find_line_amount(lines, "Administratiekosten")
    wv["advieskosten"] = _find_line_amount(lines, "dviesk osten") or _find_line_amount(lines, "Advieskosten")
    wv["bankkosten"] = _find_line_amount(lines, "ankk osten") or _find_line_amount(lines, "Bankkosten")
    wv["overige_kosten"] = _find_line_amount(lines, "v erige k osten") or _find_line_amount(lines, "Overige kosten")
    wv["opleidingskosten"] = _find_line_amount(lines, "pleidingsk osten") or _find_line_amount(lines, "Opleidingskosten")
    wv["afschrijvingen"] = _find_line_amount(lines, "fschrijvingsk osten") or _find_line_amount(lines, "Afschrijvingskosten")

    d, c = _find_totaal(lines, "BEDRIJFSKOSTEN")
    wv["totaal_bedrijfskosten"] = d or c

    # Financiële kosten
    d, c = _find_totaal(lines, "FINANCIELE OPBRENGSTEN")
    wv["financiele_kosten"] = d - c if d > c else 0
    wv["bankrente"] = _find_line_amount(lines, "ankrente") or _find_line_amount(lines, "Bankrente")
    wv["rente_lening"] = _find_line_amount(lines, "ente lening") or _find_line_amount(lines, "Rente lening")

    # Resultaat W&V
    wv["netto_winst"] = balans.get("resultaat", 0.0)

    # Samenvatting kostencategorieën voor dashboard
    wv["kosten_samenvatting"] = {
        "Inkoopkosten": round(wv.get("inkopen", 0) + wv.get("kosten_bol", 0) + wv.get("fulfilment_kosten", 0), 2),
        "Marketing/Ads": round(wv.get("advertentiekosten", 0), 2),
        "Software/Tools": round(wv.get("automatisering", 0), 2),
        "Verzekeringen": round(wv.get("verzekeringen", 0), 2),
        "Accountant": round(wv.get("administratiekosten", 0) + wv.get("advieskosten", 0), 2),
        "Kantoor/Opslag": round(wv.get("huur", 0) + wv.get("kantoorkosten", 0), 2),
        "Verzendkosten": round(wv.get("verzendkosten", 0) + wv.get("porti", 0), 2),
    }

    return {
        "balans": {k: round(v, 2) for k, v in balans.items()},
        "winst_verlies": {k: round(v, 2) if isinstance(v, (int, float)) else v for k, v in wv.items()},
    }


def save_quarterly(entity_slug: str, year: int, quarter, data: dict):
    """Sla kwartaal- of jaardata op als JSON. quarter kan int (1-4) of 'annual' zijn."""
    entity_dir = os.path.join(QUARTERLY_DIR, entity_slug)
    os.makedirs(entity_dir, exist_ok=True)
    if quarter == "annual":
        path = os.path.join(entity_dir, f"{year}_Annual.json")
    else:
        path = os.path.join(entity_dir, f"{year}_Q{quarter}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_quarterly(entity_slug: str) -> list:
    """Laad alle kwartaal- en jaardata voor een entiteit, gesorteerd op tijd."""
    entity_dir = os.path.join(QUARTERLY_DIR, entity_slug)
    if not os.path.exists(entity_dir):
        return []
    result = []
    for fname in sorted(os.listdir(entity_dir)):
        if fname.endswith(".json"):
            path = os.path.join(entity_dir, fname)
            with open(path, "r") as f:
                data = json.load(f)
            # Parse filename: 2025_Annual.json or 2025_Q1.json
            base = fname.replace(".json", "")
            parts = base.split("_")
            if len(parts) == 2:
                data["year"] = int(parts[0])
                if parts[1] == "Annual":
                    data["period"] = "annual"
                    data["period_label"] = f"{parts[0]} (Annual)"
                    data["sort_key"] = int(parts[0]) * 10  # Sort annual before Q1 of next year
                else:
                    q = int(parts[1].replace("Q", ""))
                    data["period"] = f"Q{q}"
                    data["period_label"] = f"Q{q} {parts[0]}"
                    data["sort_key"] = int(parts[0]) * 10 + q
            result.append(data)
    result.sort(key=lambda x: x.get("sort_key", 0))
    return result
    return result
