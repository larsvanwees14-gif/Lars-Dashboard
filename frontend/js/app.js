// ============================================================
//  Lars Financial Dashboard — Main JavaScript
// ============================================================

let currentPeriod = "mtd";
let dashboardData = null;
let isLoading = false;
let overviewChartPeriod = "ytd";
let assetChartPeriod = "ytd";

const periodLabels = {
  mtd: "This month",
  prev: "Last month",
  ytd: "Year-to-date",
  yoy: "Last year (YoY)"
};

// ── Initialization ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupPeriodFilters();
  loadDashboard();
  // Auto-refresh every 5 minutes
  setInterval(() => loadDashboard(), 5 * 60 * 1000);
});

// ── Tab navigation ─────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + target).classList.add("active");

      if (dashboardData) {
        if (target === "overview") renderOverviewCharts(dashboardData);
        if (target === "bol") renderBolCharts(dashboardData);
        if (target === "businesses") renderBusinessCharts(dashboardData);
      }
    });
  });
}

// ── Period filter ─────────────────────────────────────────────
function setupPeriodFilters() {
  document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPeriod = btn.dataset.period;
      document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(`.period-btn[data-period="${currentPeriod}"]`)
        .forEach(b => b.classList.add("active"));
      loadDashboard();
    });
  });
}

// ── Data loading ────────────────────────────────────────────────
async function loadDashboard() {
  if (isLoading) return;
  isLoading = true;

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = "Loading..."; }

  showLoading();

  try {
    dashboardData = await fetchDashboard(currentPeriod);
    renderDashboard(dashboardData);
  } catch (e) {
    showError("Could not load dashboard. Is the server running? (" + e.message + ")");
  } finally {
    isLoading = false;
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = "↺ Refresh"; }
  }
}

function showLoading() {
  ["overview", "bol", "businesses", "investments", "entities"].forEach(tab => {
    const el = document.getElementById("tab-" + tab + "-content");
    if (el) el.innerHTML = `<div class="loading"><div class="spinner"></div><br>Loading...</div>`;
  });
}

function showError(msg) {
  const el = document.getElementById("tab-overview-content");
  if (el) el.innerHTML = `<div class="error-msg">⚠️ ${msg}</div>`;
}

// ── Render ────────────────────────────────────────────────────
function renderDashboard(data) {
  renderOverview(data);
  renderBol(data);
  renderBusinesses(data);
  renderInvestments(data);
  renderEntities(data);
  updateLastRefresh(data.last_refresh);
  setTimeout(() => {
    renderOverviewCharts(data);
    renderBolCharts(data);
    renderBusinessCharts(data);
  }, 50);
}

// ── Overview tab ─────────────────────────────────────────────
function renderOverview(data) {
  const nw = data.net_worth;
  const kpis = data.kpis;
  const changes = data.kpi_changes;

  const pnlSign = nw.monthly_pnl_eur >= 0 ? "+" : "";
  const pnlClass = nw.monthly_pnl_eur >= 0 ? "up" : "down";
  const changeSign = changes.change_pct >= 0 ? "+" : "";
  const changeClass = changes.direction === "up" ? "badge-up" : "badge-down";

  const html = `
    <div class="grid-4" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title">Total Assets</div>
        <div class="kpi-value">${eur(nw.total_eur)}</div>
        <div class="kpi-sub">
          <span class="source-badge">
            <span class="dot"></span>
            ${pnlSign}${eur(nw.monthly_pnl_eur)} this month
          </span>
        </div>
      </div>
    </div>

    <div class="business-card" style="margin-bottom:20px">
      <div class="business-header">
        <div><div class="business-name">Revenue & Profit — All Businesses</div></div>
        <div class="period-filter" id="overview-chart-period">
          ${(() => {
            if (customPeriodActive) return customPeriodBtnsHtml("overview");
            const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const isM = overviewChartPeriod.startsWith("m");
            const ms = '<select onchange="setOverviewChartPeriod(this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:'+(isM?'var(--primary)':'white')+';color:'+(isM?'white':'inherit')+';cursor:pointer"><option value="" '+(isM?'':'selected')+'>Month</option>'+mn.map((n,i)=>'<option value="m'+(i+1)+'" '+(overviewChartPeriod==='m'+(i+1)?'selected':'')+'>'+n+'</option>').join('')+'</select>';
            return ms + ["ytd","prev","yoy"].map(p =>
              '<button class="period-btn '+(p===overviewChartPeriod?'active':'')+'" onclick="setOverviewChartPeriod(\''+p+'\')" style="font-size:11px;padding:2px 8px">'+periodLabels[p]+'</button>'
            ).join("") + '<button class="period-btn" onclick="activateCustomPeriod()" style="font-size:11px;padding:2px 8px">Custom</button>';
          })()}
        </div>
      </div>
      <div id="overview-chart-kpis" class="business-metrics" style="margin-bottom:8px"></div>
      <div class="chart-wrap" style="height:250px">
        <canvas id="overview-chart"></canvas>
      </div>
    </div>

    ${(data.asset_history || []).length > 0 ? `
    <div class="business-card" style="margin-top:20px">
      <div class="business-header">
        <div><div class="business-name">Asset Portfolio</div></div>
        <div class="period-filter">
          ${(() => {
            const isM = assetChartPeriod.startsWith("m");
            const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const ms = '<select onchange="setAssetChartPeriod(this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:'+(isM?'var(--primary)':'white')+';color:'+(isM?'white':'inherit')+';cursor:pointer"><option value="" '+(isM?'':'selected')+'>Month</option>'+mn.map((n,i)=>'<option value="m'+(i+1)+'" '+(assetChartPeriod==='m'+(i+1)?'selected':'')+'>'+n+'</option>').join('')+'</select>';
            return ms + ["ytd","6m","3y"].map(p =>
              '<button class="period-btn '+(p===assetChartPeriod?'active':'')+'" onclick="setAssetChartPeriod(\''+p+'\')" style="font-size:11px;padding:2px 8px">'+({"ytd":"Year-to-date","6m":"6 months","3y":"3 years"}[p])+'</button>'
            ).join("");
          })()}
        </div>
      </div>
      <div class="chart-wrap" style="height:200px">
        <canvas id="overview-asset-chart"></canvas>
      </div>
    </div>` : ""}
  `;

  document.getElementById("tab-overview-content").innerHTML = html;
}

function setAssetChartPeriod(p) {
  assetChartPeriod = p;
  if (dashboardData) {
    renderOverview(dashboardData);
    setTimeout(() => renderOverviewCharts(dashboardData), 50);
  }
}

function setOverviewChartPeriod(p) {
  overviewChartPeriod = p;
  if (dashboardData) {
    renderOverview(dashboardData);
    setTimeout(() => renderOverviewCharts(dashboardData), 50);
  }
}

function renderOverviewCharts(data) {
  const overviewPeriod = customPeriodActive
    ? { from: customPeriodFrom, to: customPeriodTo }
    : overviewChartPeriod;
  createOverviewChartFiltered("overview-chart", data.chart_data, overviewPeriod);
  if ((data.asset_history || []).length > 0) {
    setTimeout(() => renderAssetHistoryChart("overview-asset-chart", data.asset_history), 50);
  }
}

// ── Bol Business tab ──────────────────────────────────────────────────

const bolCardPeriods = { landing: "ytd", ret_landing: "ytd", spa_landing: "ytd", revenue: "ytd", margins: "ytd", returns: "ytd", costs: "ytd", overhead: "ytd" };
const OVERHEAD_TARGETS = { normal: 1500, investment: 1500 }; // per maand

// ── Global custom period ───────────────────────────────────────────────────
let customPeriodActive = false;
let customPeriodFrom = { year: new Date().getFullYear(), month: 1 };
let customPeriodTo   = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

function setCustomPeriod(fromYear, fromMonth, toYear, toMonth) {
  customPeriodFrom = { year: parseInt(fromYear), month: parseInt(fromMonth) };
  customPeriodTo   = { year: parseInt(toYear),   month: parseInt(toMonth) };
  customPeriodActive = true;
  reRenderAllDashboards();
}

function activateCustomPeriod() {
  customPeriodActive = true;
  reRenderAllDashboards();
}

function deactivateCustomPeriod() {
  customPeriodActive = false;
  reRenderAllDashboards();
}

function reRenderAllDashboards() {
  if (!dashboardData) return;
  // Re-render Bol Business cards
  const cards = ["landing","ret_landing","spa_landing","revenue","margins","returns","costs","overhead"];
  cards.forEach(c => updateBolCard(c, dashboardData));
  // Re-render Total Overview
  if (typeof renderTotalLandingChart === "function") renderTotalLandingChart(dashboardData);
  // Re-render Shopify
  if (typeof renderShopifyKpis === "function") renderShopifyKpis();
  // Re-render Retailers
  if (typeof renderRetailers === "function") renderRetailers(dashboardData);
  // Re-render SP Agency
  if (typeof renderSpAgency === "function") renderSpAgency().catch(() => {});
  // Re-render Overview tab
  renderOverview(dashboardData);
  setTimeout(() => renderOverviewCharts(dashboardData), 50);
}

function customPeriodFilterMonths(months) {
  const fromKey = customPeriodFrom.year * 100 + customPeriodFrom.month;
  const toKey   = customPeriodTo.year * 100 + customPeriodTo.month;
  return months.filter(m => {
    const key = m.year * 100 + m.month;
    return key >= fromKey && key <= toKey;
  });
}

const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function customPeriodBtnsHtml(cardId) {
  const years = [];
  for (let y = 2024; y <= new Date().getFullYear() + 1; y++) years.push(y);
  const yOpts = years.map(y => `<option value="${y}">${y}</option>`).join("");
  const mOpts = MN.map((n,i) => `<option value="${i+1}">${n}</option>`).join("");

  function sel(id, opts, val) {
    return `<select id="${id}" onchange="setCustomPeriod(
      document.getElementById('cp-fy-${cardId}').value,
      document.getElementById('cp-fm-${cardId}').value,
      document.getElementById('cp-ty-${cardId}').value,
      document.getElementById('cp-tm-${cardId}').value
    )" style="font-size:11px;padding:2px 4px;border:1px solid var(--primary);border-radius:4px;cursor:pointer">${opts}</select>`;
  }

  return `
    <span style="font-size:11px;color:var(--text-muted)">Van</span>
    ${sel(`cp-fm-${cardId}`, MN.map((n,i)=>`<option value="${i+1}" ${customPeriodFrom.month===i+1?'selected':''}>${n}</option>`).join(""), customPeriodFrom.month)}
    ${sel(`cp-fy-${cardId}`, years.map(y=>`<option value="${y}" ${customPeriodFrom.year===y?'selected':''}>${y}</option>`).join(""), customPeriodFrom.year)}
    <span style="font-size:11px;color:var(--text-muted)">Tot</span>
    ${sel(`cp-tm-${cardId}`, MN.map((n,i)=>`<option value="${i+1}" ${customPeriodTo.month===i+1?'selected':''}>${n}</option>`).join(""), customPeriodTo.month)}
    ${sel(`cp-ty-${cardId}`, years.map(y=>`<option value="${y}" ${customPeriodTo.year===y?'selected':''}>${y}</option>`).join(""), customPeriodTo.year)}
    <button onclick="deactivateCustomPeriod()" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--card-bg);color:var(--text)">✕ Reset</button>
  `;
}

function toggleRetDropdown() {
  const dd = document.getElementById("ret-dropdown");
  const arrow = document.getElementById("ret-dropdown-arrow");
  if (dd.style.display === "none") {
    dd.style.display = "";
    arrow.style.transform = "rotate(180deg)";
    setTimeout(() => renderRetLandingChart(), 50);
  } else {
    dd.style.display = "none";
    arrow.style.transform = "";
  }
}

function renderRetLandingChart() {
  const ret = window._retData;
  const hears = window._hearsData;
  if (!ret) return;
  const period = bolCardPeriods["ret_landing"] || "ytd";
  const { allMonths: rMonths, filtered: rFiltered } = bolFilterMonths(ret, period);
  const { allMonths: hMonths, filtered: hFiltered } = hears && hears.months ? bolFilterMonths(hears, period) : { allMonths: [], filtered: [] };

  // Update KPIs
  const tRev = rFiltered.reduce((t,m) => t + m.revenue, 0) + hFiltered.reduce((t,m) => t + m.revenue, 0);
  const tFee = rFiltered.reduce((t,m) => t + (m.fee_lars||0), 0) + hFiltered.reduce((t,m) => t + (m.fee_lars||0), 0);
  const kpisEl = document.getElementById("ret-dropdown-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div><div style="font-size:11px;color:var(--text-muted)">Total Revenue</div><div style="font-size:16px;font-weight:600">${eur(tRev)}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted)">Total Profit Lars</div><div style="font-size:16px;font-weight:600;color:var(--green)">${eur(tFee)}</div></div>
    `;
  }

  // Chart
  const labels = rMonths.map(m => m.label.split(" ")[0]);
  const combinedRev = rMonths.map((m, i) => m.revenue + (hMonths[i]?.revenue || 0));
  const combinedFee = rMonths.map((m, i) => (m.fee_lars || 0) + (hMonths[i]?.fee_lars || 0));

  const canvas = document.getElementById("ret-chart-landing");
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();

  const datalabels = { id: "dl-retl", afterDatasetsDraw(chart) {
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val) return;
        chart.ctx.save(); chart.ctx.fillStyle = "#555"; chart.ctx.font = "10px sans-serif"; chart.ctx.textAlign = "center";
        const lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
        if (lbl) chart.ctx.fillText(lbl, bar.x, bar.y - 4);
        chart.ctx.restore();
      });
    });
  }};

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "bar", data: { labels, datasets: [
      { label: "Revenue", data: combinedRev, backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
      { label: "Profit Lars", data: combinedFee, backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
    ]}, plugins: [datalabels],
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v) } } } }
  });
}

function toggleSpaDropdown() {
  const dd = document.getElementById("spa-dropdown");
  const arrow = document.getElementById("spa-dropdown-arrow");
  if (dd.style.display === "none") {
    dd.style.display = "";
    arrow.style.transform = "rotate(180deg)";
    setTimeout(() => renderSpaLandingChart(), 50);
  } else {
    dd.style.display = "none";
    arrow.style.transform = "";
  }
}

async function renderSpaLandingChart() {
  const data = await getSpAgency();
  const allMonths = data.months || [];
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const period = bolCardPeriods["spa_landing"] || "ytd";

  // Filter
  let filtered;
  if (period.startsWith("m")) {
    const sel = parseInt(period.substring(1));
    filtered = allMonths.filter(m => m.year === curYear && m.month === sel);
  } else if (period === "prev") {
    const pm = curMonth === 1 ? 12 : curMonth - 1;
    const py = curMonth === 1 ? curYear - 1 : curYear;
    filtered = allMonths.filter(m => m.year === py && m.month === pm);
  } else if (period === "ytd") {
    filtered = allMonths.filter(m => m.year === curYear);
  } else if (period === "yoy") {
    filtered = allMonths.filter(m => m.year === curYear - 1);
  }
  if (!filtered || !filtered.length) filtered = allMonths;

  const totalProfit = filtered.reduce((t, m) => t + (m.profit || 0), 0);

  // KPIs
  const kpisEl = document.getElementById("spa-dropdown-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div><div style="font-size:11px;color:var(--text-muted)">Profit</div><div style="font-size:16px;font-weight:600;color:var(--green)">${eur(totalProfit)}</div></div>
    `;
  }

  // Chart months
  let chartMonths;
  if (period.startsWith("m") || period === "prev") {
    chartMonths = filtered.map(m => ({ profit: m.profit || 0, label: monthNames[(m.month||1)-1] }));
  } else {
    const year = period === "yoy" ? curYear - 1 : curYear;
    chartMonths = [];
    for (let m = 1; m <= 12; m++) {
      const found = allMonths.find(d => d.year === year && d.month === m);
      chartMonths.push({ profit: found ? found.profit : 0, label: monthNames[m-1] });
    }
  }

  const canvas = document.getElementById("spa-chart-landing");
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();

  const datalabels = { id: "dl-spal", afterDatasetsDraw(chart) {
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val) return;
        chart.ctx.save(); chart.ctx.fillStyle = "#555"; chart.ctx.font = "10px sans-serif"; chart.ctx.textAlign = "center";
        const lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
        if (lbl) chart.ctx.fillText(lbl, bar.x, bar.y - 4);
        chart.ctx.restore();
      });
    });
  }};

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels: chartMonths.map(m => m.label), datasets: [{ label: "Profit", data: chartMonths.map(m => m.profit), backgroundColor: "rgba(34,197,94,0.6)", borderRadius: 4 }] },
    plugins: [datalabels],
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v) } } } }
  });
}

