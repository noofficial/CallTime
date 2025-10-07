import { CallTimeDatabase, DATABASE_KEY } from "./database.js";

const db = new CallTimeDatabase();

const state = {
  donorId: null,
  history: [],
  assignedClients: new Set(),
  clients: [],
};

const elements = {
  form: document.getElementById("donor-editor-form"),
  title: document.getElementById("editor-title"),
  status: document.getElementById("editor-status"),
  assignments: document.getElementById("editor-client-assignments"),
  selectAll: document.getElementById("select-all-clients"),
  deleteButton: document.getElementById("delete-donor"),
  historyList: document.getElementById("history-list"),
  historyYear: document.getElementById("history-year"),
  historyCandidate: document.getElementById("history-candidate"),
  historyAmount: document.getElementById("history-amount"),
  addHistory: document.getElementById("add-history"),
};

init();

function init() {
  bindEvents();
  loadStateFromUrl();
  loadData();
  renderAssignments();
  renderHistory();
}

function bindEvents() {
  elements.form?.addEventListener("submit", handleSubmit);
  elements.addHistory?.addEventListener("click", handleAddHistory);
  elements.historyList?.addEventListener("click", handleHistoryClick);
  elements.selectAll?.addEventListener("click", handleSelectAllClients);
  elements.deleteButton?.addEventListener("click", handleDeleteDonor);
  window.addEventListener("storage", handleStorageSync);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.donorId = params.get("id");
}

function loadData() {
  state.clients = db.getClients();
  if (state.donorId) {
    const donor = db.getAllDonors().find((item) => item.id === state.donorId);
    if (donor) {
      populateForm(donor);
      state.history = Array.isArray(donor.history)
        ? donor.history.map((entry) => ({
            id: entry.id || createId(`${entry.year || ""}-${entry.candidate || ""}-${entry.amount ?? ""}`),
            year: entry.year,
            candidate: entry.candidate,
            amount: entry.amount,
          }))
        : [];
      state.assignedClients = new Set(db.getClientsForDonor(donor.id));
      elements.title.textContent = "Edit donor";
      elements.deleteButton.removeAttribute("disabled");
    } else {
      state.donorId = null;
    }
  }
  if (!state.donorId) {
    state.history = [];
    state.assignedClients = new Set();
    elements.title.textContent = "New donor";
    elements.deleteButton.setAttribute("disabled", "true");
    elements.form?.reset();
  }
}

function populateForm(donor) {
  elements.form.elements.firstName.value = donor.firstName || "";
  elements.form.elements.lastName.value = donor.lastName || "";
  elements.form.elements.email.value = donor.email || "";
  elements.form.elements.phone.value = donor.phone || "";
  elements.form.elements.company.value = donor.company || "";
  elements.form.elements.industry.value = donor.industry || "";
  elements.form.elements.city.value = donor.city || "";
  elements.form.elements.tags.value = donor.tags || "";
  elements.form.elements.ask.value = donor.ask ?? "";
  elements.form.elements.lastGift.value = donor.lastGift || "";
  elements.form.elements.pictureUrl.value = donor.pictureUrl || "";
  elements.form.elements.notes.value = donor.notes || donor.donorNotes || "";
  elements.form.elements.biography.value = donor.biography || "";
}

function handleSubmit(event) {
  event.preventDefault();
  if (!elements.form.reportValidity()) {
    return;
  }
  const formData = new FormData(elements.form);
  const payload = {
    firstName: formData.get("firstName")?.toString().trim() || "",
    lastName: formData.get("lastName")?.toString().trim() || "",
    email: formData.get("email")?.toString().trim() || "",
    phone: formData.get("phone")?.toString().trim() || "",
    company: formData.get("company")?.toString().trim() || "",
    industry: formData.get("industry")?.toString().trim() || "",
    city: formData.get("city")?.toString().trim() || "",
    tags: formData.get("tags")?.toString().trim() || "",
    ask: parseNumber(formData.get("ask")),
    lastGift: formData.get("lastGift")?.toString().trim() || "",
    pictureUrl: formData.get("pictureUrl")?.toString().trim() || "",
    donorNotes: formData.get("notes")?.toString().trim() || "",
    biography: formData.get("biography")?.toString().trim() || "",
    history: [...state.history],
  };
  let savedDonor;
  if (state.donorId) {
    savedDonor = db.updateDonor(state.donorId, payload);
    db.setDonorClients(state.donorId, Array.from(state.assignedClients));
  } else {
    savedDonor = db.createDonor(payload, Array.from(state.assignedClients));
    state.donorId = savedDonor.id;
    const params = new URLSearchParams(window.location.search);
    params.set("id", savedDonor.id);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    elements.title.textContent = "Edit donor";
    elements.deleteButton.removeAttribute("disabled");
  }
  elements.status.textContent = "Saved just now";
  setTimeout(() => {
    elements.status.textContent = "";
  }, 3000);
  loadData();
  renderAssignments();
  renderHistory();
}

