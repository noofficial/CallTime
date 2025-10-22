import {
  managerFetch,
  UnauthorizedError,
  getManagerToken,
  clearManagerSession,
} from "./auth.js";

const DONOR_TYPE_LABELS = {
  individual: "Individual",
  business: "Business",
  campaign: "Campaign / PAC",
};

const DEFAULT_EMPTY_MESSAGE = "Run a search to see contributions organized by donor.";

const state = {
  filters: getDefaultFilters(),
  options: {
    candidates: [],
    years: [],
  },
  loading: false,
  error: "",
  hasExecutedSearch: false,
  results: null,
};

const elements = {
  form: document.getElementById("contribution-search-form"),
  candidate: document.getElementById("contribution-search-candidate"),
  year: document.getElementById("contribution-search-year"),
  reset: document.getElementById("contribution-search-reset"),
  status: document.getElementById("contribution-search-status"),
  total: document.getElementById("contribution-search-total"),
  count: document.getElementById("contribution-search-count"),
  donors: document.getElementById("contribution-search-donors"),
  list: document.getElementById("contribution-search-list"),
  empty: document.getElementById("contribution-search-empty"),
  years: document.getElementById("contribution-search-years"),
};

ensureManagerAccess();
init();

function ensureManagerAccess() {
  if (!getManagerToken()) {
    window.location.href = "manager.html";
  }
}

function handleUnauthorized() {
  clearManagerSession();
  window.location.href = "manager.html";
}

function getDefaultFilters() {
  return {
    candidate: "",
    year: "",
  };
}

function bindEvents() {
  elements.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    executeSearch();
  });
  elements.reset?.addEventListener("click", (event) => {
    event.preventDefault();
    resetFilters();
  });
}

async function init() {
  bindEvents();
  await loadFilterOptions();
  renderFilterOptions();
  render();
}

async function loadFilterOptions() {
  try {
    const response = await managerFetch("/api/giving/filters");
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || "Unable to load contribution filters.");
    }
    const payload = await response.json();
    state.options.candidates = Array.isArray(payload?.candidates)
      ? payload.candidates.map(cleanString).filter(Boolean)
      : [];
    state.options.years = Array.isArray(payload?.years)
      ? payload.years
          .map((year) => (Number.isFinite(Number(year)) ? Number(year) : null))
          .filter((year) => year !== null)
          .sort((a, b) => b - a)
      : [];
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      handleUnauthorized();
      return;
    }
    console.error("Failed to load contribution filters", error);
    state.error = error?.message || "Unable to load contribution filters.";
    renderStatus();
  }
}

function renderFilterOptions() {
  renderCandidateOptions();
  renderYearOptions();
}

function renderCandidateOptions() {
  const select = elements.candidate;
  if (!(select instanceof HTMLSelectElement)) return;
  const current = state.filters.candidate;
  const fragment = document.createDocumentFragment();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Any candidate";
  fragment.append(defaultOption);
  state.options.candidates
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((candidate) => {
      const option = document.createElement("option");
      option.value = candidate;
      option.textContent = candidate;
      if (candidate === current) {
        option.selected = true;
      }
      fragment.append(option);
    });
  select.innerHTML = "";
  select.append(fragment);
}

function renderYearOptions() {
  const select = elements.year;
  if (!(select instanceof HTMLSelectElement)) return;
  const current = state.filters.year;
  const fragment = document.createDocumentFragment();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Any year";
  fragment.append(defaultOption);
  state.options.years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    if (String(year) === current) {
      option.selected = true;
    }
    fragment.append(option);
  });
  select.innerHTML = "";
  select.append(fragment);
}

function collectFilters() {
  return {
    candidate: cleanString(elements.candidate?.value),
    year: cleanString(elements.year?.value),
  };
}

function resetFilters() {
  state.filters = getDefaultFilters();
  state.results = null;
  state.hasExecutedSearch = false;
  state.error = "";
  if (elements.form instanceof HTMLFormElement) {
    elements.form.reset();
  }
  renderFilterOptions();
  render();
}