async function renderTotalLandingChart() {
  const bol = window._bolData;
  const ret = window._retData;
  const hears = window._hearsData;
  if (!bol) return;

  // Fetch SP Agency data
  let spaMonths = [];
  try { const sd = await getSpAgency(); spaMonths = sd.months || []; } catch(e) {}

  // Fetch Shopify data
  let shopifyMonths = [];
  try { const sh = await fetch("/api/shopify").then(r => r.json()); shopifyMonths = sh.months || []; } catch(e) {}

  const period = bolCardPeriods["total_landing"] || "ytd";
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function getVal(arr, yr, mo, field) {
    if (!arr) return 0;
    const found = arr.find(m => m.year === yr && m.month === mo);
    return found ? (found[field] || 0) : 0;
  }

  // Build combined months — support custom period (multi-year) or single year
  const allCombined = [];
  if (customPeriodActive) {
    for (let y = customPeriodFrom.year; y <= customPeriodTo.year; y++) {
      const mStart = y === customPeriodFrom.year ? customPeriodFrom.month : 1;
      const mEnd   = y === customPeriodTo.year   ? customPeriodTo.month   : 12;
      for (let m = mStart; m <= mEnd; m++) {
        allCombined.push({
          month: m, year: y,
          label: monthNames[m-1] + (customPeriodFrom.year !== customPeriodTo.year ? ` '${String(y).slice(2)}` : ""),
          revenue: getVal(bol.months,y,m,"revenue") + getVal(ret?.months,y,m,"revenue") + getVal(hears?.months,y,m,"revenue") + getVal(spaMonths,y,m,"profit") + getVal(shopifyMonths,y,m,"revenue"),
          profit:  getVal(bol.months,y,m,"profit")  + getVal(ret?.months,y,m,"fee_lars") + getVal(hears?.months,y,m,"fee_lars") + getVal(spaMonths,y,m,"profit") + getVal(shopifyMonths,y,m,"profit")
        });
      }
    }
  } else {
    const year = period === "yoy" ? curYear - 1 : curYear;
    for (let m = 1; m <= 12; m++) {
      allCombined.push({
        month: m, year,
        label: monthNames[m-1],
        revenue: getVal(bol.months,year,m,"revenue") + getVal(ret?.months,year,m,"revenue") + getVal(hears?.months,year,m,"revenue") + getVal(spaMonths,year,m,"profit") + getVal(shopifyMonths,year,m,"revenue"),
        profit:  getVal(bol.months,year,m,"profit")  + getVal(ret?.months,year,m,"fee_lars") + getVal(hears?.months,year,m,"fee_lars") + getVal(spaMonths,year,m,"profit") + getVal(shopifyMonths,year,m,"profit")
      });
    }
  }

  // Filter by period (skipped when custom active — allCombined already filtered)
  let filtered;
  if (customPeriodActive) {
    filtered = allCombined.filter(m => m.revenue > 0 || m.profit > 0);
  } else if (period.startsWith("m")) {
    const sel = parseInt(period.substring(1));
    filtered = allCombined.filter(m => m.month === sel);
  } else if (period === "prev") {
    const pm = curMonth === 1 ? 12 : curMonth - 1;
    filtered = allCombined.filter(m => m.month === pm);
  } else if (period === "ytd") {
    filtered = allCombined.filter(m => m.month <= curMonth);
  } else {
    filtered = allCombined;
  }

  const tRev = filtered.reduce((t,m) => t + m.revenue, 0);
  const tProfit = filtered.reduce((t,m) => t + m.profit, 0);

  // KPIs
  const kpisEl = document.getElementById("total-overview-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div><div style="font-size:11px;color:var(--text-muted)">Total Revenue</div><div style="font-size:18px;font-weight:600">${eur(tRev)}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted)">Total Profit</div><div style="font-size:18px;font-weight:600;color:var(--green)">${eur(tProfit)}</div></div>
    `;
  }

  // Chart
  const chartMonths = (period.startsWith("m") || period === "prev") ? filtered : allCombined;
  const canvas = document.getElementById("bol-chart-total");
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();

  const datalabels = { id: "dl-total", afterDatasetsDraw(chart) {
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val) return;
        chart.ctx.save(); chart.ctx.fillStyle = "#555"; chart.ctx.font = "10px sans-serif"; chart.ctx.textAlign = "center";
        const lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
        if (lbl) chart.ctx.fillText(lbl, bar.x, bar.y - 4);
        chart.ctx.restore();
      });
    });
  }};

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels: chartMonths.map(m => m.label), datasets: [
      { label: "Revenue", data: chartMonths.map(m => m.revenue), backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
      { label: "Profit", data: chartMonths.map(m => m.profit), backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
    ]},
    plugins: [datalabels],
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v) } } } }
  });
}

function toggleOpalDropdown() {
  const dd = document.getElementById("opal-dropdown");
  const arrow = document.getElementById("opal-dropdown-arrow");
  if (dd.style.display === "none") {
    dd.style.display = "";
    arrow.style.transform = "rotate(180deg)";
    // Render chart after showing
    setTimeout(() => renderBolCardChart("landing"), 50);
  } else {
    dd.style.display = "none";
    arrow.style.transform = "";
  }
}

function switchBolView(view) {
  document.getElementById("bol-view-landing").style.display = view === "landing" ? "" : "none";
  document.getElementById("bol-view-opalgoods").style.display = view === "opalgoods" ? "" : "none";
  document.getElementById("bol-view-retailers").style.display = view === "retailers" ? "" : "none";
  document.getElementById("bol-view-spagency").style.display = view === "spagency" ? "" : "none";
  // Re-render charts when entering OpalGoods
  if (view === "opalgoods" && window._bolData) {
    setTimeout(() => ["landing","revenue","margins","returns","costs"].forEach(c => renderBolCardChart(c)), 50);
  }
}

function setBolCardPeriod(card, p) {
  if (!p) p = "ytd"; // Reset to YTD if empty (month dropdown cleared)
  bolCardPeriods[card] = p;
  document.querySelectorAll(`.bol-pb-${card}`).forEach(b => b.classList.toggle("active", b.dataset.period === p));
  if (dashboardData) updateBolCard(card, dashboardData);
}

function bolFilterMonths(bol, period) {
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Global custom period overrides all card periods
  if (customPeriodActive) {
    const filtered = customPeriodFilterMonths(bol.months.filter(m => m.revenue > 0));
    const fromKey = customPeriodFrom.year * 100 + customPeriodFrom.month;
    const toKey   = customPeriodTo.year * 100 + customPeriodTo.month;
    const allMonths = [];
    for (let y = customPeriodFrom.year; y <= customPeriodTo.year; y++) {
      const mStart = y === customPeriodFrom.year ? customPeriodFrom.month : 1;
      const mEnd   = y === customPeriodTo.year   ? customPeriodTo.month   : 12;
      for (let m = mStart; m <= mEnd; m++) {
        const found = bol.months.find(d => d.year === y && d.month === m);
        const empty = { revenue:0, profit:0, expenses:0, gross_margin:0, gross_margin_pct:0, nett_margin_product:0, nett_margin_product_pct:0, profit_pct:0, returns:0, return_pct:0, non_saleable_costs:0, storage_cost:0, recovery_clients:0 };
        allMonths.push(found || { ...empty, year: y, month: m, label: monthNames[m-1] + " " + y });
      }
    }
    return { allMonths, filtered: filtered.length ? filtered : allMonths };
  }
  const empty = { revenue:0, profit:0, expenses:0, gross_margin:0, gross_margin_pct:0, nett_margin_product:0, nett_margin_product_pct:0, profit_pct:0, returns:0, return_pct:0, non_saleable_costs:0, storage_cost:0, recovery_clients:0 };

  // Specific month selected (e.g. "m1" = January, "m2" = February)
  if (period.startsWith("m")) {
    const selMonth = parseInt(period.substring(1));
    const found = bol.months.find(d => d.year === curYear && d.month === selMonth);
    const month = found || { ...empty, year: curYear, month: selMonth, label: monthNames[selMonth-1] + " " + curYear };
    return { allMonths: [month], filtered: found ? [found] : [] };
  }

  let year = curYear;
  if (period === "yoy") year = curYear - 1;

  const allMonths = [];
  for (let m = 1; m <= 12; m++) {
    const found = bol.months.find(d => d.year === year && d.month === m);
    allMonths.push(found || { ...empty, year, month: m, label: monthNames[m-1] + " " + year });
  }

  const active = bol.months.filter(m => m.revenue > 0);
  let filtered;
  if (period === "prev") {
    const pm = curMonth === 1 ? 12 : curMonth - 1;
    const py = curMonth === 1 ? curYear - 1 : curYear;
    filtered = active.filter(m => m.year === py && m.month === pm);
    if (!filtered.length) filtered = active.length >= 2 ? [active[active.length - 2]] : active.slice(-1);
    // Zoom in: only show this single month in chart
    return { allMonths: filtered, filtered };
  } else if (period === "ytd") {
    filtered = active.filter(m => m.year === curYear);
  } else if (period === "yoy") {
    filtered = active.filter(m => m.year === curYear - 1);
  }
  if (!filtered || !filtered.length) filtered = active;

  return { allMonths, filtered };
}

function renderBol(data) {
  try { _renderBolInner(data); } catch(e) {
    console.error("renderBol error:", e);
    document.getElementById("bol-view-landing").innerHTML = `<div class="error-msg">Bol Business error: ${e.message}</div>`;
  }
}

function _renderBolInner(data) {
  const bol = data.bol_detail;
  if (!bol || !bol.months || bol.months.length === 0) {
    document.getElementById("tab-bol-content").innerHTML =
      `<div class="not-configured">Bol Business data not available. Check your Google Sheets connection.</div>`;
    return;
  }

  window._bolData = bol;
  window._bolLastRefresh = data.last_refresh;
  window._retData = data.retailers_detail || window._retData;
  window._hearsData = data.hears_detail || window._hearsData;
  window._fullDashData = data;

  function cardPeriodBtns(cardId) {
    if (customPeriodActive) {
      return customPeriodBtnsHtml(cardId);
    }
    const cp = bolCardPeriods[cardId] || "ytd";
    const isMonth = cp.startsWith("m");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const btns = ["ytd","prev","yoy"].map(p =>
      `<button class="period-btn bol-pb-${cardId} ${p === cp ? 'active' : ''}" data-period="${p}" onclick="setBolCardPeriod('${cardId}','${p}')" style="font-size:11px;padding:2px 8px">${periodLabels[p]}</button>`
    ).join("");
    const monthSelect = `<select onchange="setBolCardPeriod('${cardId}', this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:${isMonth?'var(--primary)':'white'};color:${isMonth?'white':'inherit'};cursor:pointer">
      <option value="" ${!isMonth?'selected':''}>Month</option>
      ${months.map((n,i) => `<option value="m${i+1}" ${cp==='m'+(i+1)?'selected':''}>${n}</option>`).join("")}
    </select>`;
    const customBtn = `<button class="period-btn" onclick="activateCustomPeriod()" style="font-size:11px;padding:2px 8px">Custom</button>`;
    return monthSelect + btns + customBtn;
  }

  // Total overview (above sub-tabs)
  const allActive = bol.months.filter(m => m.revenue > 0);
  const totalRev = allActive.reduce((t,m) => t + m.revenue, 0);
  const totalProfit = allActive.reduce((t,m) => t + m.profit, 0);
  const totalExp = totalRev - totalProfit;
  const totalMargin = totalRev > 0 ? (totalProfit / totalRev * 100) : 0;

  // Landing page — overview + chart + navigation
  const landingPeriod = bolCardPeriods["landing"] || "ytd";
  const { allMonths: landingChartMonths, filtered: landingFiltered } = bolFilterMonths(bol, landingPeriod);
  const lRev = landingFiltered.reduce((t,m) => t + m.revenue, 0);
  const lProfit = landingFiltered.reduce((t,m) => t + m.profit, 0);
  const lExp = lRev - lProfit;
  const lMargin = lRev > 0 ? (lProfit / lRev * 100) : 0;

  const isLandingMonth = landingPeriod.startsWith("m");
  const landingMonthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const landingMonthSelect = `<select onchange="setBolCardPeriod('landing', this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:${isLandingMonth?'var(--primary)':'white'};color:${isLandingMonth?'white':'inherit'};cursor:pointer">
    <option value="" ${!isLandingMonth?'selected':''}>Month</option>
    ${landingMonthNames.map((n,i) => `<option value="m${i+1}" ${landingPeriod==='m'+(i+1)?'selected':''}>${n}</option>`).join("")}
  </select>`;
  const landingPeriodBtns = customPeriodActive
    ? customPeriodBtnsHtml("landing")
    : landingMonthSelect + ["ytd","prev","yoy"].map(p =>
        `<button class="period-btn bol-pb-landing ${p === landingPeriod ? 'active' : ''}" data-period="${p}" onclick="setBolCardPeriod('landing','${p}')" style="font-size:11px;padding:2px 8px">${periodLabels[p]}</button>`
      ).join("") + `<button class="period-btn" onclick="activateCustomPeriod()" style="font-size:11px;padding:2px 8px">Custom</button>`;

  // ── Total Overview: combine all business units ──
  const totalPeriodBtns = cardPeriodBtns("total_landing");

  document.getElementById("bol-landing-content").innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:15px;font-weight:600">Bol Business — Total Overview 2026</span>
          <div class="info-icon" data-tooltip="Gecombineerd overzicht van alle business units:\n• OpalGoods — Bol.com omzet + Shopify\n• Retailers (D&R + Hears) — volledige omzet van het merk + alleen Profit Lars\n• SP Agency — maandelijkse fee\n\nProfit = wat Lars netto verdient over alle businesses.">ℹ</div>
        </div>
        <div class="period-filter">${totalPeriodBtns}</div>
      </div>
      <div style="padding:0 20px;display:flex;gap:24px;flex-wrap:wrap" id="total-overview-kpis"></div>
      <div style="padding:16px 20px">
        <div class="chart-wrap" style="height:220px"><canvas id="bol-chart-total"></canvas></div>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <!-- OpalGoods: click logo/name to go to page, click arrow to toggle dropdown -->
      <div style="padding:16px 20px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--border)">
        <div style="cursor:pointer;display:flex;align-items:center;gap:12px;flex:1" onclick="switchBolView('opalgoods')">
          <img src="img/Opalgoods Logo.png" style="height:45px">
          <div>
            <div style="font-size:15px;font-weight:600">OpalGoods</div>
            <div style="font-size:12px;color:var(--text-muted)">Revenue, margins, returns & costs</div>
          </div>
        </div>
        <div style="cursor:pointer;color:var(--text-muted);font-size:18px;padding:8px 4px;transition:transform 0.2s" id="opal-dropdown-arrow" onclick="toggleOpalDropdown()">▼</div>
      </div>

      <!-- OpalGoods dropdown: KPIs + chart -->
      <div id="opal-dropdown" style="display:none;border-bottom:1px solid var(--border)">
        <div style="padding:10px 20px;border-bottom:1px solid var(--border)"><div class="period-filter">${landingPeriodBtns}</div></div>
        <div style="padding:16px 20px;display:flex;gap:24px;flex-wrap:wrap;border-bottom:1px solid var(--border)">
          <div><div style="font-size:11px;color:var(--text-muted)">Revenue</div><div style="font-size:16px;font-weight:600">${eur(lRev)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Expenses</div><div style="font-size:16px;font-weight:600">${eur(lExp)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Profit</div><div style="font-size:16px;font-weight:600;color:var(--green)">${eur(lProfit)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Margin</div><div style="font-size:16px;font-weight:600">${lMargin.toFixed(1)}%</div></div>
        </div>
        <div style="padding:16px 20px">
          <div class="chart-wrap" style="height:200px"><canvas id="bol-chart-landing"></canvas></div>
        </div>
      </div>

    </div>

    <div class="card" style="padding:0;overflow:hidden;margin-top:16px">
      <!-- Retailers: click logos/name to go to page, click arrow to toggle dropdown -->
      <div style="padding:16px 20px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--border)">
        <div style="cursor:pointer;display:flex;align-items:center;gap:12px;flex:1" onclick="switchBolView('retailers')">
          <div style="display:flex;gap:6px;align-items:center"><img src="img/Logo Dore and Rose.jpg" style="height:45px;border-radius:4px"><img src="img/Logo Hears.jpg" style="height:45px;border-radius:4px"></div>
          <div>
            <div style="font-size:15px;font-weight:600">Retailers</div>
            <div style="font-size:12px;color:var(--text-muted)">Revenue, margins & fee</div>
          </div>
        </div>
        <div style="cursor:pointer;color:var(--text-muted);font-size:18px;padding:8px 4px;transition:transform 0.2s" id="ret-dropdown-arrow" onclick="toggleRetDropdown()">▼</div>
      </div>

      <!-- Retailers dropdown -->
      <div id="ret-dropdown" style="display:none;border-bottom:1px solid var(--border)">
        <div style="padding:10px 20px;border-bottom:1px solid var(--border)"><div class="period-filter">${landingPeriodBtns.replace(/landing/g, 'ret_landing')}</div></div>
        <div style="padding:16px 20px;display:flex;gap:24px;flex-wrap:wrap;border-bottom:1px solid var(--border)" id="ret-dropdown-kpis"></div>
        <div style="padding:16px 20px">
          <div class="chart-wrap" style="height:200px"><canvas id="ret-chart-landing"></canvas></div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden;margin-top:16px">
      <!-- SP Agency: click name to go to page, click arrow to toggle dropdown -->
      <div style="padding:16px 20px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--border)">
        <div style="cursor:pointer;display:flex;align-items:center;gap:12px;flex:1" onclick="switchBolView('spagency')">
          <div style="font-size:28px">🤝</div>
          <div>
            <div style="font-size:15px;font-weight:600">SP Agency</div>
            <div style="font-size:12px;color:var(--text-muted)">Monthly profit overview</div>
          </div>
        </div>
        <div style="cursor:pointer;color:var(--text-muted);font-size:18px;padding:8px 4px;transition:transform 0.2s" id="spa-dropdown-arrow" onclick="toggleSpaDropdown()">▼</div>
      </div>

      <!-- SP Agency dropdown -->
      <div id="spa-dropdown" style="display:none;border-bottom:1px solid var(--border)">
        <div style="padding:10px 20px;border-bottom:1px solid var(--border)"><div class="period-filter">${landingPeriodBtns.replace(/landing/g, 'spa_landing')}</div></div>
        <div style="padding:16px 20px;display:flex;gap:24px;flex-wrap:wrap;border-bottom:1px solid var(--border)" id="spa-dropdown-kpis"></div>
        <div style="padding:16px 20px">
          <div class="chart-wrap" style="height:200px"><canvas id="spa-chart-landing"></canvas></div>
        </div>
      </div>
    </div>
  `;

  // OpalGoods content
  const html = `
    <button onclick="switchBolView('landing')" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back to Bol Business</button>
    <div id="bol-card-revenue" style="margin-bottom:20px">${renderBolCardHtml("revenue", bol, data.last_refresh, cardPeriodBtns("revenue"))}</div>
    <div id="bol-card-margins" style="margin-bottom:20px">${renderBolCardHtml("margins", bol, data.last_refresh, cardPeriodBtns("margins"))}</div>
    <div id="bol-card-returns" style="margin-bottom:20px">${renderBolCardHtml("returns", bol, data.last_refresh, cardPeriodBtns("returns"))}</div>
    <div id="bol-card-costs" style="margin-bottom:20px">${renderBolCardHtml("costs", bol, data.last_refresh, cardPeriodBtns("costs"))}</div>
    <div id="bol-card-overhead" style="margin-bottom:20px"></div>
    <div id="shopify-section" style="margin-bottom:20px"></div>
  `;

  document.getElementById("tab-bol-content").innerHTML = html;

  // Load Shopify data async
  loadShopifySection();

  // Retailers view
  renderRetailers(data);

  // SP Agency view (async, don't block)
  renderSpAgency().catch(e => {
    document.getElementById("bol-spagency-content").innerHTML = `
      <button onclick="switchBolView('landing')" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back to Bol Business</button>
      <div class="error-msg">SP Agency error: ${e.message}</div>`;
  });

  // Reset to landing view
  switchBolView("landing");

  setTimeout(() => {
    ["landing","revenue","margins","returns","costs"].forEach(c => renderBolCardChart(c));
    renderTotalLandingChart();
    renderOverheadSection(bol, cardPeriodBtns("overhead"));
  }, 50);
}

function renderBolCardHtml(cardId, bol, lastRefresh, periodBtnsHtml) {
  const period = bolCardPeriods[cardId] || "ytd";
  const { filtered } = bolFilterMonths(bol, period);

  function sum(key) { return filtered.reduce((t, m) => t + (key === "profit" ? (m.profit||0) : (m[key]||0)), 0); }
  function avg(key) { return filtered.length ? filtered.reduce((t,m) => t + (m[key]||0), 0) / filtered.length : 0; }

  const totRev = sum("revenue");
  const totProfit = sum("profit");
  const profitColor = totProfit >= 0 ? "var(--green)" : "var(--red)";

  let title, kpiHtml;
  if (cardId === "revenue") {
    title = "Bol Business Business";
    const totExp = totRev - totProfit;
    const margin = totRev > 0 ? (totProfit / totRev * 100) : 0;
    kpiHtml = `
      <div><div class="metric-label">Revenue</div><div class="metric-value">${eur(totRev)}</div></div>
      <div><div class="metric-label">Expenses</div><div class="metric-value">${eur(totExp)}</div></div>
      <div><div class="metric-label">Profit</div><div class="metric-value" style="color:${profitColor}">${eur(totProfit)}</div></div>
      <div><div class="metric-label">Margin</div><div class="metric-value">${margin.toFixed(1)}%</div></div>`;
  } else if (cardId === "margins") {
    title = "Margins";
    kpiHtml = `
      <div><div class="metric-label">Gross Margin</div><div class="metric-value">${eur(sum("gross_margin"))} (${avg("gross_margin_pct").toFixed(1)}%)</div></div>
      <div><div class="metric-label">Nett Product Margin</div><div class="metric-value">${eur(sum("nett_margin_product"))} (${avg("nett_margin_product_pct").toFixed(1)}%)</div></div>
      <div><div class="metric-label">Nett Business Margin</div><div class="metric-value" style="color:${profitColor}">${eur(totProfit)} (${avg("profit_pct").toFixed(1)}%)</div></div>`;
  } else if (cardId === "returns") {
    title = "Returns";
    kpiHtml = `
      <div><div class="metric-label">Returns</div><div class="metric-value">${Math.round(sum("returns"))}</div></div>
      <div><div class="metric-label">Avg Return %</div><div class="metric-value">${avg("return_pct").toFixed(1)}%</div></div>`;
  } else {
    title = "Costs";
    kpiHtml = `
      <div><div class="metric-label">Non-saleable Costs</div><div class="metric-value">${eur(sum("non_saleable_costs"))}</div><div style="width:40px;height:6px;border-radius:3px;background:rgba(239,68,68,0.6);margin-top:4px"></div></div>
      <div><div class="metric-label">Storage Cost</div><div class="metric-value">${eur(sum("storage_cost"))}</div><div style="width:40px;height:6px;border-radius:3px;background:rgba(249,115,22,0.5);margin-top:4px"></div></div>
      <div><div class="metric-label">Recovery Clients</div><div class="metric-value">${eur(sum("recovery_clients"))}</div><div style="width:40px;height:6px;border-radius:3px;background:rgba(34,197,94,0.5);margin-top:4px"></div></div>`;
  }

  const extraChart = cardId === "margins"
    ? `<div style="margin-top:12px;font-size:12px;font-weight:600;color:var(--text-muted)">Margin % of Revenue</div>
       <div class="chart-wrap" style="height:200px;margin-top:8px"><canvas id="bol-chart-margins-pct"></canvas></div>`
    : "";

  return `<div class="business-card">
    <div class="business-header">
      <div style="display:flex;align-items:center;gap:10px"><img src="img/Opalgoods Logo.png" style="height:32px"><div class="business-name">${title}${cardId === "revenue" ? ' <span style="font-size:12px;font-weight:400;color:var(--text-muted)">(without Shopify)</span>' : ''}</div>${cardId === "revenue" ? `<div class="info-icon" data-tooltip="Dit overzicht gaat puur over OpalGoods via Bol.com.\n\nShopify omzet en winst zijn hier niet in meegenomen — die staan apart in de Shopify sectie hieronder.\n\nBron: OpalGoods Google Sheet (maandtabs).">ℹ</div>` : ''}</div>
      <div class="period-filter">${periodBtnsHtml}</div>
    </div>
    <div class="business-metrics">${kpiHtml}</div>
    <div class="chart-wrap" style="height:220px;margin-top:16px"><canvas id="bol-chart-${cardId}"></canvas></div>
    ${extraChart}
    <div class="source-badge" style="margin-top:8px"><span class="dot"></span>Google Sheets · ${formatDate(lastRefresh)}</div>
  </div>`;
}

function updateBolCard(cardId, data) {
  // Landing card: re-render the whole landing page since KPIs + chart change
  if (cardId === "landing" && dashboardData) {
    renderBol(dashboardData);
    return;
  }
  // Retailers landing dropdown
  if (cardId === "ret_landing") {
    renderRetLandingChart();
    return;
  }
  // SP Agency landing dropdown
  if (cardId === "spa_landing") {
    renderSpaLandingChart();
    return;
  }
  // Total overview chart
  if (cardId === "total_landing") {
    renderTotalLandingChart();
    return;
  }
  // Overhead section
  if (cardId === "overhead") {
    const bol = window._bolData || data.bol_detail;
    const cp = bolCardPeriods["overhead"] || "ytd";
    const isMonth = cp.startsWith("m");
    const mns = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const ms = `<select onchange="setBolCardPeriod('overhead', this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:${isMonth?'var(--primary)':'white'};color:${isMonth?'white':'inherit'};cursor:pointer"><option value="" ${!isMonth?'selected':''}>Month</option>${mns.map((n,i)=>`<option value="m${i+1}" ${cp==='m'+(i+1)?'selected':''}>${n}</option>`).join('')}</select>`;
    const btns = ms + ["ytd","prev","yoy"].map(p=>`<button class="period-btn bol-pb-overhead ${p===cp?'active':''}" data-period="${p}" onclick="setBolCardPeriod('overhead','${p}')" style="font-size:11px;padding:2px 8px">${periodLabels[p]}</button>`).join("");
    renderOverheadSection(bol, btns);
    return;
  }
  const bol = window._bolData || data.bol_detail;
  const lastRefresh = window._bolLastRefresh || data.last_refresh;
  const cp = bolCardPeriods[cardId] || "ytd";
  const isMonth = cp.startsWith("m");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthSelect = `<select onchange="setBolCardPeriod('${cardId}', this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:${isMonth?'var(--primary)':'white'};color:${isMonth?'white':'inherit'};cursor:pointer">
    <option value="" ${!isMonth?'selected':''}>Month</option>
    ${months.map((n,i) => `<option value="m${i+1}" ${cp==='m'+(i+1)?'selected':''}>${n}</option>`).join("")}
  </select>`;
  const periodBtnsHtml = monthSelect + ["ytd","prev","yoy"].map(p =>
    `<button class="period-btn bol-pb-${cardId} ${p === cp ? 'active' : ''}" data-period="${p}" onclick="setBolCardPeriod('${cardId}','${p}')" style="font-size:11px;padding:2px 8px">${periodLabels[p]}</button>`
  ).join("");

  const container = document.getElementById(`bol-card-${cardId}`);
  if (container) {
    container.innerHTML = renderBolCardHtml(cardId, bol, lastRefresh, periodBtnsHtml);
    setTimeout(() => renderBolCardChart(cardId), 30);
  }
}

// ── SP Agency view ───────────────────────────────────────────

let spaPeriod = "ytd";

function setSpaPeriod(p) {
  if (!p) p = "ytd";
  spaPeriod = p;
  renderSpAgency();
}

async function renderSpAgency() {
  const data = await getSpAgency();
  const allMonths = data.months || [];
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;

  // Filter based on period
  let filtered;
  if (customPeriodActive) {
    filtered = customPeriodFilterMonths(allMonths);
  } else if (spaPeriod.startsWith("m")) {
    const selMonth = parseInt(spaPeriod.substring(1));
    filtered = allMonths.filter(m => m.year === curYear && m.month === selMonth);
  } else if (spaPeriod === "prev") {
    const pm = curMonth === 1 ? 12 : curMonth - 1;
    const py = curMonth === 1 ? curYear - 1 : curYear;
    filtered = allMonths.filter(m => m.year === py && m.month === pm);
  } else if (spaPeriod === "ytd") {
    filtered = allMonths.filter(m => m.year === curYear);
  } else if (spaPeriod === "yoy") {
    filtered = allMonths.filter(m => m.year === curYear - 1);
  }
  if (!filtered || !filtered.length) filtered = allMonths;

  const totalProfit = filtered.reduce((t, m) => t + (m.profit || 0), 0);

  // Chart: full year or single month (custom period shows all filtered months directly)
  let chartMonths;
  if (customPeriodActive) {
    chartMonths = filtered.map(m => ({ month: m.month, year: m.year, profit: m.profit || 0, label: monthNames[(m.month||1)-1] + " '" + String(m.year).slice(2) }));
  } else if (spaPeriod.startsWith("m") || spaPeriod === "prev") {
    chartMonths = filtered.map(m => ({ month: m.month, profit: m.profit || 0, label: monthNames[(m.month||1)-1] }));
  } else {
    const year = spaPeriod === "yoy" ? curYear - 1 : curYear;
    chartMonths = [];
    for (let m = 1; m <= 12; m++) {
      const found = allMonths.find(d => d.year === year && d.month === m);
      chartMonths.push({ month: m, profit: found ? found.profit : 0, label: monthNames[m-1] });
    }
  }

  const tableRows = filtered.map(m =>
    `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px;font-weight:500">${monthNames[(m.month||1)-1]} ${m.year||curYear}</td>
      <td style="padding:8px;text-align:right;color:var(--green);font-weight:600">${eur(m.profit)}</td>
    </tr>`
  ).join("");

  // Period buttons
  const isMonth = spaPeriod.startsWith("m");
  const monthSelect = `<select onchange="setSpaPeriod(this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:${isMonth?'var(--primary)':'white'};color:${isMonth?'white':'inherit'};cursor:pointer">
    <option value="" ${!isMonth?'selected':''}>Month</option>
    ${monthNames.map((n,i) => `<option value="m${i+1}" ${spaPeriod==='m'+(i+1)?'selected':''}>${n}</option>`).join("")}
  </select>`;
  const periodBtns = customPeriodActive
    ? customPeriodBtnsHtml("spa")
    : monthSelect + ["ytd","prev","yoy"].map(p =>
        `<button class="period-btn ${p === spaPeriod ? 'active' : ''}" data-period="${p}" onclick="setSpaPeriod('${p}')" style="font-size:11px;padding:2px 8px">${periodLabels[p]}</button>`
      ).join("") + `<button class="period-btn" onclick="activateCustomPeriod()" style="font-size:11px;padding:2px 8px">Custom</button>`;

  document.getElementById("bol-spagency-content").innerHTML = `
    <button onclick="switchBolView('landing')" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back to Bol Business</button>

    <div class="business-card" style="margin-bottom:20px">
      <div class="business-header">
        <div><div class="business-name">SP Agency</div></div>
        <div class="period-filter">${periodBtns}</div>
      </div>
      <div class="business-metrics">
        <div><div class="metric-label">Profit</div><div class="metric-value" style="color:var(--green)">${eur(totalProfit)}</div></div>
      </div>
      <div class="chart-wrap" style="height:200px;margin-top:16px"><canvas id="spa-chart"></canvas></div>
    </div>

    <div class="business-card">
      <div class="business-header">
        <div><div class="business-name">Edit Profit</div></div>
      </div>
      <div id="spa-edit-rows" style="margin-top:12px">
        ${allMonths.map((m, i) => `
          <div class="flex gap-2" style="margin-bottom:8px;align-items:center">
            <span style="width:80px;font-size:13px;font-weight:500">${monthNames[(m.month||1)-1]} ${m.year||curYear}</span>
            <input class="form-input" type="number" value="${m.profit||0}" id="spa-profit-${i}" style="width:120px">
          </div>
        `).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="addSpAgencyMonth()" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer">+ Add month</button>
        <button class="btn-primary" onclick="saveSpAgencyForm()" style="margin-left:auto;font-size:13px;padding:6px 16px">Save</button>
      </div>
    </div>
  `;

  // Render chart
  setTimeout(() => {
    const canvas = document.getElementById("spa-chart");
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    const datalabels = { id: "dl-spa", afterDatasetsDraw(chart) {
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        meta.data.forEach((bar, idx) => {
          const val = ds.data[idx];
          if (!val) return;
          chart.ctx.save(); chart.ctx.fillStyle = "#555"; chart.ctx.font = "10px sans-serif"; chart.ctx.textAlign = "center";
          const lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
          if (lbl) chart.ctx.fillText(lbl, bar.x, bar.y - 4);
          chart.ctx.restore();
        });
      });
    }};
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: chartMonths.map(m => m.label),
        datasets: [{ label: "Profit", data: chartMonths.map(m => m.profit), backgroundColor: "rgba(34,197,94,0.6)", borderRadius: 4 }]
      },
      plugins: [datalabels],
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v) } } }
      }
    });
  }, 50);
}

