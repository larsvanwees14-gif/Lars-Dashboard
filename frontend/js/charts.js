// Chart.js configuraties
const COLORS = {
  bol: "#2563eb",
  agency: "#7c3aed",
  supplement: "#ea580c",
  profit_bol: "rgba(37,99,235,.15)",
  profit_agency: "rgba(124,58,237,.15)",
  profit_supplement: "rgba(234,88,12,.15)",
};

const BUSINESS_COLORS = ["#2563eb", "#7c3aed", "#ea580c", "#16a34a", "#0891b2"];

Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = "#6c757d";

function formatEUR(val) {
  if (val == null) return "–";
  return "€ " + Math.round(val).toLocaleString("nl-NL");
}

// Chart instanties bijhouden zodat ze kunnen worden verwijderd
const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function createOverviewChart(canvasId, chartData) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || !chartData) return;

  // Groepeer: Bol Business (alles behalve Rebrain) vs Rebrain (US Supplement Brand)
  const bolNames = ["Bol.com Business", "Bol Business", "Retailers", "Hears", "SP Agency", "Shopify"];
  const numMonths = chartData.labels.length;
  const bolRevenue = new Array(numMonths).fill(0);
  const rebrainRevenue = new Array(numMonths).fill(0);

  chartData.datasets.forEach(d => {
    const isBol = bolNames.some(n => d.business.toLowerCase().includes(n.toLowerCase()));
    const target = isBol ? bolRevenue : rebrainRevenue;
    d.revenue.forEach((v, i) => { if (v) target[i] += v; });
  });

  const datasets = [
    {
      label: "Revenue",
      data: bolRevenue.map(v => v || null),
      backgroundColor: "#2563ebcc",
      borderRadius: 4,
    }
  ];

  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels: chartData.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 16 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatEUR(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0 } },
        y: {
          grid: { color: "#f1f3f5" },
          ticks: { callback: v => "€ " + (v / 1000).toFixed(1) + "K" }
        }
      }
    }
  });
}