async function executeSearch() {
  const filters = collectFilters();
  if (!filters.candidate && !filters.year) {
    state.error = "Select a candidate or year before searching.";
    state.hasExecutedSearch = false;
    state.results = null;
    render();
    return;
  }

  state.filters = filters;
  state.loading = true;
  state.error = "";
  state.hasExecutedSearch = true;
  renderStatus();

  const params = new URLSearchParams();
  if (filters.candidate) {
    params.set("candidate", filters.candidate);
  }
  if (filters.year) {
    params.set("year", filters.year);
  }

  try {
    const url = `/api/giving/search?${params.toString()}`;
    const response = await managerFetch(url);
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || "Unable to search contributions.");
    }
    const payload = await response.json();
    state.results = normalizeSearchResults(payload);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      handleUnauthorized();
      return;
    }
    console.error("Failed to search contributions", error);
    state.error = error?.message || "Unable to search contributions.";
    state.results = null;
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  renderStatus();
  renderSummary();
  renderResults();
}

function renderStatus() {
  if (!elements.status) return;
  if (state.loading) {
    elements.status.textContent = "Searching contributions…";
    elements.status.classList.remove("hidden");
  } else if (state.error) {
    elements.status.textContent = state.error;
    elements.status.classList.remove("hidden");
  } else {
    elements.status.textContent = "";
    elements.status.classList.add("hidden");
  }
}

function renderSummary() {
  const totals = state.results?.totals || { totalAmount: 0, contributionCount: 0, donorCount: 0 };
  if (elements.total) {
    elements.total.textContent = `$${formatCurrency(totals.totalAmount)}`;
  }
  if (elements.count) {
    elements.count.textContent = formatNumber(totals.contributionCount || 0);
  }
  if (elements.donors) {
    elements.donors.textContent = formatNumber(totals.donorCount || 0);
  }
}