function handleAddHistory() {
  const yearValue = parseInt(elements.historyYear.value, 10);
  const candidate = elements.historyCandidate.value.trim();
  const amountValue = parseNumber(elements.historyAmount.value);
  if (!candidate && Number.isNaN(yearValue) && amountValue === null) {
    return;
  }
  const entry = {
    id: createId(`${Date.now()}-${elements.historyYear.value}-${candidate}-${elements.historyAmount.value}`),
    year: Number.isNaN(yearValue) ? undefined : yearValue,
    candidate,
    amount: amountValue,
  };
  state.history.push(entry);
  sortHistory();
  renderHistory();
  elements.historyYear.value = "";
  elements.historyCandidate.value = "";
  elements.historyAmount.value = "";
  elements.historyYear.focus();
}

function handleHistoryClick(event) {
  const button = event.target.closest("[data-remove-history]");
  if (!button) return;
  const id = button.getAttribute("data-remove-history");
  state.history = state.history.filter((entry) => entry.id !== id);
  renderHistory();
}

function handleSelectAllClients() {
  if (!state.clients.length) return;
  const allSelected = state.clients.every((client) => state.assignedClients.has(client.id));
  if (allSelected) {
    state.assignedClients.clear();
  } else {
    state.clients.forEach((client) => state.assignedClients.add(client.id));
  }
  renderAssignments();
}

function handleDeleteDonor() {
  if (!state.donorId) return;
  const donor = db.getAllDonors().find((item) => item.id === state.donorId);
  const name = donor?.name || `${donor?.firstName || ""} ${donor?.lastName || ""}`.trim() || "this donor";
  if (!window.confirm(`Delete ${name}? This cannot be undone.`)) {
    return;
  }
  db.deleteDonor(state.donorId);
  window.location.href = "donors.html";
}

function renderAssignments() {
  const container = elements.assignments;
  if (!container) return;
  container.innerHTML = "";
  if (!state.clients.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Add candidates in the workspace to assign this donor.";
    container.append(empty);
    elements.selectAll?.setAttribute("disabled", "true");
    if (elements.selectAll) {
      elements.selectAll.textContent = "Select all";
    }
    return;
  }
  elements.selectAll?.removeAttribute("disabled");
  state.clients.forEach((client) => {
    const label = document.createElement("label");
    label.className = "assignment-grid__item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = client.id;
    input.checked = state.assignedClients.has(client.id);
    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.assignedClients.add(client.id);
      } else {
        state.assignedClients.delete(client.id);
      }
    });
    const name = document.createElement("span");
    name.textContent = client.label || client.candidate || "Unnamed candidate";
    label.append(input, name);
    container.append(label);
  });
  updateSelectAllLabel();
}

function updateSelectAllLabel() {
  if (!elements.selectAll) return;
  const allSelected = state.clients.length && state.clients.every((client) => state.assignedClients.has(client.id));
  elements.selectAll.textContent = allSelected ? "Clear all" : "Select all";
}

function renderHistory() {
  const container = elements.historyList;
  if (!container) return;
  sortHistory();
  if (!state.history.length) {
    container.innerHTML = '<p class="muted">No contributions logged yet.</p>';
    return;
  }
  const table = document.createElement("table");
  table.className = "editor-history";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Year</th><th>Candidate</th><th>Amount</th><th></th></tr>";
  table.append(head);
  const body = document.createElement("tbody");
  state.history.forEach((entry) => {
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
    const actionsCell = document.createElement("td");
    actionsCell.className = "editor-history__actions";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn--ghost editor-history__remove";
    removeButton.setAttribute("data-remove-history", entry.id);
    removeButton.textContent = "Remove";
    actionsCell.append(removeButton);
    row.append(yearCell, candidateCell, amountCell, actionsCell);
    body.append(row);
  });
  table.append(body);
  container.innerHTML = "";
  container.append(table);
}

function sortHistory() {
  state.history.sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    if (yearA !== yearB) {
      return yearB - yearA;
    }
    return (a.candidate || "").localeCompare(b.candidate || "");
  });
}

function handleStorageSync(event) {
  if (event.key && event.key !== DATABASE_KEY) {
    return;
  }
  const previousAssignments = new Set(state.assignedClients);
  loadData();
  if (state.donorId) {
    const updatedAssignments = new Set(db.getClientsForDonor(state.donorId));
    state.assignedClients = updatedAssignments;
  } else {
    state.assignedClients = new Set();
  }
  if (!areSetsEqual(previousAssignments, state.assignedClients)) {
    renderAssignments();
  }
  renderHistory();
}

function areSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isNaN(numeric) ? null : numeric;
}

function createId(value = "") {
  const cleaned = value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (cleaned) return cleaned;
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
