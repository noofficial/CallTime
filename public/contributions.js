import {
  managerFetch,
  UnauthorizedError,
  getManagerToken,
  clearManagerSession,
} from "./auth.js";

const state = {
  loading: false,
  error: "",
  clients: [],
  generatedAt: "",
};

const elements = {
  refresh: document.getElementById("contribution-refresh"),
  status: document.getElementById("contribution-status"),
  totalRaised: document.getElementById("contribution-total-raised"),
  companyShare: document.getElementById("contribution-company-share"),
  totalContributions: document.getElementById("contribution-total-contributions"),
  activeClients: document.getElementById("contribution-active-clients"),
  refreshedAt: document.getElementById("contribution-refreshed"),
  list: document.getElementById("contribution-client-list"),
  empty: document.getElementById("contribution-empty"),
};

ensureManagerAccess();
init();

function ensureManagerAccess() {
  if (!getManagerToken()) {
    window.location.href = "manager.html";
  }
}

function init() {
  bindEvents();
  loadContributions();
}

function bindEvents() {
  elements.refresh?.addEventListener("click", (event) => {
    event.preventDefault();
    loadContributions();
  });
}

async function loadContributions() {
  state.loading = true;
  state.error = "";
  renderStatus();
  try {
    const response = await managerFetch("/api/manager/giving/clients");
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || "Unable to load contribution data.");
    }
    const payload = await response.json();
    state.clients = Array.isArray(payload?.clients) ? payload.clients : [];
    state.generatedAt = payload?.generatedAt || new Date().toISOString();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      handleUnauthorized();
      return;
    }
    console.error("Failed to load contribution data", error);
    state.error = error?.message || "Unable to load contribution data.";
  } finally {
    state.loading = false;
    render();
  }
}

function handleUnauthorized() {
  clearManagerSession();
  window.location.href = "manager.html";
}

function render() {
  renderSummary();
  renderClients();
  renderStatus();
}

function renderSummary() {
  const totalAmount = state.clients.reduce((sum, client) => sum + toNumber(client?.totalAmount), 0);
  const companyShare = totalAmount * 0.1;
  const totalContributions = state.clients.reduce(
    (sum, client) => sum + toNumber(client?.contributionCount),
    0,
  );
  const activeClients = state.clients.reduce(
    (sum, client) => sum + (toNumber(client?.contributionCount) > 0 ? 1 : 0),
    0,
  );

  if (elements.totalRaised) {
    elements.totalRaised.textContent = `$${formatCurrency(totalAmount)}`;
  }
  if (elements.companyShare) {
    elements.companyShare.textContent = `$${formatCurrency(companyShare)}`;
  }
  if (elements.totalContributions) {
    elements.totalContributions.textContent = formatNumber(totalContributions);
  }
  if (elements.activeClients) {
    elements.activeClients.textContent = formatNumber(activeClients);
  }
  if (elements.refreshedAt) {
    elements.refreshedAt.textContent = state.generatedAt ? formatDateTime(state.generatedAt) : "—";
  }
}

function renderClients() {
  if (!elements.list) return;
  elements.list.innerHTML = "";

  const hasClients = Array.isArray(state.clients) && state.clients.length > 0;
  if (elements.empty) {
    elements.empty.classList.toggle("hidden", hasClients);
  }
  if (!hasClients) {
    return;
  }

  state.clients.forEach((client) => {
    elements.list.appendChild(renderClientCard(client));
  });
}

function renderClientCard(client) {
  const card = document.createElement("article");
  card.className = "contribution-card";

  const header = document.createElement("header");
  header.className = "contribution-card__header";

  const title = document.createElement("h3");
  title.className = "contribution-card__title";
  title.textContent = client?.displayName || client?.candidate || client?.name || "Unnamed client";
  header.append(title);

  const subtitleParts = [];
  if (client?.candidate && client?.name && client.candidate !== client.name) {
    subtitleParts.push(client.name);
  }
  if (!subtitleParts.length && client?.candidate) {
    subtitleParts.push(client.candidate);
  }
  if (subtitleParts.length) {
    const subtitle = document.createElement("p");
    subtitle.className = "contribution-card__subtitle";
    subtitle.textContent = subtitleParts.join(" • ");
    header.append(subtitle);
  }

  card.append(header);

  const body = document.createElement("div");
  body.className = "contribution-card__body";

  const metrics = document.createElement("div");
  metrics.className = "contribution-card__metrics";
  metrics.append(createMetric("Total raised", `$${formatCurrency(client?.totalAmount)}`));
  metrics.append(
    createMetric("Contributions", formatNumber(toNumber(client?.contributionCount))),
  );
  metrics.append(
    createMetric("Latest update", formatDateTime(client?.lastContributionAt)),
  );
  body.append(metrics);

  const years = Array.isArray(client?.years) ? client.years : [];
  if (years.length) {
    const table = document.createElement("table");
    table.className = "contribution-card__table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Year", "Total raised", "Contributions"].forEach((label) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    years.forEach((entry) => {
      const row = document.createElement("tr");
      const yearCell = document.createElement("td");
      yearCell.textContent = entry?.year === null ? "Unknown" : String(entry.year);
      row.append(yearCell);

      const amountCell = document.createElement("td");
      amountCell.textContent = `$${formatCurrency(entry?.totalAmount)}`;
      row.append(amountCell);

      const countCell = document.createElement("td");
      countCell.textContent = formatNumber(toNumber(entry?.contributionCount));
      row.append(countCell);

      tbody.append(row);
    });
    table.append(tbody);
    body.append(table);
  } else {
    const empty = document.createElement("p");
    empty.className = "contribution-card__empty";
    empty.textContent = "No recorded contributions yet.";
    body.append(empty);
  }

  card.append(body);
  return card;
}

function createMetric(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "contribution-metric";

  const valueEl = document.createElement("div");
  valueEl.className = "contribution-metric__value";
  valueEl.textContent = value || "—";
  wrapper.append(valueEl);

  const labelEl = document.createElement("div");
  labelEl.className = "contribution-metric__label";
  labelEl.textContent = label;
  wrapper.append(labelEl);

  return wrapper;
}

function renderStatus() {
  if (elements.refresh) {
    elements.refresh.disabled = state.loading;
  }
  if (!elements.status) return;

  if (state.loading) {
    elements.status.textContent = "Loading contribution data…";
    elements.status.classList.remove("hidden");
  } else if (state.error) {
    elements.status.textContent = state.error;
    elements.status.classList.remove("hidden");
  } else {
    elements.status.textContent = "";
    elements.status.classList.add("hidden");
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString(undefined) : "0";
}

function formatCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  const hasFraction = Math.abs(Math.round(numeric * 100) - Math.round(numeric) * 100) > 0;
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const normalized = String(value).replace(" ", "T");
    date = new Date(normalized);
  }
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
