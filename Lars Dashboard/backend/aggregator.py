"""
Aggregator — combineert data uit alle connectors tot dashboard-ready formaat.
"""
from datetime import datetime
from backend.connectors.base import BusinessData, InvestmentData, MonthData


# ── Period helpers ────────────────────────────────────────────────────────────

def _current_period():
    now = datetime.now()
    return now.year, now.month


def _filter_months(months: list[MonthData], period: str) -> list[MonthData]:
    """Filter maanden op basis van period (mtd, prev, ytd, yoy)."""
    year, month = _current_period()
    if period == "mtd":
        return [m for m in months if m.year == year and m.month == month]
    elif period == "prev":
        pm = month - 1 if month > 1 else 12
        py = year if month > 1 else year - 1
        return [m for m in months if m.year == py and m.month == pm]
    elif period == "ytd":
        return [m for m in months if m.year == year and m.month <= month]
    elif period == "yoy":
        return [m for m in months if m.year == year - 1]
    return months


# ── Aggregate businesses ─────────────────────────────────────────────────────

def aggregate_all_businesses(businesses: list[BusinessData], period: str = "mtd") -> dict:
    """Aggregeer alle businesses tot totaal KPIs."""
    result = []
    total_revenue = 0
    total_expenses = 0
    total_profit = 0

    for biz in businesses:
        filtered = _filter_months(biz.months, period)
        rev = sum(m.revenue for m in filtered)
        exp = sum(m.expenses for m in filtered)
        profit = sum(m.profit for m in filtered)
        margin = (profit / rev * 100) if rev > 0 else 0.0

        total_revenue += rev
        total_expenses += exp
        total_profit += profit

        result.append({
            "name": biz.name,
            "entity": biz.entity,
            "revenue": round(rev, 2),
            "expenses": round(exp, 2),
            "profit": round(profit, 2),
            "margin": round(margin, 1),
            "months_count": len(filtered),
            "source": biz.source,
            "last_updated": biz.last_updated,
        })

    total_margin = (total_profit / total_revenue * 100) if total_revenue > 0 else 0.0

    return {
        "total": {
            "revenue": round(total_revenue, 2),
            "expenses": round(total_expenses, 2),
            "profit": round(total_profit, 2),
            "margin": round(total_margin, 1),
        },
        "businesses": result,
    }


# ── Monthly chart data ───────────────────────────────────────────────────────

def build_monthly_chart_data(businesses: list[BusinessData]) -> dict:
    """Bouw chart data: revenue + profit per maand per business."""
    month_labels = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
    # Map months: Apr=4..Dec=12 of current-1 year, Jan=1..Mar=3 of current year
    year, _ = _current_period()

    month_keys = []
    for m in range(4, 13):
        month_keys.append((year - 1, m))
    for m in range(1, 4):
        month_keys.append((year, m))

    datasets = []
    for biz in businesses:
        month_map = {(m.year, m.month): m for m in biz.months}
        rev_data = []
        profit_data = []
        for y, m in month_keys:
            md = month_map.get((y, m))
            rev_data.append(round(md.revenue) if md and md.revenue else None)
            profit_data.append(round(md.profit) if md and md.profit else None)

        datasets.append({
            "business": biz.name,
            "entity": biz.entity,
            "revenue": rev_data,
            "profit": profit_data,
        })

    return {
        "labels": month_labels,
        "datasets": datasets,
    }


# ── Period change ────────────────────────────────────────────────────────────

def calculate_period_change(businesses: list[BusinessData]) -> dict:
    """Bereken verandering t.o.v. vorige maand."""
    year, month = _current_period()
    pm = month - 1 if month > 1 else 12
    py = year if month > 1 else year - 1

    current_profit = 0
    prev_profit = 0
    for biz in businesses:
        for m in biz.months:
            if m.year == year and m.month == month:
                current_profit += m.profit
            if m.year == py and m.month == pm:
                prev_profit += m.profit

    if prev_profit == 0:
        change_pct = 0
    else:
        change_pct = round((current_profit - prev_profit) / abs(prev_profit) * 100, 1)

    return {
        "current": round(current_profit, 2),
        "previous": round(prev_profit, 2),
        "change_pct": change_pct,
        "direction": "up" if current_profit >= prev_profit else "down",
    }


# ── Net worth ────────────────────────────────────────────────────────────────

