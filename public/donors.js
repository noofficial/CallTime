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
  detailDraft: null,
  detailStatus: null,
  detailStatusTimeout: null,
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
  state.donors = sortDonors(db.getAllDonors());
  state.assignments = buildAssignmentMap(db.getAssignments());
  state.detailDraft = null;
  state.detailStatus = null;
  if (state.detailStatusTimeout) {
    clearTimeout(state.detailStatusTimeout);
    state.detailStatusTimeout = null;
  }
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

function sortDonors(list = []) {
  return [...list].sort(
    (a, b) =>
      (a.lastName || "").localeCompare(b.lastName || "") ||
      (a.firstName || "").localeCompare(b.firstName || ""),
  );
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

  if (!state.detailDraft || state.detailDraft.id !== donor.id) {
    state.detailDraft = createDraftFromDonor(donor);
  }

  const draft = state.detailDraft;
  const profile = document.createElement("article");
  profile.className = "donor-profile";

  const form = document.createElement("form");
  form.className = "donor-inline-form";
  form.setAttribute("novalidate", "true");

  const header = document.createElement("header");
  header.className = "donor-inline-form__header";

  const identity = document.createElement("div");
  identity.className = "donor-inline-form__identity";
  const nameHeading = document.createElement("h2");
  nameHeading.setAttribute("data-display-name", "");
  nameHeading.textContent = buildDraftDisplayName(draft.values, donor);
  identity.append(nameHeading);

  const meta = document.createElement("p");
  meta.className = "muted";
  meta.setAttribute("data-donor-meta", "");
  const metaText = buildDraftMeta(draft.values);
  meta.textContent = metaText;
  meta.hidden = !metaText;
  identity.append(meta);

  const actions = document.createElement("div");
  actions.className = "donor-inline-form__actions";
  const status = document.createElement("span");
  status.className = "muted";
  status.setAttribute("data-status", "");
  if (state.detailStatus && state.detailStatus.donorId === donor.id) {
    status.textContent = state.detailStatus.message;
  }
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "btn btn--primary";
  saveButton.textContent = "Save changes";
  actions.append(status, saveButton);

  header.append(identity, actions);
  form.append(header);

  form.append(createIdentitySection(draft));
  form.append(createGivingSection(draft));
  form.append(createNotesSection(draft));
  form.append(createAssignmentSection(donor));
  form.append(createHistorySection(donor));

  profile.append(form);
  container.append(profile);

  form.addEventListener("input", (event) => handleInlineInput(event, donor, nameHeading, meta));
  form.addEventListener("submit", (event) => handleInlineSubmit(event, donor));
}

function createDraftFromDonor(donor) {
  const history = Array.isArray(donor.history)
    ? donor.history.map((entry) => ({
        id: entry.id,
        year: entry.year,
        candidate: entry.candidate,
        amount: entry.amount,
      }))
    : [];
  sortHistory(history);
  return {
    id: donor.id,
    values: {
      firstName: donor.firstName || "",
      lastName: donor.lastName || "",
      email: donor.email || "",
      phone: donor.phone || "",
      city: donor.city || "",
      company: donor.company || "",
      industry: donor.industry || "",
      tags: donor.tags || "",
      ask:
        donor.ask === null || donor.ask === undefined || Number.isNaN(Number(donor.ask))
          ? ""
          : String(donor.ask),
      lastGift: donor.lastGift || "",
      notes: donor.notes || donor.donorNotes || "",
      biography: donor.biography || "",
      pictureUrl: donor.pictureUrl || "",
    },
    history,
  };
}

function buildDraftDisplayName(values, donor) {
  const name = `${values.firstName || ""} ${values.lastName || ""}`.trim();
  if (name) return name;
  if (donor.name) return donor.name;
  if (values.email) return values.email;
  return "New donor";
}

function buildDraftMeta(values) {
  return [values.city, values.company, values.industry].filter(Boolean).join(" • ");
}

function createIdentitySection(draft) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section";
  const heading = document.createElement("h3");
  heading.textContent = "Identity & contact";
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createInputField("inline-first-name", "firstName", "First name", draft.values.firstName, {
      required: true,
      autocomplete: "given-name",
    }),
    createInputField("inline-last-name", "lastName", "Last name", draft.values.lastName, {
      required: true,
      autocomplete: "family-name",
    }),
    createInputField("inline-email", "email", "Email", draft.values.email, {
      type: "email",
      autocomplete: "email",
    }),
    createInputField("inline-phone", "phone", "Phone", draft.values.phone, {
      autocomplete: "tel",
    }),
    createInputField("inline-city", "city", "City", draft.values.city),
  );
  section.append(grid);
  return section;
}