window._spaMonths = [];

async function addSpAgencyMonth() {
  const data = await getSpAgency();
  const months = data.months || [];
  const lastMonth = months.length ? months[months.length - 1] : { month: 0, year: 2026 };
  let newMonth = (lastMonth.month || 0) + 1;
  let newYear = lastMonth.year || 2026;
  if (newMonth > 12) { newMonth = 1; newYear++; }
  months.push({ month: newMonth, year: newYear, profit: 0 });
  await saveSpAgency(months);
  renderSpAgency();
}

async function saveSpAgencyForm() {
  const data = await getSpAgency();
  const months = data.months || [];
  for (let i = 0; i < months.length; i++) {
    const input = document.getElementById(`spa-profit-${i}`);
    if (input) months[i].profit = parseFloat(input.value) || 0;
  }
  await saveSpAgency(months);
  renderSpAgency();
}

// ── Retailers view ───────────────────────────────────────────
const retailersCardPeriods = { ret_total: "ytd", ret_revenue: "ytd", hears_revenue: "ytd" };

function setRetailersCardPeriod(card, p) {
  if (!p) p = "ytd";
  retailersCardPeriods[card] = p;
  if (dashboardData) renderRetailers(dashboardData);
}

function renderRetailers(data) {
  const ret = data.retailers_detail;
  if (!ret || !ret.months || ret.months.length === 0) {
    document.getElementById("bol-retailers-content").innerHTML = `
      <button onclick="switchBolView('landing')" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back to Bol Business</button>
      <div class="not-configured" style="padding:40px;text-align:center;color:var(--text-muted)">Retailers — no data available</div>
    `;
    return;
  }

  window._retData = ret;

  function retCardPeriodBtns(cardId) {
    if (customPeriodActive) return customPeriodBtnsHtml(cardId);
    const cp = retailersCardPeriods[cardId] || "ytd";
    const isMonth = cp.startsWith("m");
    const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthSelect = `<select onchange="setRetailersCardPeriod('${cardId}', this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:${isMonth?'var(--primary)':'white'};color:${isMonth?'white':'inherit'};cursor:pointer">
      <option value="" ${!isMonth?'selected':''}>Month</option>
      ${mNames.map((n,i) => `<option value="m${i+1}" ${cp==='m'+(i+1)?'selected':''}>${n}</option>`).join("")}
    </select>`;
    const customBtn = `<button class="period-btn" onclick="activateCustomPeriod()" style="font-size:11px;padding:2px 8px">Custom</button>`;
    return monthSelect + ["ytd","prev","yoy"].map(p =>
      `<button class="period-btn ${p === cp ? 'active' : ''}" data-period="${p}" onclick="setRetailersCardPeriod('${cardId}','${p}')" style="font-size:11px;padding:2px 8px">${periodLabels[p]}</button>`
    ).join("") + customBtn;
  }

  function retFilterMonths(period) {
    return bolFilterMonths(ret, period);
  }

  function retCard(cardId, title, kpis, chartId) {
    const kpiHtml = kpis.map(k => `<div><div class="metric-label">${k.label}</div><div class="metric-value" ${k.color ? 'style="color:'+k.color+'"' : ''}>${k.value}</div></div>`).join("");
    return `<div class="business-card" style="margin-bottom:20px">
      <div class="business-header"><div><div class="business-name">${title}</div></div><div class="period-filter">${retCardPeriodBtns(cardId)}</div></div>
      <div class="business-metrics">${kpiHtml}</div>
      <div class="chart-wrap" style="height:220px;margin-top:16px"><canvas id="${chartId}"></canvas></div>
      <div class="source-badge" style="margin-top:8px"><span class="dot"></span>Google Sheets · ${formatDate(data.last_refresh)}</div>
    </div>`;
  }

  // All KPIs use same period
  const { filtered: fAll } = retFilterMonths(retailersCardPeriods.ret_revenue);
  const sumRev = fAll.reduce((t,m) => t + m.revenue, 0);
  const sumProfit = fAll.reduce((t,m) => t + m.profit, 0);
  const margin = sumRev > 0 ? (sumProfit / sumRev * 100) : 0;
  const sumFee = fAll.reduce((t,m) => t + (m.fee_lars||0), 0);

  const profitColor = sumProfit >= 0 ? "var(--green)" : "var(--red)";

  // Combined total card
  const hearsData = data.hears_detail;
  const tPeriod = retailersCardPeriods.ret_total || "ytd";
  const { filtered: tRetF } = retFilterMonths(tPeriod);
  const { filtered: tHearsF } = hearsData && hearsData.months ? bolFilterMonths(hearsData, tPeriod) : { filtered: [] };
  const tRev = tRetF.reduce((t,m) => t + m.revenue, 0) + tHearsF.reduce((t,m) => t + m.revenue, 0);
  const tFee = tRetF.reduce((t,m) => t + (m.fee_lars||0), 0) + tHearsF.reduce((t,m) => t + (m.fee_lars||0), 0);

  document.getElementById("bol-retailers-content").innerHTML = `
    <button onclick="switchBolView('landing')" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back to Bol Business</button>
    <div class="business-card" style="margin-bottom:20px">
      <div class="business-header">
        <div><div class="business-name">Retailers — Total</div></div>
        <div class="period-filter">${retCardPeriodBtns("ret_total")}</div>
      </div>
      <div class="business-metrics">
        <div><div class="metric-label">Total Revenue</div><div class="metric-value">${eur(tRev)}</div></div>
        <div><div class="metric-label">Total Profit Lars</div><div class="metric-value" style="color:var(--green)">${eur(tFee)}</div></div>
      </div>
      <div class="chart-wrap" style="height:220px;margin-top:16px"><canvas id="ret-chart-total"></canvas></div>
      <div class="source-badge" style="margin-top:8px"><span class="dot"></span>Google Sheets · ${formatDate(data.last_refresh)}</div>
    </div>
    <div class="business-card" style="margin-bottom:20px">
      <div class="business-header">
        <div style="display:flex;align-items:center;gap:10px"><img src="img/Logo Dore and Rose.jpg" style="height:64px;border-radius:4px"><div class="business-name">Dore and Rose</div></div>
        <div class="period-filter">${retCardPeriodBtns("ret_revenue")}</div>
      </div>
      <div class="business-metrics">
        <div><div class="metric-label">Revenue</div><div class="metric-value">${eur(sumRev)}</div></div>
        <div><div class="metric-label">Profit D&R</div><div class="metric-value" style="color:var(--primary)">${eur(sumProfit)}</div></div>
        <div><div class="metric-label">Margin</div><div class="metric-value">${margin.toFixed(1)}%</div></div>
        <div><div class="metric-label">Profit Lars</div><div class="metric-value" style="color:var(--green)">${eur(sumFee)} (${sumRev > 0 ? Math.round(sumFee/sumRev*100) : 0}%)</div></div>
      </div>
      <div class="chart-wrap" style="height:220px;margin-top:16px"><canvas id="ret-chart-revenue"></canvas></div>
      <div class="source-badge" style="margin-top:8px"><span class="dot"></span>Google Sheets · ${formatDate(data.last_refresh)}</div>
    </div>
  `;

  // Hears card
  const hearsDetail = data.hears_detail;
  window._hearsData = hearsDetail;

  if (hearsDetail && hearsDetail.months && hearsDetail.months.length > 0) {
    const hPeriod = retailersCardPeriods.hears_revenue || "ytd";
    const { filtered: hAll } = bolFilterMonths(hearsDetail, hPeriod);
    const hRev = hAll.reduce((t,m) => t + m.revenue, 0);
    const hProfit = hAll.reduce((t,m) => t + m.profit, 0);
    const hMargin = hRev > 0 ? (hProfit / hRev * 100) : 0;
    const hFee = hAll.reduce((t,m) => t + (m.fee_lars||0), 0);

    const hPeriodBtns = retCardPeriodBtns("hears_revenue");

    document.getElementById("bol-retailers-content").innerHTML += `
      <div class="business-card" style="margin-bottom:20px">
        <div class="business-header">
          <div style="display:flex;align-items:center;gap:10px"><img src="img/Logo Hears.jpg" style="height:64px;border-radius:4px"><div class="business-name">Hears</div></div>
          <div class="period-filter">${hPeriodBtns}</div>
        </div>
        <div class="business-metrics">
          <div><div class="metric-label">Revenue</div><div class="metric-value">${eur(hRev)}</div></div>
          <div><div class="metric-label">Profit Hears</div><div class="metric-value" style="color:var(--primary)">${eur(hProfit)}</div></div>
          <div><div class="metric-label">Margin</div><div class="metric-value">${hMargin.toFixed(1)}%</div></div>
          <div><div class="metric-label">Profit Lars</div><div class="metric-value" style="color:var(--green)">${eur(hFee)} (${hRev > 0 ? Math.round(hFee/hRev*100) : 0}%)</div></div>
        </div>
        <div class="chart-wrap" style="height:220px;margin-top:16px"><canvas id="hears-chart-revenue"></canvas></div>
        <div class="source-badge" style="margin-top:8px"><span class="dot"></span>Google Sheets · ${formatDate(data.last_refresh)}</div>
      </div>
    `;
  }

  setTimeout(() => renderRetailersCharts(), 50);
}

