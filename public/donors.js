import { CallTimeDatabase, DATABASE_KEY } from "./database.js";

const db = new CallTimeDatabase();

const state = {
  donors: [],
  filtered: [],
  clients: [],
  assignments: new Map(),
  selectedDonorId: null,
  searchTerm: "",
  clientFilter: "",
};

const elements = {
  clientFilter: document.getElementById("database-client-filter"),
  search: document.getElementById("database-search"),
  list: document.getElementById("database-list"),
  detail: document.getElementById("database-detail"),
  empty: document.getElementById("database-empty"),
  export: document.getElementById("export-donors"),
};

init();

function init() {
  bindEvents();
  loadData();
  const params = new URLSearchParams(window.location.search);
  const initialDonor = params.get("donor");
  if (initialDonor) {
    selectDonor(initialDonor);
  }
  render();
}

function bindEvents() {
  elements.search?.addEventListener("input", () => {
    state.searchTerm = elements.search.value.trim().toLowerCase();
    applyFilters();
    render();
  });
  elements.clientFilter?.addEventListener("change", () => {
    state.clientFilter = elements.clientFilter.value;
    applyFilters();
    render();
  });
  elements.list?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-donor-id]");
    if (!button) return;
    const donorId = button.getAttribute("data-donor-id");
    selectDonor(donorId);
    render();
  });
  elements.export?.addEventListener("click", (event) => {
    event.preventDefault();
    exportDonors();
  });
  window.addEventListener("storage", handleStorageSync);
}

function handleStorageSync(event) {
  if (event.key && event.key !== DATABASE_KEY) return;
  loadData();
  applyFilters();
  render();
}

function loadData() {
  state.clients = db.getClients();
  state.donors = db
    .getAllDonors()
    .sort(
      (a, b) =>
        (a.lastName || "").localeCompare(b.lastName || "") ||
        (a.firstName || "").localeCompare(b.firstName || ""),
    );
  state.assignments = buildAssignmentMap(db.getAssignments());
  renderClientFilter();
  applyFilters();
}

function buildAssignmentMap(assignments = {}) {
  const map = new Map();
  Object.entries(assignments).forEach(([clientId, donorIds]) => {
    donorIds.forEach((donorId) => {
      if (!map.has(donorId)) {
        map.set(donorId, new Set());
      }
      map.get(donorId).add(clientId);
    });
  });
  return map;
}

function applyFilters() {
  const term = state.searchTerm;
  const filterId = state.clientFilter;
  state.filtered = state.donors.filter((donor) => {
    if (term) {
      const haystack = [
        donor.name,
        donor.firstName,
        donor.lastName,
        donor.email,
        donor.phone,
        donor.city,
        donor.company,
        donor.industry,
        donor.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) {
        return false;
      }
    }
    if (filterId) {
      const assigned = state.assignments.get(donor.id);
      if (!assigned || !assigned.has(filterId)) {
        return false;
      }
    }
    return true;
  });
  if (!state.filtered.length) {
    state.selectedDonorId = null;
    return;
  }
  if (
    state.selectedDonorId &&
    !state.filtered.some((donor) => donor.id === state.selectedDonorId)
  ) {
    state.selectedDonorId = state.filtered[0].id;
  }
}

function selectDonor(donorId) {
  if (!donorId) {
    state.selectedDonorId = null;
    return;
  }
  const exists = state.donors.some((donor) => donor.id === donorId);
  state.selectedDonorId = exists ? donorId : null;
}

function render() {
  renderDonorList();
  renderDonorDetail();
}

function renderClientFilter() {
  const select = elements.clientFilter;
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All candidates";
  select.append(allOption);
  state.clients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.label || client.candidate || "Unnamed candidate";
    select.append(option);
  });
  if (previous && state.clients.some((client) => client.id === previous)) {
    select.value = previous;
    state.clientFilter = previous;
  } else {
    select.value = "";
    state.clientFilter = "";
  }
}