function createOverviewChartFiltered(canvasId, chartData, period) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || !chartData) return;

  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Groepeer: Bol Business vs Rebrain
  // Shopify wordt apart getoond (eigen kaart) en niet in het gecombineerde totaal meegeteld.
  const bolNames = ["Bol.com Business", "Bol Business", "Retailers", "Hears", "SP Agency"];
  const excludeFromTotal = ["shopify"]; // wordt niet in Bol óf Rebrain totaal meegeteld
  const numMonths = chartData.labels.length;
  const bolRevenue = new Array(numMonths).fill(0);
  const bolProfit = new Array(numMonths).fill(0);
  const rebrainRevenue = new Array(numMonths).fill(0);
  const rebrainProfit = new Array(numMonths).fill(0);

  chartData.datasets.forEach(d => {
    if (excludeFromTotal.some(n => d.business.toLowerCase().includes(n))) return;
    const isBol = bolNames.some(n => d.business.toLowerCase().includes(n.toLowerCase()));
    const tRev = isBol ? bolRevenue : rebrainRevenue;
    const tProf = isBol ? bolProfit : rebrainProfit;
    d.revenue.forEach((v, i) => { if (v) tRev[i] += v; });
    d.profit.forEach((v, i) => { if (v) tProf[i] += v; });
  });

  // Build monthMap from chartData.months when available (dynamic backend range),
  // falling back to the legacy hardcoded Apr–Mar fiscal year for older data shapes.
  let monthMap;
  if (chartData.months && chartData.months.length === numMonths) {
    monthMap = chartData.months; // [{year, month}, ...] from backend
  } else {
    // Legacy fallback: Apr(curYear-1) … Mar(curYear)
    monthMap = [];
    for (let i = 0; i < numMonths; i++) {
      const m = ((3 + i) % 12) + 1;
      const y = m >= 4 ? curYear - 1 : curYear;
      monthMap.push({ month: m, year: y });
    }
  }

  // Filter based on period (string or custom range object {from, to})
  let indices;
  if (period && typeof period === "object" && period.from) {
    const fromKey = period.from.year * 100 + period.from.month;
    const toKey   = period.to.year   * 100 + period.to.month;
    indices = monthMap.map((mm, i) => {
      const key = mm.year * 100 + mm.month;
      return key >= fromKey && key <= toKey ? i : -1;
    }).filter(i => i >= 0);
  } else if (period && period.startsWith("m")) {
    const selMonth = parseInt(period.substring(1));
    indices = monthMap.map((mm, i) => mm.year === curYear && mm.month === selMonth ? i : -1).filter(i => i >= 0);
  } else if (period === "prev") {
    const pm = curMonth === 1 ? 12 : curMonth - 1;
    const py = curMonth === 1 ? curYear - 1 : curYear;
    indices = monthMap.map((mm, i) => mm.year === py && mm.month === pm ? i : -1).filter(i => i >= 0);
  } else if (period === "yoy") {
    indices = monthMap.map((mm, i) => mm.year === curYear - 1 ? i : -1).filter(i => i >= 0);
  } else {
    // ytd
    indices = monthMap.map((mm, i) => mm.year === curYear ? i : -1).filter(i => i >= 0);
  }

  const labels = indices.map(i => chartData.labels[i]);
  const bRev = indices.map(i => bolRevenue[i] || null);
  const bProf = indices.map(i => bolProfit[i] || null);
  const rRev = indices.map(i => rebrainRevenue[i] || null);
  const rProf = indices.map(i => rebrainProfit[i] || null);

  // Update KPIs above chart (only Bol Business)
  const totalRev = bRev.reduce((t,v) => t + (v||0), 0);
  const totalProf = bProf.reduce((t,v) => t + (v||0), 0);
  const kpisEl = document.getElementById("overview-chart-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div><div class="metric-label">Total Revenue</div><div class="metric-value">${formatEUR(totalRev)}</div></div>
      <div><div class="metric-label">Total Profit</div><div class="metric-value" style="color:#16a34a">${formatEUR(totalProf)}</div></div>
    `;
  }

  const datasets = [
    { label: "Bol Revenue", data: bRev, backgroundColor: "#2563ebcc", borderRadius: 4 },
    { label: "Bol Profit", data: bProf, backgroundColor: "#16a34acc", borderRadius: 4 },
    { label: "Rebrain Revenue", data: rRev, backgroundColor: "#f59e0bcc", borderRadius: 4 },
    { label: "Rebrain Profit", data: rProf, backgroundColor: "#f59e0b44", borderRadius: 4 },
  ];

  const datalabels = {
    id: "dl-overview",
    afterDatasetsDraw(chart) {
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        meta.data.forEach((bar, idx) => {
          const val = ds.data[idx];
          if (!val) return;
          chart.ctx.save();
          chart.ctx.fillStyle = "#555";
          chart.ctx.font = "10px sans-serif";
          chart.ctx.textAlign = "center";
          const lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
          chart.ctx.fillText(lbl, bar.x, bar.y - 4);
          chart.ctx.restore();
        });
      });
    }
  };

  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    plugins: [datalabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 16 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatEUR(ctx.parsed.y)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0 } },
        y: { grid: { color: "#f1f3f5" }, ticks: { callback: v => "€ " + (v/1000).toFixed(1) + "K" } }
      }
    }
  });
}

function createBusinessChart(canvasId, chartData, businessName) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || !chartData) return;

  const ds = chartData.datasets.find(d => d.business === businessName);
  if (!ds) return;

  const colorIdx = chartData.datasets.indexOf(ds);
  const color = BUSINESS_COLORS[colorIdx % BUSINESS_COLORS.length];

  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: chartData.labels,
      datasets: [
        {
          label: "Omzet",
          data: ds.revenue,
          backgroundColor: color + "aa",
          borderRadius: 4
        },
        {
          label: "Winst",
          data: ds.profit,
          backgroundColor: color + "33",
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 16 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatEUR(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0 } },
        y: {
          grid: { color: "#f1f3f5" },
          ticks: { callback: v => "€ " + (v / 1000).toFixed(0) + "k" }
        }
      }
    }
  });
}