function renderRetailersCharts() {
  const ret = window._retData;
  if (!ret) return;

  const eurTick = v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v);
  const datalabels = { id: "dl-ret", afterDatasetsDraw(chart) {
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val) return;
        chart.ctx.save(); chart.ctx.fillStyle = "#555"; chart.ctx.font = "10px sans-serif"; chart.ctx.textAlign = "center";
        const lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
        if (lbl) chart.ctx.fillText(lbl, bar.x, bar.y - 4);
        chart.ctx.restore();
      });
    });
  }};

  function makeRetChart(id, period, datasets, opts) {
    const { allMonths } = bolFilterMonths(ret, period);
    const labels = allMonths.map(m => m.label.split(" ")[0]);
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    const mappedDs = datasets.map(d => ({ ...d, data: allMonths.map(d.mapper) }));
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "bar", data: { labels, datasets: mappedDs }, plugins: [datalabels],
      options: Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } },
        scales: { y: { beginAtZero: true, ticks: { callback: eurTick } } } }, opts || {})
    });
  }

  // Combined total chart
  const hearsForChart = window._hearsData;
  const tPeriod = retailersCardPeriods.ret_total || "ytd";
  const { allMonths: tRetMonths } = bolFilterMonths(ret, tPeriod);
  const { allMonths: tHearsMonths } = hearsForChart && hearsForChart.months ? bolFilterMonths(hearsForChart, tPeriod) : { allMonths: [] };
  const tLabels = tRetMonths.map(m => m.label.split(" ")[0]);
  const tCanvas = document.getElementById("ret-chart-total");
  if (tCanvas) {
    if (tCanvas._chart) tCanvas._chart.destroy();
    const combinedRev = tRetMonths.map((m, i) => m.revenue + (tHearsMonths[i]?.revenue || 0));
    const combinedFee = tRetMonths.map((m, i) => (m.fee_lars || 0) + (tHearsMonths[i]?.fee_lars || 0));
    tCanvas._chart = new Chart(tCanvas.getContext("2d"), {
      type: "bar", data: { labels: tLabels, datasets: [
        { label: "Revenue", data: combinedRev, backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
        { label: "Profit Lars", data: combinedFee, backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
      ]}, plugins: [datalabels],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } },
        scales: { y: { beginAtZero: true, ticks: { callback: eurTick } } } }
    });
  }

  // Dore and Rose chart
  makeRetChart("ret-chart-revenue", retailersCardPeriods.ret_revenue, [
    { label: "Revenue", mapper: m => m.revenue, backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
    { label: "Profit", mapper: m => m.profit, backgroundColor: "rgba(147,197,253,0.8)", borderRadius: 4 },
    { label: "Profit Lars", mapper: m => m.fee_lars || 0, backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
  ]);

  // Hears chart
  const hearsChart = window._hearsData;
  if (hearsChart && hearsChart.months && hearsChart.months.length > 0) {
    const hPeriod = retailersCardPeriods.hears_revenue || "ytd";
    const { allMonths: hMonths } = bolFilterMonths(hearsChart, hPeriod);
    const hLabels = hMonths.map(m => m.label.split(" ")[0]);
    const hCanvas = document.getElementById("hears-chart-revenue");
    if (hCanvas) {
      if (hCanvas._chart) hCanvas._chart.destroy();
      const hDs = [
        { label: "Revenue", data: hMonths.map(m => m.revenue), backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
        { label: "Profit", data: hMonths.map(m => m.profit), backgroundColor: "rgba(147,197,253,0.8)", borderRadius: 4 },
        { label: "Profit Lars", data: hMonths.map(m => m.fee_lars || 0), backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
      ];
      hCanvas._chart = new Chart(hCanvas.getContext("2d"), {
        type: "bar", data: { labels: hLabels, datasets: hDs }, plugins: [datalabels],
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } },
          scales: { y: { beginAtZero: true, ticks: { callback: eurTick } } } }
      });
    }
  }
}

function renderBolCardChart(cardId) {
  const bol = window._bolData;
  if (!bol) return;
  const period = bolCardPeriods[cardId] || "ytd";
  const { allMonths } = bolFilterMonths(bol, period);
  const labels = allMonths.map(m => m.label.split(" ")[0]);
  const eurTick = v => "€ " + (v >= 1000 ? (v/1000).toFixed(0) + "K" : v);

  const isReturnsOrCosts = cardId === "returns" || cardId === "costs";
  const datalabelsPlugin = { id: "dl-" + cardId, afterDatasetsDraw(chart) {
    const drawn = []; // track drawn label positions to avoid overlap
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      const isLine = ds.type === "line";
      meta.data.forEach((pt, idx) => {
        const val = ds.data[idx];
        if (!val) return;
        chart.ctx.save();
        chart.ctx.fillStyle = isLine ? "rgba(249,115,22,1)" : "#555";
        chart.ctx.font = isLine ? "bold 10px sans-serif" : "10px sans-serif";
        chart.ctx.textAlign = "center";
        let lbl;
        if (isLine || (ds.label && ds.label.includes("%"))) {
          lbl = Math.round(val) + "%";
        } else if (cardId === "returns" && ds.label === "Returns") {
          lbl = String(Math.round(val));
        } else {
          lbl = val >= 1000 ? "€" + (val/1000).toFixed(1) + "K" : val >= 1 ? "€" + Math.round(val) : "";
        }
        if (lbl) {
          let y = pt.y - (isLine ? 10 : 4);
          // Avoid overlapping with previously drawn labels
          for (const d of drawn) {
            if (Math.abs(d.x - pt.x) < 30 && Math.abs(d.y - y) < 12) {
              y = d.y - 13; // push above the existing label
            }
          }
          chart.ctx.fillText(lbl, pt.x, y);
          drawn.push({ x: pt.x, y });
        }
        chart.ctx.restore();
      });
    });
  }};

  function make(id, datasets, opts) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "bar", data: { labels, datasets }, plugins: [datalabelsPlugin],
      options: Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } },
        scales: { y: { beginAtZero: true, ticks: { callback: eurTick } } } }, opts || {})
    });
  }

  if (cardId === "landing") {
    make("bol-chart-landing", [
      { label: "Revenue", data: allMonths.map(m => m.revenue), backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
      { label: "Profit", data: allMonths.map(m => m.profit), backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
    ]);
  } else if (cardId === "revenue") {
    make("bol-chart-revenue", [
      { label: "Revenue", data: allMonths.map(m => m.revenue), backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
      { label: "Profit", data: allMonths.map(m => m.profit), backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
    ]);
  } else if (cardId === "margins") {
    // Chart 1: € bedragen
    const canvas1 = document.getElementById("bol-chart-margins");
    if (canvas1) {
      if (canvas1._chart) canvas1._chart.destroy();
      canvas1._chart = new Chart(canvas1.getContext("2d"), {
        type: "bar", data: { labels, datasets: [
          { label: "Gross Margin", data: allMonths.map(m => m.gross_margin || 0), backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
          { label: "Nett Product Margin", data: allMonths.map(m => m.nett_margin_product || 0), backgroundColor: "rgba(139,92,246,0.6)", borderRadius: 4 },
          { label: "Nett Business Margin", data: allMonths.map(m => m.profit || 0), backgroundColor: "rgba(34,197,94,0.6)", borderRadius: 4 }
        ]}, plugins: [datalabelsPlugin],
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } }, scales: {
          y: { beginAtZero: true, ticks: { callback: eurTick } }
        }}
      });
    }
    // Chart 2: percentages
    const canvas2 = document.getElementById("bol-chart-margins-pct");
    if (canvas2) {
      if (canvas2._chart) canvas2._chart.destroy();
      canvas2._chart = new Chart(canvas2.getContext("2d"), {
        type: "bar", data: { labels, datasets: [
          { label: "Gross Margin %", data: allMonths.map(m => m.gross_margin_pct || 0), backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
          { label: "Nett Product %", data: allMonths.map(m => m.nett_margin_product_pct || 0), backgroundColor: "rgba(139,92,246,0.6)", borderRadius: 4 },
          { label: "Nett Business %", data: allMonths.map(m => m.profit_pct || 0), backgroundColor: "rgba(34,197,94,0.6)", borderRadius: 4 }
        ]}, plugins: [datalabelsPlugin],
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } }, scales: {
          y: { beginAtZero: true, max: 50, ticks: { callback: v => v + "%" } }
        }}
      });
    }
  } else if (cardId === "returns") {
    const canvas = document.getElementById("bol-chart-returns");
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    const singleMonth = allMonths.length <= 1;
    const returnsDs = { label: "Returns", data: allMonths.map(m => m.returns || 0), backgroundColor: "rgba(239,68,68,0.6)", borderRadius: 4, yAxisID: "y" };
    const pctDs = singleMonth
      ? { label: "Return %", data: allMonths.map(m => m.return_pct || 0), backgroundColor: "rgba(249,115,22,0.5)", borderRadius: 4, yAxisID: "y1" }
      : { label: "Return %", data: allMonths.map(m => m.return_pct || 0), type: "line", borderColor: "rgba(249,115,22,1)", backgroundColor: "rgba(249,115,22,0.1)", tension: 0.3, yAxisID: "y1", pointRadius: 4 };
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "bar", data: { labels, datasets: [returnsDs, pctDs] }, plugins: [datalabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } }, scales: {
        y: { beginAtZero: true, position: "left", ticks: { callback: v => Math.round(v) } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, ticks: { callback: v => v + "%" } }
      }}
    });
  } else if (cardId === "costs") {
    make("bol-chart-costs", [
      { label: "Non-saleable", data: allMonths.map(m => m.non_saleable_costs || 0), backgroundColor: "rgba(239,68,68,0.6)", borderRadius: 4 },
      { label: "Storage", data: allMonths.map(m => m.storage_cost || 0), backgroundColor: "rgba(249,115,22,0.5)", borderRadius: 4 },
      { label: "Recovery", data: allMonths.map(m => m.recovery_clients || 0), backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
    ]);
  }
}