def build_net_worth(investments: list[InvestmentData]) -> dict:
    """Bouw net worth overzicht."""
    total = sum(inv.current_value_eur for inv in investments)
    monthly_pnl = sum(inv.monthly_pnl_eur for inv in investments)

    breakdown = []
    for inv in investments:
        pct = (inv.current_value_eur / total * 100) if total > 0 else 0
        breakdown.append({
            "name": inv.name,
            "category": inv.category,
            "value_eur": round(inv.current_value_eur, 2),
            "monthly_pnl_eur": inv.monthly_pnl_eur,
            "total_pnl_eur": inv.total_pnl_eur,
            "daily_pnl_eur": inv.daily_pnl_eur,
            "free_space_eur": inv.free_space_eur,
            "percentage": round(pct, 1),
            "source": inv.source,
            "last_updated": inv.last_updated,
        })

    return {
        "total_eur": round(total, 2),
        "monthly_pnl_eur": round(monthly_pnl, 2),
        "breakdown": breakdown,
    }


# ── Entity view ──────────────────────────────────────────────────────────────

def build_entity_view(businesses: list[BusinessData], period: str = "mtd") -> list:
    """Groepeer businesses per entity (BV, LLC, etc.)."""
    entities = {}
    for biz in businesses:
        if biz.entity not in entities:
            entities[biz.entity] = {"entity": biz.entity, "businesses": [], "revenue": 0, "expenses": 0, "profit": 0}
        entities[biz.entity]["businesses"].append(biz.name)
        filtered = _filter_months(biz.months, period)
        entities[biz.entity]["revenue"] += sum(m.revenue for m in filtered)
        entities[biz.entity]["expenses"] += sum(m.expenses for m in filtered)
        entities[biz.entity]["profit"] += sum(m.profit for m in filtered)

    result = []
    for e in entities.values():
        e["revenue"] = round(e["revenue"], 2)
        e["expenses"] = round(e["expenses"], 2)
        e["profit"] = round(e["profit"], 2)
        e["margin"] = round(e["profit"] / e["revenue"] * 100, 1) if e["revenue"] > 0 else 0.0
        result.append(e)

    return result


# ── Bol / Retailers / Hears detail ───────────────────────────────────────────

def _build_detail(biz: BusinessData) -> dict:
    """Bouw gedetailleerd overzicht voor een business met alle extra KPIs."""
    year, month = _current_period()
    pm = month - 1 if month > 1 else 12
    py = year if month > 1 else year - 1

    months_data = []
    for m in sorted(biz.months, key=lambda x: (x.year, x.month)):
        entry = {
            "year": m.year,
            "month": m.month,
            "label": f"{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m.month-1]} {m.year}",
            "revenue": round(m.revenue, 1),
            "expenses": round(m.expenses, 1),
            "profit": round(m.profit, 1),
            "profit_pct": round(m.margin, 1),
        }
        # Extra fields from connector
        for k, v in m.extra.items():
            if isinstance(v, (int, float)):
                entry[k] = round(v, 1)
            else:
                entry[k] = v
        months_data.append(entry)

    # Current and previous month
    current = next((m for m in months_data if m["year"] == year and m["month"] == month), None)
    previous = next((m for m in months_data if m["year"] == py and m["month"] == pm), None)

    if not current and months_data:
        current = months_data[-1]
    if not previous and len(months_data) >= 2:
        previous = months_data[-2]

    # Changes
    changes = {}
    if current and previous:
        for key in ["revenue", "profit", "gross_margin", "nett_margin_product", "returns", "non_saleable_costs", "storage_cost", "recovery_clients"]:
            cur_val = current.get(key, 0) or 0
            prev_val = previous.get(key, 0) or 0
            if prev_val != 0:
                pct = round((cur_val - prev_val) / abs(prev_val) * 100, 1)
            else:
                pct = 0
            changes[key] = {
                "current": cur_val,
                "previous": prev_val,
                "change_pct": pct,
                "direction": "up" if cur_val >= prev_val else "down",
            }

    return {
        "months": months_data,
        "current": current,
        "previous": previous,
        "changes": changes,
        "source": biz.source,
    }


def _find_business(businesses: list[BusinessData], name_match: str) -> BusinessData:
    """Vind een business op naam (case-insensitive, contains)."""
    for biz in businesses:
        if name_match.lower() in biz.name.lower():
            return biz
    return None


def build_bol_detail(businesses: list[BusinessData]) -> dict:
    biz = _find_business(businesses, "bol")
    if not biz:
        return {"months": [], "current": None, "previous": None, "changes": {}, "source": "not_found"}
    return _build_detail(biz)


def build_retailers_detail(businesses: list[BusinessData]) -> dict:
    biz = _find_business(businesses, "retail")
    if not biz:
        return {"months": [], "current": None, "previous": None, "changes": {}, "source": "not_found"}
    return _build_detail(biz)


def build_hears_detail(businesses: list[BusinessData]) -> dict:
    biz = _find_business(businesses, "hears")
    if not biz:
        return {"months": [], "current": None, "previous": None, "changes": {}, "source": "not_found"}
    return _build_detail(biz)