function createGivingSection(draft) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section";
  const heading = document.createElement("h3");
  heading.textContent = "Professional & giving";
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createInputField("inline-company", "company", "Company", draft.values.company),
    createInputField("inline-industry", "industry", "Industry", draft.values.industry),
    createInputField("inline-tags", "tags", "Tags", draft.values.tags, {
      placeholder: "High priority, Warm",
    }),
    createInputField("inline-ask", "ask", "Suggested ask", draft.values.ask, {
      type: "number",
      min: "0",
      step: "25",
    }),
    createInputField("inline-last-gift", "lastGift", "Last gift note", draft.values.lastGift),
    createInputField("inline-picture", "pictureUrl", "Picture URL", draft.values.pictureUrl, {
      type: "url",
      placeholder: "https://…",
    }),
  );
  section.append(grid);
  return section;
}

function createNotesSection(draft) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section";
  const heading = document.createElement("h3");
  heading.textContent = "Notes & background";
  section.append(heading);

  section.append(createInputField("inline-notes", "notes", "Internal notes", draft.values.notes));
  section.append(createTextareaField("inline-biography", "biography", "Background", draft.values.biography, 4));
  return section;
}

function createInputField(id, name, label, value, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-row";
  const labelEl = document.createElement("label");
  labelEl.className = "form-label";
  labelEl.setAttribute("for", id);
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.className = "input";
  input.id = id;
  input.name = name;
  input.value = value || "";
  input.type = options.type || "text";
  if (options.required) input.required = true;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.placeholder !== undefined) input.placeholder = options.placeholder;
  if (options.min !== undefined) input.min = options.min;
  if (options.max !== undefined) input.max = options.max;
  if (options.step !== undefined) input.step = options.step;
  wrapper.append(labelEl, input);
  return wrapper;
}

function createTextareaField(id, name, label, value, rows = 4) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-row";
  const labelEl = document.createElement("label");
  labelEl.className = "form-label";
  labelEl.setAttribute("for", id);
  labelEl.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.className = "input textarea";
  textarea.id = id;
  textarea.name = name;
  textarea.rows = rows;
  textarea.value = value || "";
  wrapper.append(labelEl, textarea);
  return wrapper;
}

function handleInlineInput(event, donor, nameHeading, metaElement) {
  const target = event.target;
  if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }
  if (!state.detailDraft || state.detailDraft.id !== donor.id) {
    return;
  }
  if (!target.name) return;
  state.detailDraft.values[target.name] = target.value;
  if (target.name === "firstName" || target.name === "lastName") {
    nameHeading.textContent = buildDraftDisplayName(state.detailDraft.values, donor);
  }
  if (target.name === "city" || target.name === "company" || target.name === "industry") {
    const metaText = buildDraftMeta(state.detailDraft.values);
    metaElement.textContent = metaText;
    metaElement.hidden = !metaText;
  }
}

function handleInlineSubmit(event, donor) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement) || !form.reportValidity()) {
    return;
  }
  if (!state.detailDraft || state.detailDraft.id !== donor.id) {
    return;
  }

  const values = state.detailDraft.values;
  const payload = {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    city: values.city.trim(),
    company: values.company.trim(),
    industry: values.industry.trim(),
    tags: values.tags.trim(),
    ask: parseNumber(values.ask),
    lastGift: values.lastGift.trim(),
    donorNotes: values.notes.trim(),
    biography: values.biography.trim(),
    pictureUrl: values.pictureUrl.trim(),
  };

  const updated = db.updateDonor(donor.id, payload);
  state.detailDraft = createDraftFromDonor(updated);
  state.detailStatus = { donorId: donor.id, message: "Saved just now" };
  if (state.detailStatusTimeout) {
    clearTimeout(state.detailStatusTimeout);
  }
  state.detailStatusTimeout = window.setTimeout(() => {
    if (state.detailStatus && state.detailStatus.donorId === donor.id) {
      state.detailStatus = null;
      const statusNode = elements.detail?.querySelector("[data-status]");
      if (statusNode) {
        statusNode.textContent = "";
      }
    }
    state.detailStatusTimeout = null;
  }, 3000);

  refreshData({ donorId: donor.id, preserveDraft: true });
}

function createAssignmentSection(donor) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section";
  const header = document.createElement("div");
  header.className = "donor-inline-form__section-header";
  const title = document.createElement("h3");
  title.textContent = "Focus assignments";
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = "Choose which campaigns can access this donor.";
  header.append(title, description);
  section.append(header);

  const assigned = state.assignments.get(donor.id) || new Set();
  const chips = document.createElement("div");
  chips.className = "donor-assignment__chips";
  const selectedClients = state.clients.filter((client) => assigned.has(client.id));
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

  const options = document.createElement("div");
  options.className = "assignment-grid";
  if (!state.clients.length) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "muted";
    emptyMessage.textContent = "Add a candidate to manage focus assignments.";
    options.append(emptyMessage);
  } else {
    state.clients.forEach((client) => {
      const label = document.createElement("label");
      label.className = "assignment-grid__item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = client.id;
      input.checked = assigned.has(client.id);
      input.addEventListener("change", (event) => {
        toggleAssignment(donor.id, client.id, event.target.checked);
      });
      const name = document.createElement("span");
      name.textContent = client.label || client.candidate || "Unnamed candidate";
      label.append(input, name);
      options.append(label);
    });
  }
  section.append(options);
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
  refreshData({ donorId, preserveDraft: true });
}