function renderBolCharts(data) {
  if (data.bol_detail) {
    window._bolData = data.bol_detail;
    ["revenue","margins","returns","costs"].forEach(c => renderBolCardChart(c));
  }
}

// ── Businesses tab ─────────────────────────────────────────────
function renderBusinesses(data) {
  // Rebrain tab — placeholder
  document.getElementById("tab-businesses-content").innerHTML =
    `<p style="color:#888;text-align:center;margin-top:40px">Coming soon</p>`;
}

function renderBusinessCharts(data) {
  data.businesses.forEach((b, i) => {
    if (b.source !== "not_configured" && b.source !== "error") {
      createBusinessChart(`chart-biz-${i}`, data.chart_data, b.name);
    }
  });
}

// ── Investments tab ─────────────────────────────────────────

function filterAssetHistory(history, period) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  if (period === "ytd") return history.filter(s => s.year === curYear);
  if (period === "6m") {
    const cutoff = new Date(curYear, curMonth - 7, 1);
    return history.filter(s => new Date(s.year, s.month - 1, 1) >= cutoff);
  }
  if (period === "3y") {
    return history.filter(s => s.year >= curYear - 3);
  }
  return history;
}

function setAssetChartPeriod(p) {
  assetChartPeriod = p;
  document.querySelectorAll(".asset-period-btn").forEach(b => b.classList.toggle("active", b.dataset.period === p));
  const history = window._assetHistory || [];
  renderAssetHistoryChart("asset-history-chart", history);
  ["stocks","crypto","savings","loans"].forEach(cat => renderAssetCategoryChart(cat, history));
}

function renderAssetHistoryChart(canvasId, history) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !history.length) return;
  if (canvas._chart) canvas._chart.destroy();

  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const period = assetChartPeriod;

  // Build data points based on period
  let chartPoints = [];
  if (period === "3y") {
    // Last 3 years of data
    for (let y = curYear - 2; y <= curYear; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === curYear && m > curMonth) { chartPoints.push({ label: monthNames[m-1] + " " + y, value: null }); continue; }
        const snap = history.find(s => s.year === y && s.month === m);
        chartPoints.push({ label: monthNames[m-1] + " " + y, value: snap ? (snap.total || 0) : null });
      }
    }
  } else if (period === "6m") {
    for (let i = 5; i >= 0; i--) {
      let m = curMonth - i; let y = curYear;
      if (m <= 0) { m += 12; y--; }
      const snap = history.find(s => s.year === y && s.month === m);
      chartPoints.push({ label: monthNames[m-1], value: snap ? (snap.total || 0) : null });
    }
  } else if (period && period.startsWith("m")) {
    const selMonth = parseInt(period.substring(1));
    const snap = history.find(s => s.year === curYear && s.month === selMonth);
    chartPoints.push({ label: monthNames[selMonth-1], value: snap ? (snap.total || 0) : null });
  } else {
    // YTD
    for (let m = 1; m <= 12; m++) {
      const snap = history.find(s => s.year === curYear && s.month === m);
      chartPoints.push({ label: monthNames[m-1], value: snap ? (snap.total || 0) : null });
    }
  }

  const labels = chartPoints.map(p => p.label);
  const yearData = chartPoints.map(p => p.value);

  const datalabels = { id: "dl-" + canvasId, afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((pt, idx) => {
      const val = chart.data.datasets[0].data[idx];
      if (val === null || val === undefined || !val) return;
      chart.ctx.save();
      chart.ctx.fillStyle = "#333";
      chart.ctx.font = "bold 11px sans-serif";
      chart.ctx.textAlign = "center";
      chart.ctx.fillText("€" + (val >= 1000 ? Math.round(val/1000) + "K" : Math.round(val)), pt.x, pt.y - 10);
      chart.ctx.restore();
    });
  }};

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels, datasets: [{
      label: "Total Assets",
      data: yearData,
      borderColor: "rgba(59,130,246,1)",
      backgroundColor: "rgba(59,130,246,0.1)",
      borderWidth: 2.5,
      tension: 0.3,
      pointRadius: yearData.map(v => v !== null ? 5 : 0),
      pointBackgroundColor: "rgba(59,130,246,1)",
      fill: true,
      spanGaps: false
    }]},
    plugins: [datalabels],
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false, ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v) } } }
    }
  });
}

function renderAssetCategoryChart(category, history) {
  const canvas = document.getElementById("asset-chart-" + category);
  if (!canvas || !history.length) return;
  if (canvas._chart) canvas._chart.destroy();

  const curYear = new Date().getFullYear();
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Build full year with empty future months
  const yearData = [];
  for (let m = 1; m <= 12; m++) {
    const snap = history.find(s => s.year === curYear && s.month === m);
    yearData.push({ month: m, value: snap ? (snap[category] || 0) : null });
  }

  const labels = monthNames;
  const data = yearData.map(d => d.value);

  const colorMap = {
    stocks: { border: "rgba(59,130,246,1)", bg: "rgba(59,130,246,0.1)" },
    crypto: { border: "rgba(249,115,22,1)", bg: "rgba(249,115,22,0.1)" },
    savings: { border: "rgba(34,197,94,1)", bg: "rgba(34,197,94,0.1)" },
    loans: { border: "rgba(139,92,246,1)", bg: "rgba(139,92,246,0.1)" }
  };
  const c = colorMap[category] || colorMap.stocks;

  const datalabels = { id: "dl-cat-" + category, afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((pt, idx) => {
      const val = chart.data.datasets[0].data[idx];
      if (val === null || val === undefined) return;
      chart.ctx.save();
      chart.ctx.fillStyle = "#555";
      chart.ctx.font = "10px sans-serif";
      chart.ctx.textAlign = "center";
      chart.ctx.fillText("€" + (val >= 1000 ? Math.round(val/1000) + "K" : Math.round(val)), pt.x, pt.y - 8);
      chart.ctx.restore();
    });
  }};

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels, datasets: [{
      label: category.charAt(0).toUpperCase() + category.slice(1),
      data,
      borderColor: c.border,
      backgroundColor: c.bg,
      borderWidth: 2,
      tension: 0.3,
      pointRadius: data.map(v => v !== null ? 5 : 0),
      pointBackgroundColor: c.border,
      fill: true,
      spanGaps: false
    }]},
    plugins: [datalabels],
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(1) + "K" : v) } } }
    }
  });
}

function toggleAssetChart(category) {
  const dd = document.getElementById("asset-dropdown-" + category);
  const arrow = document.getElementById("asset-arrow-" + category);
  if (dd.style.display === "none") {
    dd.style.display = "";
    arrow.style.transform = "rotate(180deg)";
    const history = window._assetHistory || [];
    if (history.length > 0) setTimeout(() => renderAssetCategoryChart(category, history), 50);
  } else {
    dd.style.display = "none";
    arrow.style.transform = "";
  }
}