function renderDonorList() {
  const list = elements.list;
  if (!list) return;
  list.innerHTML = "";
  if (!state.filtered.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "database-list__empty";
    emptyItem.innerHTML = `
      <p>No donors match your current filters.</p>
      <a class="btn btn--ghost" href="donor-editor.html">Create a donor</a>
    `;
    list.append(emptyItem);
    return;
  }
  state.filtered.forEach((donor) => {
    const item = document.createElement("li");
    item.className = "database-list__item";
    if (donor.id === state.selectedDonorId) {
      item.classList.add("database-list__item--active");
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "database-list__button";
    button.setAttribute("data-donor-id", donor.id);
    const metaParts = [];
    if (donor.city) metaParts.push(donor.city);
    if (donor.company) metaParts.push(donor.company);
    const assigned = state.assignments.get(donor.id) || new Set();
    const assignedCount = assigned.size;
    const focusLabel = assignedCount
      ? `${assignedCount} focus ${assignedCount === 1 ? "list" : "lists"}`
      : "Not assigned";
    const subtitle = metaParts.length ? `${metaParts.join(" • ")} • ${focusLabel}` : focusLabel;
    button.innerHTML = `
      <span class="database-list__title">${escapeHtml(donor.name || "New donor")}</span>
      <span class="database-list__meta">${escapeHtml(subtitle)}</span>
    `;
    item.append(button);
    list.append(item);
  });
}

function renderDonorDetail() {
  const container = elements.detail;
  const empty = elements.empty;
  if (!container || !empty) return;
  container.querySelectorAll(".donor-profile").forEach((node) => node.remove());
  if (!state.selectedDonorId) {
    empty.classList.remove("hidden");
    return;
  }
  const donor = state.donors.find((item) => item.id === state.selectedDonorId);
  if (!donor) {
    empty.classList.remove("hidden");
    state.selectedDonorId = null;
    return;
  }
  empty.classList.add("hidden");
  const profile = document.createElement("article");
  profile.className = "donor-profile";

  const header = document.createElement("header");
  header.className = "donor-profile__header";

  const identity = document.createElement("div");
  identity.className = "donor-profile__identity";
  const title = document.createElement("h2");
  title.textContent = donor.name || "New donor";
  const subtitle = document.createElement("p");
  subtitle.className = "muted";
  const subtitleParts = [];
  if (donor.city) subtitleParts.push(donor.city);
  if (donor.company) subtitleParts.push(donor.company);
  if (donor.industry) subtitleParts.push(donor.industry);
  subtitle.textContent = subtitleParts.join(" • ");
  identity.append(title);
  if (subtitle.textContent) {
    identity.append(subtitle);
  }

  const actions = document.createElement("div");
  actions.className = "donor-profile__actions";
  const editLink = document.createElement("a");
  editLink.className = "btn";
  editLink.href = `donor-editor.html?id=${encodeURIComponent(donor.id)}`;
  editLink.textContent = "Edit donor";
  actions.append(editLink);

  header.append(identity, actions);
  profile.append(header);

  const infoSection = document.createElement("section");
  infoSection.className = "donor-profile__section donor-profile__section--grid";
  infoSection.append(
    createInfoItem("Email", donor.email, donor.email ? `mailto:${donor.email}` : null),
    createInfoItem("Phone", donor.phone),
    createInfoItem("Suggested ask", donor.ask ? `$${formatCurrency(donor.ask)}` : "—"),
    createInfoItem("Last gift", donor.lastGift || "—"),
    createInfoItem("Tags", donor.tags || "—"),
    createInfoItem("Notes", donor.notes || "—"),
  );
  profile.append(infoSection);

  if (donor.biography) {
    const bioSection = document.createElement("section");
    bioSection.className = "donor-profile__section";
    const bioHeading = document.createElement("h3");
    bioHeading.textContent = "Background";
    const bioContent = document.createElement("p");
    bioContent.className = "donor-profile__text";
    bioContent.textContent = donor.biography;
    bioSection.append(bioHeading, bioContent);
    profile.append(bioSection);
  }

  profile.append(createAssignmentSection(donor));
  profile.append(createHistorySection(donor));

  container.append(profile);
}

function createInfoItem(label, value, href) {
  const wrapper = document.createElement("div");
  wrapper.className = "donor-info";
  const heading = document.createElement("span");
  heading.className = "donor-info__label";
  heading.textContent = label;
  const content = document.createElement("span");
  content.className = "donor-info__value";
  if (href && value) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = value;
    content.append(link);
  } else {
    content.textContent = value || "—";
  }
  wrapper.append(heading, content);
  return wrapper;
}

