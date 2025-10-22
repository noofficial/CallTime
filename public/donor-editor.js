const state = {
  history: [],
  assignedClients: new Set(),
  clients: [],
  exclusiveDonor: false,
  exclusiveClientId: "",
};

const DONOR_TYPE_VALUES = ["individual", "business", "campaign"];

const elements = {
  form: document.getElementById("donor-editor-form"),
  status: document.getElementById("editor-status"),
  firstName: document.getElementById("editor-first-name"),
  lastName: document.getElementById("editor-last-name"),
  donorType: document.getElementById("editor-donor-type"),
  organizationName: document.getElementById("editor-organization-name"),
  contactFirstName: document.getElementById("editor-contact-first-name"),
  contactLastName: document.getElementById("editor-contact-last-name"),
  assignments: document.getElementById("editor-client-assignments"),
  selectAll: document.getElementById("select-all-clients"),
  exclusiveToggle: document.getElementById("editor-exclusive-toggle"),
  exclusiveClient: document.getElementById("editor-exclusive-client"),
  historyList: document.getElementById("history-list"),
  historyYear: document.getElementById("history-year"),
  historyCandidate: document.getElementById("history-candidate"),
  historyOffice: document.getElementById("history-office"),
  historyAmount: document.getElementById("history-amount"),
  addHistory: document.getElementById("add-history"),
};

const callbacks = {
  onSuccess: defaultOnSuccess,
};

const identityGroups = {
  individual: Array.from(document.querySelectorAll("[data-identity-group='individual']")),
  organization: Array.from(document.querySelectorAll("[data-identity-group='organization']")),
  organizationContact: Array.from(document.querySelectorAll("[data-identity-group='organization-contact']")),
};

init();

export function configureDonorEditor(options = {}) {
  if (options && typeof options.onSuccess === "function") {
    callbacks.onSuccess = options.onSuccess;
  } else if (options && options.onSuccess === null) {
    callbacks.onSuccess = null;
  } else if (!options || options.onSuccess === undefined) {
    callbacks.onSuccess = defaultOnSuccess;
  }
}

export function resetDonorEditorForm({ preserveStatus = false } = {}) {
  resetEditorState();
  renderAssignments();
  renderExclusiveControls();
  renderHistory();
  if (!preserveStatus) {
    setStatus("");
  }
}

export function refreshDonorEditorClients() {
  return loadData();
}

function defaultOnSuccess() {
  window.location.href = "donors.html";
}

function init() {
  bindEvents();
  resetDonorEditorForm();
  loadData();
}

function bindEvents() {
  elements.form?.addEventListener("submit", handleSubmit);
  elements.addHistory?.addEventListener("click", handleAddHistory);
  elements.historyList?.addEventListener("click", handleHistoryClick);
  elements.selectAll?.addEventListener("click", handleSelectAllClients);
  elements.exclusiveToggle?.addEventListener("change", handleExclusiveToggle);
  elements.exclusiveClient?.addEventListener("change", handleExclusiveClientChange);
  elements.donorType?.addEventListener("change", handleDonorTypeChange);
}

function resetEditorState() {
  state.history = [];
  state.assignedClients = new Set();
  state.exclusiveDonor = false;
  state.exclusiveClientId = "";
  elements.form?.reset();
  if (elements.donorType) {
    elements.donorType.value = "individual";
  }
  if (elements.organizationName) {
    elements.organizationName.value = "";
  }
  if (elements.contactFirstName) {
    elements.contactFirstName.value = "";
  }
  if (elements.contactLastName) {
    elements.contactLastName.value = "";
  }
  if (elements.exclusiveToggle) {
    elements.exclusiveToggle.value = "no";
  }
  if (elements.exclusiveClient) {
    elements.exclusiveClient.value = "";
    elements.exclusiveClient.setAttribute("disabled", "true");
  }
  updateIdentityFieldState();
  if (elements.historyYear) elements.historyYear.value = "";
  if (elements.historyCandidate) elements.historyCandidate.value = "";
  if (elements.historyOffice) elements.historyOffice.value = "";
  if (elements.historyAmount) elements.historyAmount.value = "";
}