function renderInvestments(data) {
  const nw = data.net_worth;
  const history = data.asset_history || [];
  window._assetHistory = history;

  const html = nw.breakdown.map(inv => {
    const pnlSign = inv.monthly_pnl_eur >= 0 ? "+" : "";
    const pnlColor = inv.monthly_pnl_eur >= 0 ? "var(--green)" : "var(--red)";

    const isManual = inv.source === "manual";
    let updateBtn = "";
    if (inv.name === "Revolut Crypto") {
      updateBtn = `<button class="update-btn" onclick="openRevolutModal()">✏️ Update</button>`;
    } else if (inv.name === "Savings") {
      updateBtn = `<button class="update-btn" onclick="openSavingsModal()">✏️ Update</button>`;
    } else if (inv.name === "Loans") {
      updateBtn = `<button class="update-btn" onclick="openLoansModal()">✏️ Update</button>`;
    } else if (inv.name === "Stocks") {
      if (inv.source === "not_connected" || inv.source === "session_expired") {
        const label = inv.source === "session_expired" ? "🔄 Reconnect" : "🔗 Connect";
        updateBtn = `<button class="update-btn" style="color:var(--primary);border-color:var(--primary)" onclick="openDegiroLoginModal()">${label}</button>`;
      } else if (inv.source === "degiro_stale") {
        updateBtn = `<button class="update-btn" style="color:var(--primary);border-color:var(--primary)" onclick="openDegiroLoginModal()">🔄 Reconnect</button>`;
      } else {
        updateBtn = `<button class="update-btn" onclick="degiroRefresh().then(()=>loadDashboard())">↺ Refresh</button>`;
      }
    }

    // Extra metrics for Stocks (DeGiro)
    let extraMetrics = "";
    if (inv.name === "Stocks" && !["not_connected", "session_expired"].includes(inv.source)) {
      const totalPnlSign = inv.total_pnl_eur >= 0 ? "+" : "";
      const totalPnlColor = inv.total_pnl_eur >= 0 ? "var(--green)" : "var(--red)";
      const dailyPnlSign = inv.daily_pnl_eur >= 0 ? "+" : "";
      const dailyPnlColor = inv.daily_pnl_eur >= 0 ? "var(--green)" : "var(--red)";

      // Monthly P&L: current value vs previous month's last snapshot.
      // Using previous month as baseline gives a stable, meaningful P&L for the month.
      // (Comparing against this month's snapshot is useless — it's updated every dashboard load.)
      const now = new Date();
      const curYear = now.getFullYear(), curMonth = now.getMonth() + 1;
      const prevMonthSnaps = history.filter(h => (h.year === curYear && h.month === curMonth - 1) || (h.month === 12 && curMonth === 1 && h.year === curYear - 1)).filter(h => h.stocks != null);
      const monthBaseSnap = prevMonthSnaps.length ? prevMonthSnaps.reduce((a, b) => a.date > b.date ? a : b) : null;
      const monthBase = monthBaseSnap ? monthBaseSnap.stocks : null;
      const monthPnl = monthBase != null ? inv.value_eur - monthBase : null;
      const monthPnlSign = monthPnl >= 0 ? "+" : "";
      const monthPnlColor = monthPnl >= 0 ? "var(--green)" : "var(--red)";
      const monthPnlHtml = monthPnl != null
        ? `<div class="metric-value" style="color:${monthPnlColor}">${monthPnlSign}${eur(monthPnl)}</div>`
        : `<div class="metric-value" style="color:var(--text-muted)">—</div>`;

      extraMetrics = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <div>
            <div class="metric-label">Total P&L</div>
            <div class="metric-value" style="color:${totalPnlColor}">${totalPnlSign}${eur(inv.total_pnl_eur)}</div>
          </div>
          <div>
            <div class="metric-label">Month P&L</div>
            ${monthPnlHtml}
          </div>
          <div>
            <div class="metric-label">Day P&L (close)</div>
            <div class="metric-value" style="color:${dailyPnlColor}">${dailyPnlSign}${eur(inv.daily_pnl_eur)}</div>
          </div>
          <div>
            <div class="metric-label">Free space</div>
            <div class="metric-value">${eur(inv.free_space_eur)}</div>
          </div>
        </div>
      `;
    }

    const staleWarning = inv.source === "degiro_stale"
      ? `<span style="color:var(--red);font-size:11px;margin-left:6px">Session expired — reconnect for live data</span>`
      : "";
    const lastUpdate = inv.last_updated
      ? "Updated: " + formatDate(inv.last_updated) + staleWarning
      : "Not yet filled in";

    const catKey = inv.category || "";
    const hasChart = history.length > 0 && ["stocks","crypto","savings","loans"].includes(catKey);

    return `
      <div class="investment-card" style="padding:0;overflow:hidden">
        <div style="padding:16px 20px">
          <div class="flex items-center justify-between" style="margin-bottom:12px">
            <div>
              <div class="card-title">${inv.name}</div>
              <div class="investment-value">${eur(inv.value_eur)}</div>
              ${inv.monthly_pnl_eur !== 0 ? `
                <div class="investment-pnl" style="color:${pnlColor}">
                  ${pnlSign}${eur(inv.monthly_pnl_eur)} this month
                </div>
              ` : ""}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${updateBtn}
              ${hasChart ? `<div style="cursor:pointer;color:var(--text-muted);font-size:16px;padding:4px;transition:transform 0.2s" id="asset-arrow-${catKey}" onclick="toggleAssetChart('${catKey}')">▼</div>` : ""}
            </div>
          </div>
          ${extraMetrics}
          <div class="source-badge">
            <span class="dot ${isManual ? 'manual' : ''}"></span>
            ${lastUpdate}
          </div>
        </div>
        ${hasChart ? `<div id="asset-dropdown-${catKey}" style="display:none;border-top:1px solid var(--border);padding:12px 20px">
          <div class="chart-wrap" style="height:160px"><canvas id="asset-chart-${catKey}"></canvas></div>
        </div>` : ""}
      </div>
    `;
  }).join("");

  // Asset history chart
  let assetChartsHtml = "";
  if (history.length > 0) {
    const prev = history.length >= 2 ? history[history.length - 2] : null;
    const curr = history[history.length - 1];
    const growthEur = prev ? curr.total - prev.total : 0;
    const growthPct = prev && prev.total > 0 ? ((curr.total - prev.total) / prev.total * 100) : 0;
    const growthSign = growthEur >= 0 ? "+" : "";
    const growthColor = growthEur >= 0 ? "var(--green)" : "var(--red)";

    const periodBtns = ["ytd","6m","3y"].map(p =>
      `<button class="period-btn asset-period-btn ${p === assetChartPeriod ? 'active' : ''}" data-period="${p}" onclick="setAssetChartPeriod('${p}')" style="font-size:11px;padding:2px 8px">${p === "ytd" ? "Year-to-date" : p === "6m" ? "6 months" : "3 years"}</button>`
    ).join("");

    assetChartsHtml = `
      <div class="card" style="margin-bottom:16px">
        <div style="padding:16px 20px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <div>
              <div style="font-size:15px;font-weight:600">Portfolio History</div>
              ${prev ? `<div style="font-size:13px;color:${growthColor};margin-top:4px">${growthSign}${eur(growthEur)} (${growthSign}${growthPct.toFixed(1)}%) vs prev month</div>` : ""}
            </div>
            <div class="period-filter">${periodBtns}</div>
          </div>
          <div class="chart-wrap" style="height:240px"><canvas id="asset-history-chart"></canvas></div>
        </div>
      </div>`;
  }

  document.getElementById("tab-investments-content").innerHTML = `
    <div class="section-title">Assets</div>
    <div class="networth-hero" style="margin-bottom:16px">
      <div class="networth-label">Total Assets</div>
      <div class="networth-total">${eur(nw.total_eur)}</div>
    </div>
    ${assetChartsHtml}
    <div class="grid-2">${html}</div>
  `;

  if (history.length > 0) {
    setTimeout(() => renderAssetHistoryChart("asset-history-chart", history), 50);
  }
}

// ── Entities tab ─────────────────────────────────────────────
let activeEntity = null;

function openEntity(entity) {
  activeEntity = entity;
  if (dashboardData) renderEntities(dashboardData);
}

function renderEntities(data) {
  const entityMap = { "BV": "NL", "LLC": "US" };

  if (!activeEntity) {
    // Landing: twee klikbare kaarten
    document.getElementById("tab-entities-content").innerHTML = `
      <div style="display:flex;gap:20px;margin-top:20px;flex-wrap:wrap">
        <div onclick="openEntity('NL')" style="flex:1;min-width:250px;background:white;border:1px solid var(--border);border-radius:12px;padding:32px;cursor:pointer;text-align:center;transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
          <div style="font-size:48px;margin-bottom:12px">🇳🇱</div>
          <div style="font-size:20px;font-weight:700">NL</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Netherlands</div>
        </div>
        <div onclick="openEntity('US')" style="flex:1;min-width:250px;background:white;border:1px solid var(--border);border-radius:12px;padding:32px;cursor:pointer;text-align:center;transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
          <div style="font-size:48px;margin-bottom:12px">🇺🇸</div>
          <div style="font-size:20px;font-weight:700">US</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">United States</div>
        </div>
      </div>
    `;
    return;
  }

  if (activeEntity === "NL") {
    // NL: BV (Dignum Commerce Fund) + Holding (Dignum Capitalis)
    const bvBusinesses = ["Bol.com Business", "Bol Business"];
    const holdingBusinesses = ["Retailers", "Hears"];

    // Calculate BV totals (Opalgoods)
    const bvEntity = data.entities.find(e => e.entity === "BV");
    let bvRev = 0, bvProf = 0, bvExp = 0;
    let holdRev = 0, holdProf = 0, holdExp = 0;

    if (data.businesses) {
      data.businesses.forEach(b => {
        const isBV = bvBusinesses.some(n => b.name.toLowerCase().includes(n.toLowerCase()));
        const isHolding = holdingBusinesses.some(n => b.name.toLowerCase().includes(n.toLowerCase()));
        if (isBV) { bvRev += b.revenue; bvProf += b.profit; bvExp += b.expenses; }
        if (isHolding) { holdRev += b.revenue; holdProf += b.profit; holdExp += b.expenses; }
      });
    }

    // SP Agency profit toevoegen aan Holding
    // SP Agency data is apart beschikbaar
    if (window._spaData && window._spaData.months) {
      const curYear = new Date().getFullYear();
      const curMonth = new Date().getMonth() + 1;
      const spaProfit = window._spaData.months.filter(m => m.year === curYear && m.month <= curMonth).reduce((t,m) => t + (m.profit||0), 0);
      holdProf += spaProfit;
      holdRev += spaProfit;
    }

    const bvMargin = bvRev > 0 ? (bvProf / bvRev * 100).toFixed(1) : "0.0";
    const holdMargin = holdRev > 0 ? (holdProf / holdRev * 100).toFixed(1) : "0.0";

    document.getElementById("tab-entities-content").innerHTML = `
      <button onclick="activeEntity=null;renderEntities(dashboardData)" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back</button>

      <div class="business-card" style="margin-bottom:20px;cursor:pointer" onclick="openEntityDetail('dignum_commerce_fund')">
        <div class="business-header">
          <div>
            <div class="business-name">🇳🇱 Dignum Commerce Fund</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">BV — OpalGoods</div>
          </div>
          <span style="color:#999;font-size:18px">›</span>
        </div>
      </div>

      <div class="business-card" style="cursor:pointer" onclick="openEntityDetail('dignum_capitalis')">
        <div class="business-header">
          <div>
            <div class="business-name">🇳🇱 Dignum Capitalis</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Holding — Retailers + Freelance</div>
          </div>
          <span style="color:#999;font-size:18px">›</span>
        </div>
      </div>
    `;
    return;
  }

  // US detail view
  const selected = data.entities.find(e => entityMap[e.entity] === "US");

  let content = "";
  if (selected) {
    content = `
      <div class="business-card">
        <div class="business-header">
          <div>
            <div class="business-name">🇺🇸 United States</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${selected.businesses.join(", ")}</div>
          </div>
        </div>
        <div class="business-metrics" style="margin-top:16px">
          <div><div class="metric-label">Revenue</div><div class="metric-value">${eur(selected.revenue)}</div></div>
          <div><div class="metric-label">Profit</div><div class="metric-value ${selected.profit >= 0 ? 'positive' : 'negative'}">${eur(selected.profit)}</div></div>
          <div><div class="metric-label">Expenses</div><div class="metric-value">${eur(selected.expenses)}</div></div>
          <div><div class="metric-label">Margin</div><div class="metric-value">${selected.margin}%</div></div>
        </div>
      </div>
    `;
  } else {
    content = `<p style="color:#888;text-align:center;margin-top:20px">No data available</p>`;
  }

  document.getElementById("tab-entities-content").innerHTML = `
    <button onclick="activeEntity=null;renderEntities(dashboardData)" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back</button>
    ${content}
  `;
}

// ── Quarterly entity detail view ──────────────────────────────

let qSelectedYear = new Date().getFullYear();
let qSelectedQuarters = new Set(); // empty = volledig jaar
let qCurrentEntity = null;
let qAllData = [];

function selectQYear(year) {
  qSelectedYear = year;
  qSelectedQuarters = new Set();
  if (qCurrentEntity && qAllData.length) renderEntityDetailView(qCurrentEntity, qAllData);
}

function toggleQQuarter(q) {
  if (qSelectedQuarters.has(q)) {
    qSelectedQuarters.delete(q);
  } else {
    qSelectedQuarters.add(q);
  }
  if (qCurrentEntity && qAllData.length) renderEntityDetailView(qCurrentEntity, qAllData);
}

function selectFullYear() {
  qSelectedQuarters = new Set();
  if (qCurrentEntity && qAllData.length) renderEntityDetailView(qCurrentEntity, qAllData);
}

function getQNum(d) {
  if (d.quarter) return d.quarter;
  if (d.period && /^Q\d/.test(d.period)) return parseInt(d.period[1]);
  return null;
}

function filterQuarterlyData(data) {
  let filtered = data.filter(d => d.year === qSelectedYear);
  if (qSelectedQuarters.size > 0) {
    filtered = filtered.filter(d => qSelectedQuarters.has(getQNum(d)));
  }
  return filtered;
}

async function openEntityDetail(entitySlug) {
  qCurrentEntity = entitySlug;
  const el = document.getElementById("tab-entities-content");
  const names = {
    "dignum_commerce_fund": "Dignum Commerce Fund (BV)",
    "dignum_capitalis": "Dignum Capitalis (Holding)"
  };
  const entityName = names[entitySlug] || entitySlug;

  el.innerHTML = `<div class="loading"><div class="spinner"></div><br>Loading quarterly data...</div>`;

  try {
    const resp = await fetch(`/api/quarterly/${entitySlug}`);
    qAllData = await resp.json();
    renderEntityDetailView(entitySlug, qAllData);
  } catch (e) {
    el.innerHTML = `<div class="error-msg">Error loading quarterly data: ${e.message}</div>`;
  }
}

function renderEntityDetailView(entitySlug, allQuarters) {
  const el = document.getElementById("tab-entities-content");
  const names = {
    "dignum_commerce_fund": "Dignum Commerce Fund (BV)",
    "dignum_capitalis": "Dignum Capitalis (Holding)"
  };
  const entityName = names[entitySlug] || entitySlug;

  const quarters = filterQuarterlyData(allQuarters);

    // KPIs from latest quarter
    const latest = quarters.length ? quarters[quarters.length - 1] : null;
    let kpiHtml = "";
    if (entitySlug === "dignum_capitalis") {
      // Holding: eigen KPI's
      if (latest && latest.winst_verlies) {
        const wv = latest.winst_verlies;
        const b = latest.balans || {};
        const latestLabel = latest.period_label || `Q${latest.quarter} ${latest.year}`;
        const revenue = wv.omzet || 0;
        const salarisBruto = wv.salaris_bruto || 0;
        const salarisNetto = wv.salaris_netto || 0;
        const belastingSalaris = wv.belasting_salaris || 0;
        const profit = revenue - salarisBruto;
        const balans_stand = b.liquide_middelen || 0;
        kpiHtml = `
          <div class="business-card" style="margin-bottom:20px">
            <div class="business-header">
              <div><div class="business-name">Latest: ${latestLabel}</div></div>
            </div>
            <div class="business-metrics" style="margin-top:12px">
              <div><div class="metric-label">Salary (Gross)</div><div class="metric-value">${eur(salarisBruto)}</div></div>
              <div><div class="metric-label">Salary (Net)</div><div class="metric-value">${eur(salarisNetto)}</div></div>
              <div><div class="metric-label">Tax on Salary</div><div class="metric-value" style="color:var(--red)">${eur(belastingSalaris)}</div></div>
            </div>
            <div class="business-metrics" style="margin-top:12px">
              <div><div class="metric-label">Revenue</div><div class="metric-value">${eur(revenue)}</div></div>
              <div><div class="metric-label">Profit</div><div class="metric-value" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${eur(profit)}</div></div>
              <div><div class="metric-label">Balance</div><div class="metric-value">${eur(balans_stand)}</div></div>
            </div>
          </div>
        `;
      } else {
        kpiHtml = `
          <div class="business-card" style="margin-bottom:20px">
            <div class="business-header">
              <div><div class="business-name">Dignum Capitalis — No data yet</div></div>
            </div>
            <div class="business-metrics" style="margin-top:12px">
              <div><div class="metric-label">Salary (Gross)</div><div class="metric-value">€ 0</div></div>
              <div><div class="metric-label">Salary (Net)</div><div class="metric-value">€ 0</div></div>
              <div><div class="metric-label">Tax on Salary</div><div class="metric-value" style="color:var(--red)">€ 0</div></div>
            </div>
            <div class="business-metrics" style="margin-top:12px">
              <div><div class="metric-label">Revenue</div><div class="metric-value">€ 0</div></div>
              <div><div class="metric-label">Profit</div><div class="metric-value">€ 0</div></div>
              <div><div class="metric-label">Balance</div><div class="metric-value">€ 0</div></div>
            </div>
          </div>
        `;
      }
    } else if (latest && latest.winst_verlies) {
      // BV: bestaande KPI's
      const wv = latest.winst_verlies;
      const b = latest.balans || {};
      const latestLabel = latest.period_label || `Q${latest.quarter} ${latest.year}`;
      kpiHtml = `
        <div class="business-card" style="margin-bottom:20px">
          <div class="business-header">
            <div><div class="business-name">Latest: ${latestLabel}</div></div>
          </div>
          <div class="business-metrics" style="margin-top:12px">
            <div><div class="metric-label">Revenue</div><div class="metric-value">${eur(wv.omzet)}</div></div>
            <div><div class="metric-label">Profit</div><div class="metric-value positive">${eur(wv.netto_winst)}</div></div>
            <div><div class="metric-label">Profit Margin</div><div class="metric-value">${wv.omzet ? Math.round(wv.netto_winst / wv.omzet * 100) : 0}%</div></div>
            <div><div class="metric-label">Salary</div><div class="metric-value">${eur(wv.werk_door_derden || 0)}</div></div>
            <div><div class="metric-label">Outstanding Loans</div><div class="metric-value">${eur(b.langlopende_schulden || 0)}</div></div>
            <div><div class="metric-label">Inventory</div><div class="metric-value">${eur(b.voorraden)}</div></div>
          </div>
        </div>
      `;
    }

    // Holding balance table (per quarter)
    let holdingTableHtml = "";
    if (entitySlug === "dignum_capitalis") {
      // Build rows from all quarters, or show empty template if no data
      const hYear = new Date().getFullYear();
      const hLabels = [];
      for (let q = 1; q <= 4; q++) hLabels.push(`Q${q} ${hYear}`);
      for (let q = 1; q <= 4; q++) hLabels.push(`Q${q} ${hYear+1}`);

      const hData = hLabels.map(label => {
        const parts = label.split(" ");
        const qNum = parseInt(parts[0].replace("Q",""));
        const qYear = parseInt(parts[1]);
        const match = allQuarters.find(q => q.year === qYear && q.quarter === qNum);
        const b = match?.balans || {};
        const wv = match?.winst_verlies || {};
        return {
          label, hasData: !!match,
          balance: b.liquide_middelen || 0,
          revenue: wv.omzet || 0,
          salaryGross: wv.salaris_bruto || 0,
          profit: (wv.omzet || 0) - (wv.salaris_bruto || 0),
        };
      });

      const qRows = hData.map(d => `<tr style="border-bottom:1px solid var(--border);${!d.hasData ? 'color:#ccc' : ''}">
          <td style="padding:10px 16px;font-weight:500">${d.label}</td>
          <td style="padding:10px 16px;text-align:right">${d.hasData ? eur(d.balance) : '—'}</td>
          <td style="padding:10px 16px;text-align:right">${d.hasData ? eur(d.revenue) : '—'}</td>
          <td style="padding:10px 16px;text-align:right;color:${d.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${d.hasData ? eur(d.profit) : '—'}</td>
          <td style="padding:10px 16px;text-align:right">${d.hasData ? eur(d.salaryGross) : '—'}</td>
        </tr>`).join("");

      holdingTableHtml = `
        <div class="business-card" style="margin-bottom:20px">
          <div class="business-name" style="margin-bottom:12px">Balance per Quarter</div>
          <div class="chart-wrap" style="height:200px;margin-bottom:20px"><canvas id="holding-balance-chart"></canvas></div>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="padding:8px 16px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600">Quarter</th>
                <th style="padding:8px 16px;text-align:right;font-size:12px;color:var(--text-muted);font-weight:600">Balance</th>
                <th style="padding:8px 16px;text-align:right;font-size:12px;color:var(--text-muted);font-weight:600">Revenue</th>
                <th style="padding:8px 16px;text-align:right;font-size:12px;color:var(--text-muted);font-weight:600">Profit</th>
                <th style="padding:8px 16px;text-align:right;font-size:12px;color:var(--text-muted);font-weight:600">Salary (Gross)</th>
              </tr>
            </thead>
            <tbody>${qRows}</tbody>
          </table>
        </div>
      `;

      // Store chart data for rendering after DOM insert
      window._holdingChartData = hData;
    }

    // Charts
    let chartsHtml = "";
    if (quarters.length > 0) {
      chartsHtml = `
        <div class="business-card" style="margin-bottom:20px">
          <div class="business-name">Revenue & Profit</div>
          <div class="chart-wrap" style="height:220px;margin-top:16px"><canvas id="q-rev-chart"></canvas></div>
        </div>
      `;
    }

    const curYear = new Date().getFullYear();
    const uploadedKeys = new Set(allQuarters.map(q => q.period === "annual" ? `${q.year}_Annual` : `${q.year}_${q.period}`));

    // Available years (2025 up to current year)
    const years = [];
    for (let y = 2025; y <= curYear; y++) years.push(y);

    const yearBtnStyle = (y) => {
      const active = qSelectedYear === y;
      return `style="padding:8px 20px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:14px;font-weight:${active?'700':'400'};background:${active?'var(--primary)':'var(--card-bg)'};color:${active?'#fff':'var(--text)'}"`;
    };
    const qBtnStyle = (q) => {
      const active = qSelectedQuarters.has(q);
      const hasData = uploadedKeys.has(`${qSelectedYear}_Q${q}`);
      return `style="padding:6px 16px;border:1px solid ${active?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:${active?'600':'400'};background:${active?'var(--primary)':'var(--card-bg)'};color:${active?'#fff':'var(--text)'};position:relative"`;
    };
    const fullYearActive = qSelectedQuarters.size === 0;
    const fullYearStyle = `style="padding:6px 16px;border:1px solid ${fullYearActive?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:${fullYearActive?'600':'400'};background:${fullYearActive?'var(--primary)':'var(--card-bg)'};color:${fullYearActive?'#fff':'var(--text)'}"`;

    const yearBtns = years.map(y =>
      `<button onclick="selectQYear(${y})" ${yearBtnStyle(y)}>${y}</button>`
    ).join("");

    const qBtns = [1,2,3,4].map(q => {
      const hasData = uploadedKeys.has(`${qSelectedYear}_Q${q}`);
      return `<button onclick="toggleQQuarter(${q})" ${qBtnStyle(q)}>Q${q}${hasData ? ' <span style="color:inherit;opacity:0.7;font-size:10px">✓</span>' : ''}</button>`;
    }).join("");

    const timelineHtml = `
      <div style="margin-bottom:20px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Jaar</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          ${yearBtns}
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Kwartaal</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="selectFullYear()" ${fullYearStyle}>Volledig jaar</button>
          ${qBtns}
        </div>
      </div>
    `;

    el.innerHTML = `
      <button onclick="openEntity('NL')" style="background:none;border:none;color:var(--primary);font-size:13px;cursor:pointer;padding:0 0 16px 0">← Back to NL</button>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0;font-size:20px">🇳🇱 ${entityName}</h2>
        <button class="btn-primary" onclick="openQuarterlyUpload('${entitySlug}')" style="font-size:13px;padding:8px 16px">📤 Upload Quarter</button>
      </div>

      ${timelineHtml}
      ${kpiHtml}
      ${holdingTableHtml}
      ${chartsHtml}
      ${!quarters.length && entitySlug !== 'dignum_capitalis' ? '<p style="color:#888;text-align:center;margin-top:40px">No quarterly data yet. Upload your first Exact Online report.</p>' : ''}
    `;

    // Render charts
    if (quarters.length > 0) {
      setTimeout(() => renderQuarterlyCharts(quarters), 50);
    }

    // Render holding balance line chart
    if (entitySlug === "dignum_capitalis" && window._holdingChartData) {
      setTimeout(() => {
        const canvas = document.getElementById("holding-balance-chart");
        if (!canvas) return;
        if (canvas._chart) canvas._chart.destroy();
        const hd = window._holdingChartData;
        const balanceData = hd.map(d => d.hasData ? d.balance : null);

        canvas._chart = new Chart(canvas.getContext("2d"), {
          type: "line",
          data: {
            labels: hd.map(d => d.label),
            datasets: [{
              label: "Balance",
              data: balanceData,
              borderColor: "#2563eb",
              backgroundColor: "rgba(37,99,235,.1)",
              fill: true,
              tension: 0.3,
              pointRadius: 6,
              pointBackgroundColor: "#2563eb",
              spanGaps: false,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              datalabels: {
                anchor: "end", align: "top", font: { size: 11, weight: "bold" },
                formatter: v => v != null ? "€" + (v >= 1000 ? (v/1000).toFixed(1) + "K" : Math.round(v)) : "",
                color: "#2563eb",
              }
            },
            scales: {
              x: { grid: { display: false } },
              y: {
                beginAtZero: true,
                ticks: { callback: v => "€ " + (v >= 1000 ? (v/1000).toFixed(0) + "K" : v) }
              }
            }
          }
        });
      }, 60);
    }
}

// ── Overhead section ─────────────────────────────────────────────────────────

function renderOverheadSection(bol, periodBtnsHtml) {
  const container = document.getElementById("bol-card-overhead");
  if (!container || !bol) return;

  const period = bolCardPeriods["overhead"] || "ytd";
  const { filtered, allMonths } = bolFilterMonths(bol, period);

  // Extract overhead values (aggregator spreads extra fields directly onto month object)
  function sumExtra(key) {
    return filtered.reduce((t, m) => t + (m[key] || 0), 0);
  }

  const totalNormal = sumExtra("overhead_normal");
  const totalInvestment = sumExtra("overhead_investment");
  const totalOverhead = totalNormal + totalInvestment;

  // Targets: scale monthly target by number of months in period
  const months = period === "ytd"
    ? new Date().getMonth() + 1
    : (period === "prev" ? 1 : (period.startsWith("m") ? 1 : 12));
  const targetNormal = OVERHEAD_TARGETS.normal * months;
  const targetInvestment = OVERHEAD_TARGETS.investment * months;
  const targetTotal = targetNormal + targetInvestment;

  function progressBar(value, target) {
    const pct = target > 0 ? Math.min(value / target * 100, 120) : 0;
    const color = pct < 80 ? "var(--green)" : pct <= 100 ? "#f59e0b" : "var(--red)";
    const width = Math.min(pct, 100);
    return `
      <div style="margin-top:6px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:2px">
          <span>${eur(value)} / ${eur(target)}</span>
          <span style="color:${color};font-weight:600">${Math.round(pct)}%</span>
        </div>
        <div style="background:var(--border);border-radius:4px;height:6px">
          <div style="background:${color};width:${width}%;height:6px;border-radius:4px;transition:width 0.3s"></div>
        </div>
      </div>`;
  }

  // ── Recommendations (always based on YTD vs full year target) ────────────
  const now = new Date();
  const curMonthNum = now.getMonth() + 1;
  const remainingMonths = 12 - curMonthNum;

  const ytdNormal = allMonths
    .filter(m => m.year === now.getFullYear() && m.month <= curMonthNum)
    .reduce((t, m) => t + (m.overhead_normal || 0), 0);
  const ytdInvestment = allMonths
    .filter(m => m.year === now.getFullYear() && m.month <= curMonthNum)
    .reduce((t, m) => t + (m.overhead_investment || 0), 0);

  const yearlyNormal = OVERHEAD_TARGETS.normal * 12;
  const yearlyInvestment = OVERHEAD_TARGETS.investment * 12;

  function inlineRec(ytd, yearlyTarget) {
    const remaining = yearlyTarget - ytd;
    const perMonth = remainingMonths > 0 ? remaining / remainingMonths : 0;
    const isOver = remaining < 0;
    const color = isOver ? "var(--red)" : "var(--green)";
    const icon = isOver ? "⚠️" : "✅";
    const msg = isOver
      ? `Over by ${eur(Math.abs(remaining))} — max <strong>${eur(Math.max(perMonth, 0))}/mo</strong> left`
      : `${eur(remaining)} left — <strong>${eur(perMonth)}/mo</strong> for ${remainingMonths} mo`;
    return `<div style="font-size:11px;color:${color};margin-bottom:5px;line-height:1.4">${icon} ${msg}</div>`;
  }

  function kpiCard(label, value, target, ytd, yearlyTarget, accentColor) {
    const pct = target > 0 ? Math.round(value / target * 100) : 0;
    const barColor = pct < 80 ? "var(--green)" : pct <= 100 ? "#f59e0b" : "var(--red)";
    const barWidth = Math.min(pct, 100);
    const remaining = yearlyTarget - ytd;
    const perMonth = remainingMonths > 0 ? remaining / remainingMonths : 0;
    const isOver = remaining < 0;
    const statusColor = isOver ? "var(--red)" : "var(--green)";
    const statusIcon = isOver ? "⚠️" : "✅";
    const statusMsg = isOver
      ? `<strong>${eur(Math.abs(remaining))}</strong> over budget — max <strong>${eur(Math.max(perMonth,0))}/mnd</strong> nog over`
      : `Nog <strong>${eur(perMonth)}/mnd</strong> beschikbaar de komende ${remainingMonths} maanden`;

    return `
      <div style="background:var(--surface-2);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">${label}</div>
          <div style="font-size:12px;font-weight:700;color:${barColor};background:${barColor}18;padding:2px 8px;border-radius:12px">${pct}%</div>
        </div>
        <div style="font-size:22px;font-weight:700;color:${pct > 100 ? 'var(--red)' : 'inherit'}">${eur(value)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Target: ${eur(target)}</div>
        <div style="background:var(--border);border-radius:4px;height:6px;margin:2px 0">
          <div style="background:${barColor};width:${barWidth}%;height:6px;border-radius:4px;transition:width 0.3s"></div>
        </div>
        <div style="font-size:11px;color:${statusColor};margin-top:2px;line-height:1.5">${statusIcon} ${statusMsg}</div>
      </div>`;
  }

  const kpiHtml = `
    ${kpiCard("Normal Overhead", totalNormal, targetNormal, ytdNormal, yearlyNormal, "#fb923c")}
    ${kpiCard("Investment Overhead", totalInvestment, targetInvestment, ytdInvestment, yearlyInvestment, "#8b5cf6")}
    ${kpiCard("Totaal", totalOverhead, targetTotal, ytdNormal + ytdInvestment, yearlyNormal + yearlyInvestment, "#64748b")}`;

  // Chart data: all 12 months, Normal + Investment stacked
  const curYear = new Date().getFullYear();
  const chartYear = period === "yoy" ? curYear - 1 : curYear;
  const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  let chartLabels, normalData, investData, targetData;
  if (period.startsWith("m") || period === "prev") {
    chartLabels = filtered.map(m => mn[m.month - 1]);
    normalData = filtered.map(m => m.overhead_normal || 0);
    investData = filtered.map(m => m.overhead_investment || 0);
    targetData = filtered.map(() => OVERHEAD_TARGETS.normal + OVERHEAD_TARGETS.investment);
  } else {
    chartLabels = mn;
    normalData = mn.map((_, i) => {
      const m = allMonths.find(d => d.year === chartYear && d.month === i + 1);
      return m ? (m.overhead_normal || 0) : 0;
    });
    investData = mn.map((_, i) => {
      const m = allMonths.find(d => d.year === chartYear && d.month === i + 1);
      return m ? (m.overhead_investment || 0) : 0;
    });
    targetData = mn.map(() => OVERHEAD_TARGETS.normal + OVERHEAD_TARGETS.investment);
  }

  container.innerHTML = `
    <div class="business-card">
      <div class="business-header">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="img/Opalgoods Logo.png" style="height:32px">
          <div class="business-name">Overhead Costs</div>
        </div>
        <div class="period-filter">${periodBtnsHtml}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:4px">${kpiHtml}</div>
      <div class="chart-wrap" style="height:240px;margin-top:20px"><canvas id="overhead-chart"></canvas></div>
    </div>`;

  const canvas = document.getElementById("overhead-chart");
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();

  const datalabels = { id: "dl-oh", afterDatasetsDraw(chart) {
    chart.data.datasets.slice(0,2).forEach((ds, i) => {
      chart.getDatasetMeta(i).data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val || val < 50) return;
        chart.ctx.save(); chart.ctx.fillStyle = "#555"; chart.ctx.font = "10px sans-serif"; chart.ctx.textAlign = "center";
        chart.ctx.fillText("€" + (val >= 1000 ? (val/1000).toFixed(1)+"K" : Math.round(val)), bar.x, bar.y - 4);
        chart.ctx.restore();
      });
    });
  }};

  const normalTarget = mn.map(() => OVERHEAD_TARGETS.normal);
  const investTarget = mn.map(() => OVERHEAD_TARGETS.investment);

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: chartLabels,
      datasets: [
        { label: "Normal", data: normalData, backgroundColor: "rgba(251,146,60,0.8)", borderRadius: 4, barPercentage: 0.4 },
        { label: "Investment", data: investData, backgroundColor: "rgba(139,92,246,0.75)", borderRadius: 4, barPercentage: 0.4 },
        { label: "Target Normal", data: period.startsWith("m") || period === "prev" ? normalData.map(() => OVERHEAD_TARGETS.normal) : normalTarget, type: "line", borderColor: "rgba(251,146,60,0.5)", borderWidth: 2, borderDash: [5,4], pointRadius: 0, fill: false },
        { label: "Target Investment", data: period.startsWith("m") || period === "prev" ? investData.map(() => OVERHEAD_TARGETS.investment) : investTarget, type: "line", borderColor: "rgba(139,92,246,0.5)", borderWidth: 2, borderDash: [5,4], pointRadius: 0, fill: false }
      ]
    },
    plugins: [datalabels],
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "top", labels: { font: { size: 11 }, filter: i => i.datasetIndex < 2 } } },
      scales: {
        x: { stacked: false },
        y: { stacked: false, beginAtZero: true, ticks: { callback: v => "€" + (v >= 1000 ? (v/1000).toFixed(0)+"K" : v) } }
      }
    }
  });
}

// ── Shopify section ──────────────────────────────────────────────────────────

let shopifyAllMonths = [];
let shopifyPeriod = "ytd";

function shopifyFilterMonths(period) {
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const all = shopifyAllMonths;

  if (customPeriodActive) {
    return customPeriodFilterMonths(all);
  }
  if (period.startsWith("m")) {
    const selMonth = parseInt(period.substring(1));
    const found = all.find(d => d.year === curYear && d.month === selMonth);
    return found ? [found] : [];
  }
  if (period === "prev") {
    const pm = curMonth === 1 ? 12 : curMonth - 1;
    const py = curMonth === 1 ? curYear - 1 : curYear;
    const found = all.find(d => d.year === py && d.month === pm);
    return found ? [found] : all.slice(-1);
  }
  if (period === "yoy") {
    return all.filter(d => d.year === curYear - 1);
  }
  // ytd: current year up to current month
  return all.filter(d => d.year === curYear && d.month <= curMonth);
}

function renderShopifyKpis() {
  const kpiEl = document.getElementById("shopify-kpis");
  if (!kpiEl || shopifyAllMonths.length === 0) return;

  const filtered = shopifyFilterMonths(shopifyPeriod);
  const isSingleMonth = shopifyPeriod.startsWith("m") || shopifyPeriod === "prev";

  // Aggregate totals
  const totRev = filtered.reduce((s, m) => s + m.revenue, 0);
  const totProfit = filtered.reduce((s, m) => s + m.profit, 0);
  const totSpend = filtered.reduce((s, m) => s + m.google_spend, 0);
  const totRoas = totSpend > 0 ? totRev / totSpend : 0;
  const totMargin = totRev > 0 ? (totProfit / totRev * 100) : 0;

  // For single-month: show vs previous month change
  let prev = null;
  if (isSingleMonth && filtered.length === 1) {
    const cur = filtered[0];
    const idx = shopifyAllMonths.findIndex(m => m.year === cur.year && m.month === cur.month);
    prev = idx > 0 ? shopifyAllMonths[idx - 1] : null;
  }

  function changeTag(cur, prev_val, good_if_up = true) {
    if (!isSingleMonth || prev_val == null || prev_val === 0) return "";
    const pct = ((cur - prev_val) / Math.abs(prev_val) * 100).toFixed(1);
    const up = parseFloat(pct) >= 0;
    const good = good_if_up ? up : !up;
    const color = good ? "var(--green)" : "var(--red)";
    return `<span style="font-size:11px;color:${color};margin-left:4px">${up ? "↑" : "↓"}${Math.abs(pct)}%</span>`;
  }

  const roasStr = totRoas > 0 ? totRoas.toFixed(2) + "x" : "—";

  kpiEl.innerHTML = `
    <div style="text-align:center;padding:14px 10px;background:var(--bg-secondary);border-radius:10px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Revenue</div>
      <div style="font-size:18px;font-weight:700">${eur(totRev)}${changeTag(totRev, prev?.revenue)}</div>
    </div>
    <div style="text-align:center;padding:14px 10px;background:var(--bg-secondary);border-radius:10px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Profit</div>
      <div style="font-size:18px;font-weight:700;color:${totProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${eur(totProfit)}${changeTag(totProfit, prev?.profit)}</div>
    </div>
    <div style="text-align:center;padding:14px 10px;background:var(--bg-secondary);border-radius:10px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Profit Margin</div>
      <div style="font-size:18px;font-weight:700;color:${totMargin >= 0 ? 'var(--green)' : 'var(--red)'}">${totMargin.toFixed(1)}%</div>
    </div>
    <div style="text-align:center;padding:14px 10px;background:var(--bg-secondary);border-radius:10px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Google Spend</div>
      <div style="font-size:18px;font-weight:700;color:${totSpend > 0 ? 'var(--text)' : 'var(--text-muted)'}">${totSpend > 0 ? eur(totSpend) : '—'}${changeTag(totSpend, prev?.google_spend, false)}</div>
    </div>
    <div style="text-align:center;padding:14px 10px;background:var(--bg-secondary);border-radius:10px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Google ROAS</div>
      <div style="font-size:18px;font-weight:700">${roasStr}</div>
    </div>
  `;

  // Update chart to filtered data
  renderShopifyChart(filtered);
}

function setShopifyPeriod(p) {
  if (!p) p = "ytd";
  shopifyPeriod = p;
  // Update active button styling
  const isMonth = p.startsWith("m");
  document.querySelectorAll(".shopify-pb").forEach(b => {
    b.classList.toggle("active", b.dataset.period === p);
  });
  const sel = document.getElementById("shopify-month-select");
  if (sel) {
    sel.value = isMonth ? p : "";
    sel.style.background = isMonth ? "var(--primary)" : "";
    sel.style.color = isMonth ? "#fff" : "";
  }
  renderShopifyKpis();
}

function renderShopifyChart(months) {
  const canvas = document.getElementById("shopify-chart");
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();

  const labels = months.map(m => m.label);
  const revData = months.map(m => m.revenue);
  const profitData = months.map(m => m.profit);

  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Revenue", data: revData, backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
        { label: "Profit",  data: profitData, backgroundColor: "rgba(34,197,94,0.5)", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12 } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: €${ctx.parsed.y?.toLocaleString("nl-NL", {minimumFractionDigits:0,maximumFractionDigits:0})}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => "€" + (v >= 1000 ? (v/1000).toFixed(0)+"K" : v) } }
      }
    }
  });
}

async function loadShopifySection() {
  const container = document.getElementById("shopify-section");
  if (!container) return;

  let months = [];
  let errorMsg = null;
  try {
    const resp = await fetch("/api/shopify");
    const json = await resp.json();
    months = json.months || [];
    if (json.error) errorMsg = json.error;
  } catch (e) {
    errorMsg = e.message;
  }

  if (errorMsg && months.length === 0) {
    container.innerHTML = `
      <div style="margin-top:24px;border-top:2px solid var(--border);padding-top:24px">
        <div class="business-card">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <img src="img/Shopify Logo.svg" style="height:24px">
          </div>
          <div style="color:var(--text-muted);font-size:13px">Could not load Shopify data. Make sure the sheet is shared with the service account.<br><small>${errorMsg}</small></div>
        </div>
      </div>`;
    return;
  }

  if (months.length === 0) {
    container.innerHTML = `
      <div style="margin-top:24px;border-top:2px solid var(--border);padding-top:24px">
        <div class="business-card">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <img src="img/Shopify Logo.svg" style="height:24px">
          </div>
          <div style="color:var(--text-muted);font-size:13px">No Shopify data found.</div>
        </div>
      </div>`;
    return;
  }

  shopifyAllMonths = months;
  shopifyPeriod = "ytd";

  const mnNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthSelectOpts = mnNames.map((n,i) =>
    `<option value="m${i+1}">${n}</option>`
  ).join("");

  const periodFilter = `
    <div class="period-filter">
      <select id="shopify-month-select" onchange="setShopifyPeriod(this.value||'ytd')"
        style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:white;color:inherit;cursor:pointer">
        <option value="">Month</option>
        ${monthSelectOpts}
      </select>
      <button class="period-btn shopify-pb active" data-period="ytd" onclick="setShopifyPeriod('ytd')" style="font-size:11px;padding:2px 8px">Year-to-date</button>
      <button class="period-btn shopify-pb" data-period="prev" onclick="setShopifyPeriod('prev')" style="font-size:11px;padding:2px 8px">Last month</button>
      <button class="period-btn shopify-pb" data-period="yoy" onclick="setShopifyPeriod('yoy')" style="font-size:11px;padding:2px 8px">Last year (YoY)</button>
      <button class="period-btn" onclick="activateCustomPeriod()" style="font-size:11px;padding:2px 8px">Custom</button>
    </div>
  `;

  container.innerHTML = `
    <div style="margin-top:28px;border-top:8px solid #96bf48;padding-top:28px">
      <div class="business-card">
        <div class="business-header" style="margin-bottom:20px">
          <img src="img/Shopify Logo.svg" style="height:28px">
          ${periodFilter}
        </div>

        <div id="shopify-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px"></div>

        <div class="chart-wrap" style="height:220px"><canvas id="shopify-chart"></canvas></div>
      </div>
    </div>
  `;

  setTimeout(() => {
    renderShopifyKpis();
  }, 50);

}

function renderQuarterlyCharts(quarters) {
  const labels = quarters.map(q => q.period_label || `Q${q.quarter} ${q.year}`);

  // Revenue & Profit chart
  const revCanvas = document.getElementById("q-rev-chart");
  if (revCanvas) {
    if (revCanvas._chart) revCanvas._chart.destroy();
    const revenues = quarters.map(q => q.winst_verlies?.omzet || 0);
    const profits = quarters.map(q => q.winst_verlies?.netto_winst || 0);

    revCanvas._chart = new Chart(revCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Revenue", data: revenues, backgroundColor: "#2563ebcc", borderRadius: 4 },
          { label: "Net Profit", data: profits, backgroundColor: "#16a34acc", borderRadius: 4 }
        ]
      },
      plugins: [{ id:"dl-qrev", afterDatasetsDraw(chart) {
        chart.data.datasets.forEach((ds,i) => {
          chart.getDatasetMeta(i).data.forEach((bar,idx) => {
            const val = ds.data[idx]; if(!val) return;
            chart.ctx.save(); chart.ctx.fillStyle="#555"; chart.ctx.font="10px sans-serif"; chart.ctx.textAlign="center";
            chart.ctx.fillText("€"+(val/1000).toFixed(1)+"K", bar.x, bar.y-4); chart.ctx.restore();
          });
        });
      }}],
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"bottom",labels:{boxWidth:12}}},
        scales:{x:{grid:{display:false}},y:{ticks:{callback:v=>"€ "+(v/1000).toFixed(0)+"K"}}} }
    });
  }

  // Costs breakdown chart (stacked)
  const costsCanvas = document.getElementById("q-costs-chart");
  if (costsCanvas) {
    if (costsCanvas._chart) costsCanvas._chart.destroy();
    const categories = ["Inkoopkosten","Marketing/Ads","Software/Tools","Verzekeringen","Accountant","Kantoor/Opslag","Verzendkosten"];
    const colors = ["#ef4444","#f59e0b","#8b5cf6","#06b6d4","#ec4899","#84cc16","#f97316"];
    const datasets = categories.map((cat,i) => ({
      label: cat,
      data: quarters.map(q => q.winst_verlies?.kosten_samenvatting?.[cat] || 0),
      backgroundColor: colors[i],
      stack: "costs"
    }));

    costsCanvas._chart = new Chart(costsCanvas.getContext("2d"), {
      type: "bar",
      data: { labels, datasets },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:"bottom",labels:{boxWidth:10,font:{size:10}}}},
        scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,ticks:{callback:v=>"€ "+(v/1000).toFixed(0)+"K"}}} }
    });
  }

  // Balance sheet trend
  const balCanvas = document.getElementById("q-balance-chart");
  if (balCanvas) {
    if (balCanvas._chart) balCanvas._chart.destroy();
    balCanvas._chart = new Chart(balCanvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label:"Bank Balance", data:quarters.map(q=>q.balans?.liquide_middelen||0), borderColor:"#2563eb", backgroundColor:"rgba(37,99,235,.1)", fill:true, tension:.3, pointRadius:5, pointBackgroundColor:"#2563eb" },
          { label:"Equity", data:quarters.map(q=>q.balans?.eigen_vermogen||0), borderColor:"#16a34a", backgroundColor:"rgba(22,163,74,.1)", fill:true, tension:.3, pointRadius:5, pointBackgroundColor:"#16a34a" }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:"bottom",labels:{boxWidth:12}}},
        scales:{y:{ticks:{callback:v=>"€ "+(v/1000).toFixed(0)+"K"}}} }
    });
  }
}

function openQuarterlyUpload(entitySlug) {
  document.getElementById("q-entity").value = entitySlug;
  document.getElementById("q-error").style.display = "none";
  document.getElementById("q-success").style.display = "none";
  document.getElementById("q-file").value = "";
  openModal("modal-quarterly");
}

async function uploadQuarterly() {
  const entity = document.getElementById("q-entity").value;
  const year = document.getElementById("q-year").value;
  const quarter = document.getElementById("q-quarter").value;
  const file = document.getElementById("q-file").files[0];
  const errEl = document.getElementById("q-error");
  const succEl = document.getElementById("q-success");

  errEl.style.display = "none";
  succEl.style.display = "none";

  if (!file) {
    errEl.textContent = "Select a PDF file";
    errEl.style.display = "";
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("entity", entity);
  formData.append("year", year);
  formData.append("quarter", quarter);

  try {
    const resp = await fetch("/api/quarterly/upload", { method: "POST", body: formData });
    const data = await resp.json();
    if (data.error) {
      errEl.textContent = data.error;
      errEl.style.display = "";
    } else {
      const periodLabel = quarter === "annual" ? `${year} (Annual)` : `Q${quarter} ${year}`;
      succEl.textContent = `${periodLabel} uploaded successfully! Revenue: ${eur(data.data?.winst_verlies?.omzet || 0)}`;
      succEl.style.display = "";
      setTimeout(() => {
        closeModal("modal-quarterly");
        openEntityDetail(entity);
      }, 1500);
    }
  } catch (e) {
    errEl.textContent = "Upload failed: " + e.message;
    errEl.style.display = "";
  }
}

// ── Helper functions ───────────────────────────────────────────
function eur(val) {
  if (val == null || isNaN(val)) return "–";
  const abs = Math.abs(Math.round(val));
  const str = "€ " + abs.toLocaleString("nl-NL");
  return val < 0 ? "-" + str : str;
}

function formatDate(iso) {
  if (!iso) return "–";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function sourceLabel(source, info) {
  if (source === "not_configured") return "Not yet configured";
  if (source === "error") return "Error";
  if (source === "manual") return "Manual · " + (info ? formatDate(info) : "not yet filled in");
  if (source === "google_sheets") return "Google Sheets · " + (info ? formatDate(info) : "");
  return source;
}

function setPeriod(p) {
  currentPeriod = p;
  document.querySelectorAll(".period-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.period === p);
  });
  loadDashboard();
}

function updateLastRefresh(iso) {
  const el = document.getElementById("last-refresh");
  if (el && iso) el.textContent = "Refreshed at " + formatDate(iso);
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

// Supplement Modal
function openSupplementModal() {
  const now = new Date();
  document.getElementById("supp-year").value = now.getFullYear();
  document.getElementById("supp-month").value = now.getMonth() + 1;
  openModal("modal-supplement");
}

async function saveSupplementForm() {
  const year = parseInt(document.getElementById("supp-year").value);
  const month = parseInt(document.getElementById("supp-month").value);
  const revenue = parseFloat(document.getElementById("supp-revenue").value) || 0;
  const expenses = parseFloat(document.getElementById("supp-expenses").value) || 0;

  try {
    await saveSupplementMonth({ year, month, revenue, expenses });
    closeModal("modal-supplement");
    loadDashboard();
  } catch (e) {
    alert("Error saving: " + e.message);
  }
}

// Revolut Modal
async function openRevolutModal() {
  const data = await getRevolutHoldings();
  const holdings = data.holdings || [];

  const rows = holdings.length > 0 ? holdings : [{ symbol: "BTC", amount: "", value_eur: "" }];
  document.getElementById("revolut-rows").innerHTML = rows.map((h, i) => `
    <div class="flex gap-2" style="margin-bottom:8px" id="revolut-row-${i}">
      <input class="form-input" style="width:80px" placeholder="BTC" value="${h.symbol || ""}" id="rev-sym-${i}">
      <input class="form-input" placeholder="Value (€)" value="${h.value_eur || ""}" id="rev-val-${i}" type="number">
      <button onclick="removeRevolutRow(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted)">✕</button>
    </div>
  `).join("");

  openModal("modal-revolut");
}

function addRevolutRow() {
  const container = document.getElementById("revolut-rows");
  const i = container.children.length;
  const div = document.createElement("div");
  div.className = "flex gap-2";
  div.style.marginBottom = "8px";
  div.id = `revolut-row-${i}`;
  div.innerHTML = `
    <input class="form-input" style="width:80px" placeholder="ETH" id="rev-sym-${i}">
    <input class="form-input" placeholder="Value (€)" id="rev-val-${i}" type="number">
    <button onclick="removeRevolutRow(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted)">✕</button>
  `;
  container.appendChild(div);
}

function removeRevolutRow(i) {
  document.getElementById(`revolut-row-${i}`)?.remove();
}

async function saveRevolutForm() {
  const rows = document.getElementById("revolut-rows").children;
  const holdings = [];
  for (let i = 0; i < rows.length; i++) {
    const sym = document.getElementById(`rev-sym-${i}`)?.value?.trim();
    const val = parseFloat(document.getElementById(`rev-val-${i}`)?.value) || 0;
    if (sym) holdings.push({ symbol: sym, value_eur: val });
  }

  try {
    await saveRevolutHoldings(holdings);
    closeModal("modal-revolut");
    loadDashboard();
  } catch (e) {
    alert("Error: " + e.message);
  }
}

// Savings modal
function openSavingsModal() { openModal("modal-savings"); }

async function saveSavingsForm() {
  const val = parseFloat(document.getElementById("savings-balance").value) || 0;
  try {
    await saveInvestments({ savings_balance: val });
    closeModal("modal-savings");
    loadDashboard();
  } catch (e) { alert("Error: " + e.message); }
}

// ── Loans modal ──────────────────────────────────────────────────────────────

async function openLoansModal() {
  const data = await getLoanItems();
  const items = data.items || [];
  const rows = items.length > 0 ? items : [{ name: "", amount_eur: "", deadline: "" }];

  document.getElementById("loans-rows").innerHTML = rows.map((l, i) => loanRowHtml(i, l)).join("");
  updateLoansTotal();
  openModal("modal-loans");
}

function loanRowHtml(i, l = {}) {
  return `<tr id="loan-row-${i}">
    <td style="padding:5px 4px"><input class="form-input" style="width:100%;font-size:14px" value="${l.name || ""}" id="loan-name-${i}" placeholder="Name"></td>
    <td style="padding:5px 4px"><input class="form-input" style="width:100%;font-size:14px" type="number" value="${l.amount_eur || ""}" id="loan-val-${i}" placeholder="0" oninput="updateLoansTotal()"></td>
    <td style="padding:5px 4px;position:relative">
      <input class="form-input" style="width:100%;font-size:14px;cursor:pointer" readonly value="${l.deadline ? formatLoanDate(l.deadline) : ''}" id="loan-deadline-display-${i}" placeholder="No deadline" onclick="document.getElementById('loan-deadline-${i}').showPicker()">
      <input type="date" value="${l.deadline || ''}" id="loan-deadline-${i}" style="position:absolute;opacity:0;width:0;height:0" onchange="document.getElementById('loan-deadline-display-${i}').value=formatLoanDate(this.value)">
    </td>
    <td style="padding:5px 4px"><button onclick="removeLoanRow(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:16px">✕</button></td>
  </tr>`;
}

function addLoanRow() {
  const tbody = document.getElementById("loans-rows");
  const i = tbody.children.length;
  tbody.insertAdjacentHTML("beforeend", loanRowHtml(i));
}

function removeLoanRow(i) {
  document.getElementById(`loan-row-${i}`)?.remove();
  updateLoansTotal();
}

function formatLoanDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return dateStr; }
}

function updateLoansTotal() {
  let total = 0;
  const rows = document.getElementById("loans-rows").children;
  for (const row of rows) {
    const input = row.querySelector('input[type="number"]');
    if (input) total += parseFloat(input.value) || 0;
  }
  document.getElementById("loans-total").textContent = eur(total);
}

async function saveLoansForm() {
  const rows = document.getElementById("loans-rows").children;
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const name = document.getElementById(`loan-name-${i}`)?.value?.trim();
    const val = parseFloat(document.getElementById(`loan-val-${i}`)?.value) || 0;
    const deadline = document.getElementById(`loan-deadline-${i}`)?.value || "";
    if (name) items.push({ name, amount_eur: val, deadline });
  }

  try {
    await saveLoanItems(items);
    closeModal("modal-loans");
    loadDashboard();
  } catch (e) { alert("Error: " + e.message); }
}

// ── Degiro multi-step login ──────────────────────────────────────────────────

function openDegiroLoginModal() {
  degiroStopPolling();
  document.getElementById("degiro-step-1").style.display = "";
  document.getElementById("degiro-step-2").style.display = "none";
  document.getElementById("degiro-step-app-confirm").style.display = "none";
  document.getElementById("degiro-step-success").style.display = "none";
  document.getElementById("degiro-step1-error").style.display = "none";
  document.getElementById("degiro-username").value = "";
  document.getElementById("degiro-password").value = "";
  document.getElementById("degiro-otp").value = "";
  openModal("modal-degiro-login");
  setTimeout(() => document.getElementById("degiro-username").focus(), 100);
}

function degiroBackToStep1() {
  degiroStopPolling();
  document.getElementById("degiro-step-2").style.display = "none";
  document.getElementById("degiro-step-app-confirm").style.display = "none";
  document.getElementById("degiro-step-1").style.display = "";
  document.getElementById("degiro-step1-error").style.display = "none";
}

let degiroPollingInterval = null;

function degiroStartPolling() {
  degiroStopPolling();
  document.getElementById("degiro-polling-status").textContent = "Waiting for approval...";
  document.getElementById("degiro-confirm-error").style.display = "none";
  degiroPollingInterval = setInterval(() => submitDegiroConfirm(), 5000);
}

function degiroStopPolling() {
  if (degiroPollingInterval) {
    clearInterval(degiroPollingInterval);
    degiroPollingInterval = null;
  }
}

async function submitDegiroConfirm() {
  const statusEl = document.getElementById("degiro-polling-status");
  const errEl = document.getElementById("degiro-confirm-error");

  statusEl.textContent = "Checking...";

  try {
    const result = await degiroLoginConfirm();

    if (result.status === "logged_in") {
      degiroStopPolling();
      document.getElementById("degiro-step-app-confirm").style.display = "none";
      document.getElementById("degiro-step-success").style.display = "";
    } else if (result.status === "pending") {
      statusEl.textContent = "Waiting for approval...";
    } else {
      degiroStopPolling();
      errEl.textContent = result.message || "Connection failed.";
      errEl.style.display = "";
      statusEl.textContent = "Failed";
    }
  } catch (e) {
    statusEl.textContent = "Connection error, retrying...";
  }
}

async function submitDegiroStep1() {
  const username = document.getElementById("degiro-username").value.trim();
  const password = document.getElementById("degiro-password").value.trim();
  const errEl = document.getElementById("degiro-step1-error");
  const btn = document.getElementById("degiro-step1-btn");

  if (!username || !password) {
    errEl.textContent = "Enter username and password.";
    errEl.style.display = "";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Loading...";
  errEl.style.display = "none";

  try {
    const result = await degiroLoginStart(username, password);

    if (result.status === "logged_in") {
      document.getElementById("degiro-step-1").style.display = "none";
      document.getElementById("degiro-step-success").style.display = "";
    } else if (result.status === "app_confirm_required") {
      document.getElementById("degiro-step-1").style.display = "none";
      document.getElementById("degiro-step-app-confirm").style.display = "";
      degiroStartPolling();
    } else if (result.status === "otp_required") {
      document.getElementById("degiro-step-1").style.display = "none";
      document.getElementById("degiro-step-2").style.display = "";
      setTimeout(() => document.getElementById("degiro-otp").focus(), 100);
    } else {
      errEl.textContent = result.message || "Login failed. Check your credentials.";
      errEl.style.display = "";
    }
  } catch (e) {
    errEl.textContent = "Connection error: " + e.message;
    errEl.style.display = "";
  } finally {
    btn.disabled = false;
    btn.textContent = "Login →";
  }
}

async function submitDegiroStep2() {
  const otp = document.getElementById("degiro-otp").value.trim();
  const errEl = document.getElementById("degiro-step2-error");
  const btn = document.getElementById("degiro-step2-btn");

  if (!otp || otp.length < 4) {
    errEl.textContent = "Enter the verification code.";
    errEl.style.display = "";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying...";
  errEl.style.display = "none";

  try {
    const result = await degiroLoginVerify(otp);

    if (result.status === "logged_in") {
      document.getElementById("degiro-step-2").style.display = "none";
      document.getElementById("degiro-step-success").style.display = "";
    } else {
      errEl.textContent = result.message || "Verification failed.";
      errEl.style.display = "";
      document.getElementById("degiro-otp").value = "";
      document.getElementById("degiro-otp").focus();
    }
  } catch (e) {
    errEl.textContent = "Error: " + e.message;
    errEl.style.display = "";
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect ✓";
  }
}

// Enter key support for Degiro modal
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (document.getElementById("modal-degiro-login")?.classList.contains("open")) {
    const step2 = document.getElementById("degiro-step-2");
    if (step2 && step2.style.display !== "none") {
      submitDegiroStep2();
    } else if (document.getElementById("degiro-step-1")?.style.display !== "none") {
      submitDegiroStep1();
    }
  }
});

// Close modals on outside click
document.addEventListener("click", e => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("open");
  }
});
