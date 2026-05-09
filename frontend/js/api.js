// API communicatie met de Flask backend
const API_BASE = window.location.hostname === "localhost" ? "http://localhost:5050" : "";

async function fetchDashboard(period = "mtd") {
  const resp = await fetch(`${API_BASE}/api/dashboard?period=${period}`);
  if (!resp.ok) throw new Error(`API fout: ${resp.status}`);
  return await resp.json();
}

async function saveSupplementMonth(data) {
  const resp = await fetch(`${API_BASE}/api/supplement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!resp.ok) throw new Error("Opslaan mislukt");
  return await resp.json();
}

async function saveRevolutHoldings(holdings) {
  const resp = await fetch(`${API_BASE}/api/revolut`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holdings })
  });
  if (!resp.ok) throw new Error("Opslaan mislukt");
  return await resp.json();
}

async function getRevolutHoldings() {
  const resp = await fetch(`${API_BASE}/api/revolut`);
  if (!resp.ok) return { holdings: [] };
  return await resp.json();
}

async function saveInvestments(data) {
  const resp = await fetch(`${API_BASE}/api/investments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!resp.ok) throw new Error("Opslaan mislukt");
  return await resp.json();
}

async function getSpAgency() {
  const resp = await fetch(`${API_BASE}/api/spagency`);
  if (!resp.ok) return { months: [] };
  return await resp.json();
}

async function saveSpAgency(months) {
  const resp = await fetch(`${API_BASE}/api/spagency`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ months })
  });
  if (!resp.ok) throw new Error("Save failed");
  return await resp.json();
}

async function getLoanItems() {
  const resp = await fetch(`${API_BASE}/api/loans`);
  if (!resp.ok) return { items: [] };
  return await resp.json();
}

async function saveLoanItems(items) {
  const resp = await fetch(`${API_BASE}/api/loans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
  if (!resp.ok) throw new Error("Save failed");
  return await resp.json();
}

async function degiroLoginStart(username, password) {
  const resp = await fetch(`${API_BASE}/api/degiro/login/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return await resp.json();
}

async function degiroLoginConfirm() {
  const resp = await fetch(`${API_BASE}/api/degiro/login/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  return await resp.json();
}

async function degiroLoginVerify(otp) {
  const resp = await fetch(`${API_BASE}/api/degiro/login/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ otp })
  });
  return await resp.json();
}

async function degiroGetStatus() {
  const resp = await fetch(`${API_BASE}/api/degiro/status`);
  return await resp.json();
}

async function degiroRefresh() {
  const resp = await fetch(`${API_BASE}/api/degiro/refresh`, { method: "POST" });
  return await resp.json();
}