function createAssignmentSection(donor) {
  const section = document.createElement("section");
  section.className = "donor-profile__section";
  const heading = document.createElement("div");
  heading.className = "donor-profile__section-header";
  const title = document.createElement("h3");
  title.textContent = "Focus assignments";
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = "Choose which candidates include this donor on their focus lists.";
  heading.append(title, description);
  section.append(heading);

  const assigned = state.assignments.get(donor.id) || new Set();
  const selectedClients = state.clients.filter((client) => assigned.has(client.id));

  const chips = document.createElement("div");
  chips.className = "donor-assignment__chips";
  if (selectedClients.length) {
    selectedClients.forEach((client) => {
      const chip = document.createElement("span");
      chip.className = "donor-assignment__chip";
      chip.textContent = client.label || client.candidate || "Unnamed candidate";
      chips.append(chip);
    });
  } else {
    const emptyChip = document.createElement("span");
    emptyChip.className = "muted";
    emptyChip.textContent = "Not assigned to any focus lists.";
    chips.append(emptyChip);
  }
  section.append(chips);

  const details = document.createElement("details");
  details.className = "assignment-dropdown";
  const summary = document.createElement("summary");
  summary.className = "assignment-dropdown__summary";
  summary.textContent = "Update focus access";
  details.append(summary);

  const menu = document.createElement("div");
  menu.className = "assignment-dropdown__menu";
  if (!state.clients.length) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "muted";
    emptyMessage.textContent = "Add a candidate to manage focus assignments.";
    menu.append(emptyMessage);
  } else {
    state.clients.forEach((client) => {
      const label = document.createElement("label");
      label.className = "assignment-dropdown__option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = client.id;
      input.checked = assigned.has(client.id);
      input.addEventListener("change", (event) => {
        toggleAssignment(donor.id, client.id, event.target.checked);
      });
      const span = document.createElement("span");
      span.textContent = client.label || client.candidate || "Unnamed candidate";
      label.append(input, span);
      menu.append(label);
    });
  }
  details.append(menu);
  section.append(details);
  return section;
}

function toggleAssignment(donorId, clientId, shouldAssign) {
  const current = new Set(db.getClientsForDonor(donorId));
  if (shouldAssign) {
    current.add(clientId);
  } else {
    current.delete(clientId);
  }
  db.setDonorClients(donorId, Array.from(current));
  state.assignments = buildAssignmentMap(db.getAssignments());
  applyFilters();
  render();
}

function createHistorySection(donor) {
  const section = document.createElement("section");
  section.className = "donor-profile__section";
  const heading = document.createElement("div");
  heading.className = "donor-profile__section-header";
  const title = document.createElement("h3");
  title.textContent = "Contribution history";
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = "Track past giving to understand engagement.";
  heading.append(title, description);
  section.append(heading);

  const history = Array.isArray(donor.history) ? [...donor.history] : [];
  history.sort((a, b) => {
    if ((b.year || 0) !== (a.year || 0)) {
      return (b.year || 0) - (a.year || 0);
    }
    return (a.candidate || "").localeCompare(b.candidate || "");
  });

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No contributions recorded yet.";
    section.append(empty);
    return section;
  }

  const table = document.createElement("table");
  table.className = "donor-history";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Year</th><th>Candidate</th><th>Amount</th></tr>";
  table.append(thead);
  const tbody = document.createElement("tbody");
  history.forEach((entry) => {
    const row = document.createElement("tr");
    const yearCell = document.createElement("td");
    yearCell.textContent = entry.year || "—";
    const candidateCell = document.createElement("td");
    candidateCell.textContent = entry.candidate || "—";
    const amountCell = document.createElement("td");
    amountCell.textContent =
      entry.amount === null || entry.amount === undefined
        ? "—"
        : `$${formatCurrency(entry.amount)}`;
    row.append(yearCell, candidateCell, amountCell);
    tbody.append(row);
  });
  table.append(tbody);
  section.append(table);
  return section;
}

function exportDonors() {
  const donors = db.getAllDonors();
  const blob = new Blob([JSON.stringify(donors, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "calltime-complete-donor-database.json";
  document.body.append(link);
  link.click();
  requestAnimationFrame(() => {
    URL.revokeObjectURL(url);
    link.remove();
  });
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
