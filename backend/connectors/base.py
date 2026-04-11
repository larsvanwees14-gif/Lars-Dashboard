from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Union, List


@dataclass
class MonthData:
    """Financial data for one month."""
    year: int
    month: int          # 1-12
    revenue: float = 0.0
    expenses: float = 0.0
    profit: float = 0.0
    currency: str = "EUR"
    extra: dict = field(default_factory=dict)  # Additional KPIs (margins, returns, etc.)

    @property
    def margin(self) -> float:
        """Winstmarge als percentage."""
        if self.revenue == 0:
            return 0.0
        return (self.profit / self.revenue) * 100

    @property
    def period_key(self) -> str:
        """Unieke sleutel: '2025-01'"""
        return f"{self.year}-{self.month:02d}"


@dataclass
class BusinessData:
    """Alle data voor één business."""
    name: str
    entity: str         # "BV", "Holding", "LLC"
    currency: str = "EUR"
    months: list[MonthData] = field(default_factory=list)
    source: str = "manual"   # "google_sheets", "manual", "api"
    last_updated: Optional[str] = None


@dataclass
class InvestmentData:
    """Portfolio data for investments."""
    name: str           # "Stocks", "Revolut Crypto", "Savings"
    category: str       # "stocks", "crypto", "savings", "cash"
    current_value_eur: float = 0.0
    monthly_pnl_eur: float = 0.0
    source: str = "manual"
    last_updated: Optional[str] = None
    # Extra fields for detailed portfolio view
    total_pnl_eur: float = 0.0       # Total profit/loss (all time)
    daily_pnl_eur: float = 0.0       # Today's profit/loss
    free_space_eur: float = 0.0      # Available cash / free space


class BaseConnector(ABC):
    """Abstract base class voor alle data connectors."""

    @abstractmethod
    def fetch(self) -> Union[List['BusinessData'], List['InvestmentData']]:
        """Haalt data op. Mag cachen. Moet altijd iets teruggeven."""
        raise NotImplementedError

    def get_cache_key(self) -> str:
        return self.__class__.__name__.lower()