function renderResults() {
  const list = elements.list;
  const empty = elements.empty;
  const yearsContainer = elements.years;
  if (!list || !empty || !yearsContainer) return;

  list.innerHTML = "";
  yearsContainer.innerHTML = "";
  list.classList.add("hidden");
  yearsContainer.classList.add("hidden");
  empty.innerHTML = `<p>${DEFAULT_EMPTY_MESSAGE}</p>`;

  if (!state.hasExecutedSearch) {
    empty.classList.remove("hidden");
    return;
  }

  const donors = Array.isArray(state.results?.donors) ? state.results.donors : [];
  if (!donors.length) {
    empty.innerHTML = `<p>No contributions match the selected filters.</p>`;
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  donors.forEach((donor) => {
    list.append(renderDonorResult(donor));
  });
  list.scrollTop = 0;
  list.classList.remove("hidden");

  const years = Array.isArray(state.results?.years) ? state.results.years : [];
  if (years.length) {
    yearsContainer.append(renderYearSummary(years));
    yearsContainer.classList.remove("hidden");
  }
}

function renderDonorResult(donor) {
  const item = document.createElement("article");
  item.className = "contribution-search__item";

  const header = document.createElement("header");
  header.className = "contribution-search__item-header";

  const title = document.createElement("h3");
  title.className = "contribution-search__item-title";
  title.textContent = donor?.donorName || "Unnamed donor";
  header.append(title);

  const meta = document.createElement("p");
  meta.className = "contribution-search__item-meta";
  const typeLabel = DONOR_TYPE_LABELS[donor?.donorType] || "Donor";
  const contributionCount = formatNumber(toNumber(donor?.contributionCount));
  meta.textContent = `${typeLabel} • $${formatCurrency(donor?.totalAmount)} across ${contributionCount} contribution${
    toNumber(donor?.contributionCount) === 1 ? "" : "s"
  }`;
  header.append(meta);

  item.append(header);

  const body = document.createElement("div");
  body.className = "contribution-search__item-body";

  const contributions = Array.isArray(donor?.contributions) ? donor.contributions : [];
  if (contributions.length) {
    body.append(renderContributionTable(contributions));
  } else {
    const empty = document.createElement("p");
    empty.className = "contribution-search__item-empty";
    empty.textContent = "No individual contributions recorded.";
    body.append(empty);
  }

  item.append(body);
  return item;
}

function renderContributionTable(contributions) {
  const table = document.createElement("table");
  table.className = "contribution-search__table contribution-card__table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Year", "Candidate", "Type", "Amount"].forEach((label) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  contributions.forEach((entry) => {
    const row = document.createElement("tr");

    const yearCell = document.createElement("td");
    yearCell.textContent = entry?.year === null ? "Unknown" : String(entry?.year ?? "—");
    row.append(yearCell);

    const candidateCell = document.createElement("td");
    candidateCell.textContent = entry?.candidate || "—";
    row.append(candidateCell);

    const typeCell = document.createElement("td");
    typeCell.textContent = entry?.isInKind ? "In-kind" : "Monetary";
    row.append(typeCell);

    const amountCell = document.createElement("td");
    amountCell.textContent = `$${formatCurrency(entry?.amount)}`;
    if (entry?.isInKind) {
      amountCell.classList.add("contribution-search__amount--inkind");
    }
    row.append(amountCell);

    tbody.append(row);
  });
  table.append(tbody);

  return table;
}

function renderYearSummary(years) {
  const container = document.createElement("div");
  container.className = "contribution-search__years-table";

  const title = document.createElement("h3");
  title.className = "contribution-search__years-title";
  title.textContent = "Yearly breakdown";
  container.append(title);

  const table = document.createElement("table");
  table.className =
    "contribution-search__table contribution-search__table--compact contribution-card__table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Year", "Donors", "Contributions", "Total raised"].forEach((label) => {
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
    yearCell.textContent = entry?.year === null ? "Unknown" : String(entry?.year ?? "—");
    row.append(yearCell);

    const donorCell = document.createElement("td");
    donorCell.textContent = formatNumber(toNumber(entry?.donorCount));
    row.append(donorCell);

    const countCell = document.createElement("td");
    countCell.textContent = formatNumber(toNumber(entry?.contributionCount));
    row.append(countCell);

    const amountCell = document.createElement("td");
    amountCell.textContent = `$${formatCurrency(entry?.totalAmount)}`;
    row.append(amountCell);

    tbody.append(row);
  });
  table.append(tbody);

  container.append(table);
  return container;
}

function normalizeSearchResults(payload) {
  const totals = payload?.totals || {};
  return {
    totals: {
      totalAmount: toNumber(totals.totalAmount),
      contributionCount: toNumber(totals.contributionCount),
      donorCount: toNumber(totals.donorCount),
    },
    donors: Array.isArray(payload?.donors)
      ? payload.donors.map((donor) => ({
          donorName: donor?.donorName || donor?.donor_name || "Unnamed donor",
          donorType: donor?.donorType || donor?.donor_type || "individual",
          totalAmount: toNumber(donor?.totalAmount ?? donor?.total_amount),
          contributionCount: toNumber(donor?.contributionCount ?? donor?.contribution_count),
          contributions: Array.isArray(donor?.contributions)
            ? donor.contributions.map((entry) => ({
                year: Number.isFinite(Number(entry?.year)) ? Number(entry.year) : null,
                amount: toNumber(entry?.amount),
                candidate: entry?.candidate || "",
                isInKind: Boolean(entry?.isInKind ?? entry?.is_inkind ?? entry?.inkind),
              }))
            : [],
        }))
      : [],
    years: Array.isArray(payload?.years)
      ? payload.years.map((entry) => ({
          year: Number.isFinite(Number(entry?.year)) ? Number(entry.year) : null,
          donorCount: toNumber(entry?.donorCount ?? entry?.donor_count),
          contributionCount: toNumber(entry?.contributionCount ?? entry?.contribution_count),
          totalAmount: toNumber(entry?.totalAmount ?? entry?.total_amount),
        }))
      : [],
  };
}

function cleanString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
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