async function loadData() {
  try {
    const overview = await fetchJson("/api/manager/overview");
    const clients = Array.isArray(overview?.clients)
      ? overview.clients.map((client) => ({
          id: client.id != null ? String(client.id) : "",
          label: client.name || client.candidate || client.label || "Unnamed candidate",
        }))
      : [];
    const previousSelection = new Set(state.assignedClients);
    state.clients = clients;
    const validClientIds = new Set(clients.map((client) => client.id));
    state.assignedClients = new Set([...previousSelection].filter((id) => validClientIds.has(id)));
    if (state.exclusiveDonor) {
      if (state.exclusiveClientId && !validClientIds.has(state.exclusiveClientId)) {
        state.exclusiveClientId = clients.length ? clients[0].id : "";
      }
      if (!state.exclusiveClientId && clients.length) {
        state.exclusiveClientId = clients[0].id;
      }
      if (state.exclusiveClientId) {
        state.assignedClients = new Set([state.exclusiveClientId]);
      }
    } else if (state.exclusiveClientId && !validClientIds.has(state.exclusiveClientId)) {
      state.exclusiveClientId = "";
    }
    renderExclusiveControls();
    renderAssignments();
  } catch (error) {
    console.error("Failed to load clients", error);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!elements.form || !elements.form.reportValidity()) {
    return;
  }
  if (state.exclusiveDonor) {
    if (!state.exclusiveClientId) {
      setStatus("Select the campaign this exclusive donor belongs to.", "error");
      return;
    }
    state.assignedClients = new Set([state.exclusiveClientId]);
  }
  const selectedClients = Array.from(state.assignedClients);
  if (!selectedClients.length) {
    setStatus("Select at least one campaign to assign this donor.", "error");
    return;
  }
  const formData = new FormData(elements.form);
  const donorTypeRaw = (formData.get("donorType")?.toString() || "individual").toLowerCase();
  const donorType = DONOR_TYPE_VALUES.includes(donorTypeRaw) ? donorTypeRaw : "individual";
  const payload = {
    firstName: formData.get("firstName")?.toString().trim() || "",
    lastName: formData.get("lastName")?.toString().trim() || "",
    contactFirstName: formData.get("contactFirstName")?.toString().trim() || "",
    contactLastName: formData.get("contactLastName")?.toString().trim() || "",
    donorType,
    organizationName: formData.get("organizationName")?.toString().trim() || "",
    email: formData.get("email")?.toString().trim() || "",
    phone: formData.get("phone")?.toString().trim() || "",
    street: formData.get("street")?.toString().trim() || "",
    addressLine2: formData.get("addressLine2")?.toString().trim() || "",
    company: formData.get("company")?.toString().trim() || "",
    title: formData.get("title")?.toString().trim() || "",
    industry: formData.get("industry")?.toString().trim() || "",
    city: formData.get("city")?.toString().trim() || "",
    state: formData.get("state")?.toString().trim() || "",
    postalCode: formData.get("postalCode")?.toString().trim() || "",
    tags: formData.get("tags")?.toString().trim() || "",
    ask: parseNumber(formData.get("ask")),
    lastGift: formData.get("lastGift")?.toString().trim() || "",
    pictureUrl: formData.get("pictureUrl")?.toString().trim() || "",
    notes: formData.get("notes")?.toString().trim() || "",
    biography: formData.get("biography")?.toString().trim() || "",
    history: [...state.history],
    assignedClientIds: selectedClients,
    exclusiveDonor: state.exclusiveDonor,
    exclusiveClientId: state.exclusiveDonor ? state.exclusiveClientId : null,
    createdBy: "donor-editor",
  };

  const isOrganization = payload.donorType === "business" || payload.donorType === "campaign";
  payload.isBusiness = isOrganization;
  payload.businessName = isOrganization ? payload.organizationName : "";
  if (isOrganization) {
    if (!payload.organizationName) {
      setStatus(
        payload.donorType === "campaign"
          ? "Campaign and PAC donors must include an organization name."
          : "Business and organization donors must include an organization name.",
        "error",
      );
      return;
    }
    if (!payload.contactFirstName || !payload.contactLastName) {
      setStatus("Add a primary contact first and last name for this organization.", "error");
      return;
    }
  } else {
    payload.contactFirstName = "";
    payload.contactLastName = "";
  }

  try {
    const result = await fetchJson("/api/donors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setStatus("Donor saved", "success");
    try {
      if (callbacks.onSuccess) {
        await callbacks.onSuccess(result);
      }
    } catch (callbackError) {
      console.error("Donor editor success handler failed", callbackError);
    } finally {
      resetDonorEditorForm({ preserveStatus: true });
    }
  } catch (error) {
    console.error("Failed to create donor", error);
    setStatus("We couldn't save this donor.", "error");
  }
}

function handleAddHistory() {
  const yearValue = parseInt(elements.historyYear.value, 10);
  const candidate = elements.historyCandidate.value.trim();
  const office = elements.historyOffice ? elements.historyOffice.value.trim() : "";
  const amountValue = parseNumber(elements.historyAmount.value);
  if (!candidate && Number.isNaN(yearValue) && amountValue === null) {
    return;
  }
  const entry = {
    id: createId(`${Date.now()}-${elements.historyYear.value}-${candidate}-${elements.historyAmount.value}`),
    year: Number.isNaN(yearValue) ? undefined : yearValue,
    candidate,
    officeSought: office,
    amount: amountValue,
  };
  state.history.push(entry);
  sortHistory();
  renderHistory();
  elements.historyYear.value = "";
  elements.historyCandidate.value = "";
  if (elements.historyOffice) elements.historyOffice.value = "";
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
  if (state.exclusiveDonor && state.exclusiveClientId) {
    return;
  }
  if (!state.clients.length) return;
  const allSelected = state.clients.every((client) => state.assignedClients.has(client.id));
  if (allSelected) {
    state.assignedClients.clear();
  } else {
    state.clients.forEach((client) => state.assignedClients.add(client.id));
  }
  renderAssignments();
}

function handleExclusiveToggle(event) {
  const shouldLock = event.target.value === "yes";
  if (shouldLock && !state.clients.length) {
    event.target.value = "no";
    state.exclusiveDonor = false;
    setStatus("Add a campaign before locking this donor to one candidate.", "error");
    return;
  }
  state.exclusiveDonor = shouldLock;
  if (state.exclusiveDonor) {
    const assigned = state.assignedClients.size ? [...state.assignedClients][0] : "";
    const validAssigned = assigned && state.clients.some((client) => client.id === assigned);
    if (validAssigned) {
      state.exclusiveClientId = assigned;
    } else {
      state.exclusiveClientId = state.clients.length ? state.clients[0].id : "";
    }
    if (state.exclusiveClientId) {
      state.assignedClients = new Set([state.exclusiveClientId]);
    }
  } else {
    state.exclusiveClientId = state.exclusiveClientId || "";
  }
  renderExclusiveControls();
  renderAssignments();
}

function handleExclusiveClientChange(event) {
  const value = event.target.value || "";
  state.exclusiveClientId = value;
  if (value) {
    state.assignedClients = new Set([value]);
  }
  renderAssignments();
}

function handleDonorTypeChange() {
  updateIdentityFieldState();
}

function updateIdentityFieldState() {
  const type = elements.donorType?.value || "individual";
  const isOrganization = type === "business" || type === "campaign";
  if (elements.organizationName) {
    elements.organizationName.required = isOrganization;
    toggleIdentityGroup("organization", isOrganization);
  }
  if (elements.firstName) {
    elements.firstName.required = !isOrganization;
    toggleIdentityGroup("individual", !isOrganization);
  }
  if (elements.lastName) {
    elements.lastName.required = !isOrganization;
  }
  if (elements.contactFirstName) {
    elements.contactFirstName.required = isOrganization;
  }
  if (elements.contactLastName) {
    elements.contactLastName.required = isOrganization;
  }
  toggleIdentityGroup("organization-contact", isOrganization);
}

function toggleIdentityGroup(group, shouldShow) {
  const nodes = identityGroups[group] || [];
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.classList.toggle("hidden", !shouldShow);
    if (shouldShow) {
      node.removeAttribute("hidden");
      node.setAttribute("aria-hidden", "false");
    } else {
      node.setAttribute("hidden", "");
      node.setAttribute("aria-hidden", "true");
    }
  });
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
  const isExclusive = state.exclusiveDonor && !!state.exclusiveClientId;
  if (isExclusive) {
    elements.selectAll?.setAttribute("disabled", "true");
  } else {
    elements.selectAll?.removeAttribute("disabled");
  }
  state.clients.forEach((client) => {
    const label = document.createElement("label");
    label.className = "assignment-grid__item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = client.id;
    const isSelected = state.assignedClients.has(client.id);
    input.checked = isSelected;
    if (isExclusive) {
      const isExclusiveClient = client.id === state.exclusiveClientId;
      input.disabled = !isExclusiveClient;
      input.checked = isExclusiveClient;
      input.addEventListener("change", (event) => {
        if (!isExclusiveClient) {
          event.preventDefault();
          event.target.checked = false;
          return;
        }
        if (!event.target.checked) {
          event.preventDefault();
          event.target.checked = true;
        }
      });
    } else {
      input.addEventListener("change", (event) => {
        if (event.target.checked) {
          state.assignedClients.add(client.id);
        } else {
          state.assignedClients.delete(client.id);
        }
      });
    }
    const name = document.createElement("span");
    name.textContent = client.label || "Unnamed candidate";
    label.append(input, name);
    container.append(label);
  });
  updateSelectAllLabel();
}