function createHistorySection(donor) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section";
  const header = document.createElement("div");
  header.className = "donor-inline-form__section-header";
  const title = document.createElement("h3");
  title.textContent = "Contribution history";
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = "Track past giving to understand engagement.";
  header.append(title, description);
  section.append(header);

  const formRow = document.createElement("div");
  formRow.className = "history-form";
  const yearInput = document.createElement("input");
  yearInput.className = "input";
  yearInput.type = "number";
  yearInput.id = "inline-history-year";
  yearInput.name = "historyYear";
  yearInput.placeholder = "2024";
  yearInput.min = "1900";
  yearInput.max = "2100";
  const candidateInput = document.createElement("input");
  candidateInput.className = "input";
  candidateInput.id = "inline-history-candidate";
  candidateInput.name = "historyCandidate";
  candidateInput.placeholder = "Candidate";
  const amountInput = document.createElement("input");
  amountInput.className = "input";
  amountInput.type = "number";
  amountInput.id = "inline-history-amount";
  amountInput.name = "historyAmount";
  amountInput.placeholder = "500";
  amountInput.min = "0";
  amountInput.step = "25";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn";
  addButton.textContent = "Add";
  addButton.addEventListener("click", () => {
    addHistoryEntry(donor.id, yearInput, candidateInput, amountInput);
  });

  formRow.append(yearInput, candidateInput, amountInput, addButton);
  section.append(formRow);

  const list = document.createElement("div");
  list.className = "history-list";
  renderHistoryItems(list, state.detailDraft?.history || []);
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-history]");
    if (!button) return;
    const entryId = button.getAttribute("data-remove-history");
    removeHistoryEntry(donor.id, entryId);
  });
  section.append(list);
  return section;
}

function renderHistoryItems(container, history = []) {
  container.innerHTML = "";
  sortHistory(history);
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No contributions recorded yet.";
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "donor-history";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Year</th><th>Candidate</th><th>Amount</th><th></th></tr>";
  table.append(head);
  const body = document.createElement("tbody");
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
    const actionsCell = document.createElement("td");
    actionsCell.className = "donor-history__actions";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn--ghost";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("data-remove-history", entry.id);
    actionsCell.append(removeButton);
    row.append(yearCell, candidateCell, amountCell, actionsCell);
    body.append(row);
  });
  table.append(body);
  container.append(table);
}

function addHistoryEntry(donorId, yearInput, candidateInput, amountInput) {
  const yearValue = parseInt(yearInput.value, 10);
  const candidate = candidateInput.value.trim();
  const amountValue = parseNumber(amountInput.value);
  if (!candidate && Number.isNaN(yearValue) && amountValue === null) {
    return;
  }
  const entry = db.addContribution(donorId, {
    year: Number.isNaN(yearValue) ? undefined : yearValue,
    candidate,
    amount: amountValue,
  });
  if (state.detailDraft && state.detailDraft.id === donorId) {
    state.detailDraft.history.push(entry);
    sortHistory(state.detailDraft.history);
  }
  yearInput.value = "";
  candidateInput.value = "";
  amountInput.value = "";
  refreshData({ donorId, preserveDraft: true });
}

function removeHistoryEntry(donorId, entryId) {
  if (!entryId) return;
  db.removeContribution(donorId, entryId);
  if (state.detailDraft && state.detailDraft.id === donorId) {
    state.detailDraft.history = state.detailDraft.history.filter((item) => item.id !== entryId);
  }
  refreshData({ donorId, preserveDraft: true });
}

function refreshData({ donorId = state.selectedDonorId, preserveDraft = false } = {}) {
  const draft = preserveDraft && state.detailDraft && state.detailDraft.id === donorId ? state.detailDraft : null;
  state.donors = sortDonors(db.getAllDonors());
  state.assignments = buildAssignmentMap(db.getAssignments());
  applyFilters();
  const isActiveDonor = Boolean(donorId && state.filtered.some((item) => item.id === donorId));
  if (isActiveDonor) {
    state.selectedDonorId = donorId;
  }
  state.detailDraft = preserveDraft && draft && isActiveDonor ? draft : null;
  render();
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isNaN(numeric) ? null : numeric;
}

function sortHistory(history) {
  history.sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    if (yearA !== yearB) {
      return yearB - yearA;
    }
    return (a.candidate || "").localeCompare(b.candidate || "");
  });
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