function renderExclusiveControls() {
  if (elements.exclusiveToggle) {
    elements.exclusiveToggle.value = state.exclusiveDonor ? "yes" : "no";
  }
  const select = elements.exclusiveClient;
  if (!select) return;
  select.innerHTML = "";
  const hasClients = state.clients.length > 0;
  if (hasClients) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a campaign";
    placeholder.disabled = true;
    placeholder.hidden = true;
    select.append(placeholder);
    state.clients.forEach((client) => {
      const option = document.createElement("option");
      option.value = client.id;
      option.textContent = client.label || client.candidate || "Unnamed candidate";
      select.append(option);
    });
    if (state.exclusiveClientId && state.clients.some((client) => client.id === state.exclusiveClientId)) {
      select.value = state.exclusiveClientId;
    } else {
      select.value = "";
    }
  } else {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No campaigns available";
    select.append(option);
    select.value = "";
  }
  if (state.exclusiveDonor && hasClients) {
    select.removeAttribute("disabled");
  } else {
    select.setAttribute("disabled", "true");
  }
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
  head.innerHTML = "<tr><th>Year</th><th>Candidate</th><th>Office sought</th><th>Amount</th><th></th></tr>";
  table.append(head);
  const body = document.createElement("tbody");
  state.history.forEach((entry) => {
    const row = document.createElement("tr");
    const yearCell = document.createElement("td");
    yearCell.textContent = entry.year || "—";
    const candidateCell = document.createElement("td");
    candidateCell.textContent = entry.candidate || "—";
    const officeCell = document.createElement("td");
    officeCell.textContent = entry.officeSought || "—";
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
    row.append(yearCell, candidateCell, officeCell, amountCell, actionsCell);
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
    const candidateCompare = (a.candidate || "").localeCompare(b.candidate || "");
    if (candidateCompare !== 0) {
      return candidateCompare;
    }
    return (a.officeSought || "").localeCompare(b.officeSought || "");
  });
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
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

function setStatus(message, type) {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.dataset.state = type || "";
  if (!message) {
    delete elements.status.dataset.state;
  }
}

async function fetchJson(url, options) {
  try {
    const response = await managerFetch(url, options);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      handleUnauthorized();
    }
    throw error;
  }
}
import { managerFetch, UnauthorizedError, clearManagerSession } from "./auth.js";

function handleUnauthorized() {
  clearManagerSession();
  window.location.href = "manager.html";
}

