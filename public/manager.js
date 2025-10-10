import {
  managerFetch,
  UnauthorizedError,
  getManagerToken,
  setManagerToken,
  clearManagerSession,
} from "./auth.js";

const state = {
  clients: [],
  donors: [],
  filteredDonors: [],
  selectedClientId: "",
  selectedClientName: "",
  assignedDonors: new Map(),
  assignedIds: new Set(),
  loadingAssignments: false,
  isClientModalOpen: false,
  currentClientId: "",
  clientSelectionTouched: false,
  clientFormMode: "create",
  editingClientId: null,
  hasBoundEvents: false,
  initialized: false,
};

const elements = {
  clients: document.getElementById("manager-clients"),
  clientSelector: document.getElementById("client-selector"),
  editClient: document.getElementById("edit-client"),
  donors: document.getElementById("manager-donors"),
  donorSearch: document.getElementById("manager-donor-search"),
  assignmentClient: document.getElementById("assignment-client"),
  assignmentAvailable: document.getElementById("assignment-unassigned"),
  assignmentAssigned: document.getElementById("assignment-assigned"),
  assignmentAvailableLabel: document.getElementById("assignment-available-label"),
  assignmentAssignedLabel: document.getElementById("assignment-assigned-label"),
  createClient: document.getElementById("create-client"),
  clientForm: document.getElementById("client-create-form"),
  clientFormName: document.getElementById("client-form-name"),
  clientFormCandidate: document.getElementById("client-form-candidate"),
  clientFormOffice: document.getElementById("client-form-office"),
  clientFormManager: document.getElementById("client-form-manager"),
  clientFormEmail: document.getElementById("client-form-email"),
  clientFormPhone: document.getElementById("client-form-phone"),
  clientFormLaunch: document.getElementById("client-form-launch"),
  clientFormGoal: document.getElementById("client-form-goal"),
  clientFormSheet: document.getElementById("client-form-sheet"),
  clientFormNotes: document.getElementById("client-form-notes"),
  clientFormPassword: document.getElementById("client-form-password"),
  clientFormCancel: document.getElementById("client-form-cancel"),
  clientFormStatus: document.getElementById("client-form-status"),
  clientFormSubmit: document.getElementById("client-form-submit"),
  clientModal: document.getElementById("client-modal"),
  clientModalTitle: document.getElementById("client-modal-title"),
  clientModalDescription: document.getElementById("client-modal-description"),
  logout: document.getElementById("manager-logout"),
  clientResetPassword: document.getElementById("client-reset-password"),
};

const authElements = {
  screen: document.getElementById("manager-login-screen"),
  form: document.getElementById("manager-login-form"),
  password: document.getElementById("manager-login-password"),
  status: document.getElementById("manager-login-status"),
};

let clientModalTrigger = null;

bootstrap();

function bootstrap() {
  bindAuthEvents();
  updateResetPasswordButtonVisibility();
  const token = getManagerToken();
  if (token) {
    hideLoginScreen();
    initializeWorkspace();
  } else {
    showLoginScreen();
  }
}

async function performLogout(message = "You have been signed out.") {
  const token = getManagerToken();
  if (token) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.warn("Manager logout request failed", error);
    }
  }
  clearManagerSession();
  state.clients = [];
  state.donors = [];
  state.filteredDonors = [];
  state.selectedClientId = "";
  state.selectedClientName = "";
  state.assignedIds = new Set();
  state.assignedDonors = new Map();
  state.loadingAssignments = false;
  state.initialized = false;
  renderClients();
  renderDonors();
  renderAssignmentLists();
  showLoginScreen(message);
}

function bindAuthEvents() {
  authElements.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleManagerLogin();
  });
}

function showLoginScreen(message = "") {
  authElements.screen?.classList.remove("hidden");
  if (message && authElements.status) {
    authElements.status.textContent = message;
  }
  if (authElements.password) {
    authElements.password.value = "";
    authElements.password.focus();
  }
}

function hideLoginScreen() {
  authElements.screen?.classList.add("hidden");
  if (authElements.status) {
    authElements.status.textContent = "";
  }
  if (authElements.password) {
    authElements.password.value = "";
  }
}

async function handleManagerLogin() {
  if (!authElements.password) return;
  const password = authElements.password.value.trim();
  if (!password) {
    if (authElements.status) {
      authElements.status.textContent = "Enter your manager password.";
    }
    authElements.password.focus();
    return;
  }

  try {
    authElements.form?.classList.add("auth-form--busy");
    const response = await fetch("/api/auth/manager-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      throw new Error("Invalid password. Please try again.");
    }
    const payload = await response.json();
    setManagerToken(payload.token);
    hideLoginScreen();
    initializeWorkspace();
  } catch (error) {
    if (authElements.status) {
      authElements.status.textContent = error.message || "Unable to sign in.";
    }
    authElements.password?.focus();
  } finally {
    authElements.form?.classList.remove("auth-form--busy");
  }
}

function initializeWorkspace() {
  if (state.initialized) {
    refreshWorkspace();
    return;
  }
  bindEvents();
  refreshWorkspace();
  state.initialized = true;
}

function refreshWorkspace() {
  Promise.all([loadOverview(), loadDonors()]).catch((error) => reportError(error));
}

function init() {
  initializeWorkspace();
}

function bindEvents() {
  if (state.hasBoundEvents) return;
  state.hasBoundEvents = true;
  elements.donorSearch?.addEventListener("input", () => {
    applyDonorFilter();
    renderDonors();
  });

  elements.clientSelector?.addEventListener("change", (event) => {
    state.clientSelectionTouched = true;
    state.currentClientId = event.target.value;
    renderClients();
  });

  elements.editClient?.addEventListener("click", () => {
    const client = getCurrentClient();
    if (!client) return;
    openEditClientModal(client, elements.editClient);
  });

  elements.assignmentClient?.addEventListener("change", async () => {
    const clientId = elements.assignmentClient.value;
    if (!clientId) {
      state.selectedClientId = "";
      state.selectedClientName = "";
      state.assignedIds = new Set();
      renderAssignmentLists();
      return;
    }
    await loadAssignmentsForClient(clientId);
  });

  elements.assignmentAvailable?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-donor-id]");
    if (!target || !state.selectedClientId) return;
    const donorId = target.getAttribute("data-donor-id");
    assignDonor(state.selectedClientId, donorId);
  });

  elements.assignmentAssigned?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-donor-id]");
    if (!target || !state.selectedClientId) return;
    const donorId = target.getAttribute("data-donor-id");
    unassignDonor(state.selectedClientId, donorId);
  });

  elements.createClient?.addEventListener("click", (event) => {
    openCreateClientModal(event.currentTarget || event.target);
  });

  elements.clientFormCancel?.addEventListener("click", () => {
    closeClientModal();
  });

  elements.clientModal?.addEventListener("click", (event) => {
    const dismiss = event.target.closest("[data-modal-dismiss]");
    if (dismiss) {
      event.preventDefault();
      closeClientModal();
    }
  });

  document.addEventListener("keydown", handleClientModalKeydown);

  elements.clientForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleClientFormSubmit();
  });

  elements.clientResetPassword?.addEventListener("click", () => {
    handlePortalPasswordReset();
  });

  elements.logout?.addEventListener("click", () => {
    performLogout();
  });
}

async function loadOverview() {
  try {
    const response = await managerFetch("/api/manager/overview");
    if (!response.ok) throw new Error("Unable to load manager overview");
    const data = await response.json();
    state.clients = Array.isArray(data.clients) ? data.clients : [];
    ensureCurrentClientSelection();
    renderClients();
    populateAssignmentSelect();
  } catch (error) {
    reportError(error);
  }
}

async function loadDonors() {
  try {
    const response = await managerFetch("/api/manager/donors");
    if (!response.ok) throw new Error("Unable to load donors");
    const donors = await response.json();
    state.donors = Array.isArray(donors) ? donors : [];
    applyDonorFilter();
    renderDonors();
    renderAssignmentLists();
  } catch (error) {
    reportError(error);
  }
}

async function loadAssignmentsForClient(clientId) {
  try {
    state.loadingAssignments = true;
    const response = await managerFetch(`/api/client/${clientId}/donors`);
    if (!response.ok) throw new Error("Unable to load assignments for client");
    const donors = await response.json();
    state.selectedClientId = clientId;
    const client = state.clients.find((item) => String(item.id) === String(clientId));
    state.selectedClientName = client?.name || client?.candidate || "Selected client";
    state.assignedIds = new Set(donors.map((donor) => String(donor.id)));
    state.assignedDonors = new Map(donors.map((donor) => [String(donor.id), donor]));
  } catch (error) {
    reportError(error);
  } finally {
    state.loadingAssignments = false;
    renderAssignmentLists();
  }
}

function ensureCurrentClientSelection() {
  if (!state.clients.length) {
    state.currentClientId = "";
    state.clientSelectionTouched = false;
    return;
  }

  if (!state.clientSelectionTouched && !state.currentClientId) {
    state.currentClientId = String(state.clients[0].id);
    return;
  }

  if (state.currentClientId) {
    const exists = state.clients.some((client) => String(client.id) === String(state.currentClientId));
    if (!exists) {
      state.clientSelectionTouched = false;
      state.currentClientId = String(state.clients[0].id);
    }
  }
}

function getCurrentClient() {
  if (!state.currentClientId) return null;
  return state.clients.find((client) => String(client.id) === String(state.currentClientId)) || null;
}

function updateEditClientButton() {
  if (!elements.editClient) return;
  elements.editClient.disabled = !Boolean(getCurrentClient());
}

function renderClients() {
  const container = elements.clients;
  if (!container) return;
  if (elements.clientSelector) {
    const select = elements.clientSelector;
    const previousValue = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a client";
    select.append(placeholder);

    state.clients.forEach((client) => {
      const option = document.createElement("option");
      option.value = client.id;
      option.textContent = client.name || client.candidate || "Unnamed campaign";
      select.append(option);
    });

    if (state.currentClientId && state.clients.some((client) => String(client.id) === String(state.currentClientId))) {
      select.value = state.currentClientId;
    } else if (!state.clientSelectionTouched && state.clients.length) {
      state.currentClientId = String(state.clients[0].id);
      select.value = state.currentClientId;
    } else if (!state.currentClientId) {
      select.value = "";
    } else if (previousValue && previousValue !== select.value) {
      select.value = previousValue;
    }
  }

  updateEditClientButton();

  container.innerHTML = "";
  if (!state.clients.length) {
    container.innerHTML = `<p class="muted">No clients found. Create a client to get started.</p>`;
    return;
  }

  if (!state.currentClientId) {
    container.innerHTML = `<p class="muted">Select a client to see campaign details.</p>`;
    return;
  }

  const client = getCurrentClient();
  if (!client) {
    container.innerHTML = `<p class="muted">Select a client to see campaign details.</p>`;
    return;
  }

  const assigned = client.assigned_donors ?? 0;
  const totalCalls = client.total_calls ?? 0;
  const totalPledged = client.total_pledged ?? 0;
  const totalRaised = client.total_raised ?? 0;

  const clientName = client.name || "Unnamed campaign";
  const candidateName = client.candidate || "";
  const office = client.office || "";
  const headerSubtitleParts = [];
  if (candidateName) {
    headerSubtitleParts.push(candidateName);
  }
  if (office) {
    headerSubtitleParts.push(office);
  }
  if (!headerSubtitleParts.length) {
    headerSubtitleParts.push("Candidate pending");
  }
  const headerSubtitle = headerSubtitleParts.join(" • ");

  const managerName = client.manager_name || client.managerName || "";
  const contactEmail = client.contact_email || client.contactEmail || "";
  const contactPhone = client.contact_phone || client.contactPhone || "";
  const launchDate = client.launch_date || client.launchDate || "";
  const fundraisingGoal = client.fundraising_goal ?? client.fundraisingGoal ?? "";
  const sheetUrl = client.sheet_url || client.sheetUrl || "";
  const notes = client.notes || "";

  const metaHtml = [
    renderClientMetaItem("Campaign manager", managerName),
    renderClientMetaItem("Contact", formatContact(contactEmail, contactPhone)),
    renderClientMetaItem("Launch date", formatLaunchDate(launchDate)),
    renderClientMetaItem("Fundraising goal", formatFundraisingGoal(fundraisingGoal)),
    renderClientMetaItem("Data source", formatDataSource(sheetUrl)),
  ].join("");

  const notesHtml = notes
    ? `<div class="client-notes"><h4 class="client-notes__title">Notes</h4><p class="client-notes__body">${escapeHtml(notes)}</p></div>`
    : "";

  const card = document.createElement("div");
  card.className = "client-item client-item--detail";
  card.innerHTML = `
      <div class="client-header">
        <div>
          <h3 class="client-name">${escapeHtml(clientName)}</h3>
          <p class="client-office">${escapeHtml(headerSubtitle)}</p>
        </div>
        <div class="client-actions">
          <button class="btn btn--sm btn--outline" data-action="manage" data-client-id="${client.id}">Manage queue</button>
          <button class="btn btn--sm btn--danger" data-action="delete" data-client-id="${client.id}">Delete</button>
        </div>
      </div>
      <div class="client-meta">${metaHtml}</div>
      <div class="client-stats">
        <div class="stat-item">
          <div class="stat-value">${assigned}</div>
          <div class="stat-label">Assigned donors</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${totalCalls}</div>
          <div class="stat-label">Recorded calls</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">$${Number(totalPledged).toLocaleString()}</div>
          <div class="stat-label">Pledged</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">$${Number(totalRaised).toLocaleString()}</div>
          <div class="stat-label">Raised</div>
        </div>
      </div>
      ${notesHtml}
    `;

  card
    .querySelector('[data-action="manage"]')
    ?.addEventListener("click", () => {
      if (!elements.assignmentClient) return;
      elements.assignmentClient.value = client.id;
      elements.assignmentClient.dispatchEvent(new Event("change"));
      window.scrollTo({ top: elements.assignmentClient.offsetTop - 80, behavior: "smooth" });
    });

  card
    .querySelector('[data-action="delete"]')
    ?.addEventListener("click", () => {
      handleDeleteClient(client.id);
    });

  container.append(card);
}

function applyDonorFilter() {
  const term = elements.donorSearch?.value.trim().toLowerCase() || "";
  if (!term) {
    state.filteredDonors = [...state.donors];
    return;
  }
  state.filteredDonors = state.donors.filter((donor) => {
    const haystack = [
      donor.name,
      donor.first_name,
      donor.last_name,
      donor.company,
      donor.city,
      donor.industry,
      donor.email,
      donor.phone,
      donor.tags,
      donor.assigned_clients,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

function renderDonors() {
  const container = elements.donors;
  if (!container) return;
  container.innerHTML = "";
  if (!state.filteredDonors.length) {
    container.innerHTML = `<p class="muted">No donors match the current search.</p>`;
    return;
  }

  state.filteredDonors.forEach((donor) => {
    const row = document.createElement("div");
    row.className = "donor-item donor-item--row";

    const name = donor.name || `${donor.first_name || ""} ${donor.last_name || ""}`.trim() || "Unnamed donor";
    const city = donor.city ? donor.city : "";
    const company = donor.company || donor.employer || "";
    const capacity = donor.capacity || donor.suggested_ask || 0;
    const assignments = donor.assigned_clients
      ? donor.assigned_clients.split(",").map((item) => item.trim()).filter(Boolean)
      : [];

    row.innerHTML = `
      <div class="donor-info">
        <div class="donor-name">${name}</div>
        <div class="donor-details">
          ${company ? `${company}` : "Unknown employer"}
          ${city ? ` • ${city}` : ""}
          ${capacity ? ` • Capacity: $${Number(capacity).toLocaleString()}` : ""}
        </div>
        <div class="donor-tags">${renderTags(donor.tags)}</div>
      </div>
      <div class="donor-actions">
        <span class="status status--info">${assignments.length} assigned</span>
        <button class="btn btn--sm btn--danger" data-delete-donor-id="${donor.id}">Delete</button>
      </div>
    `;

    if (assignments.length) {
      const list = document.createElement("ul");
      list.className = "assignment-pill-list";
      assignments.forEach((assignment) => {
        const item = document.createElement("li");
        item.textContent = assignment;
        list.append(item);
      });
      row.querySelector(".donor-actions")?.append(list);
    }

    row
      .querySelector("[data-delete-donor-id]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        handleDeleteDonor(donor.id);
      });

    container.append(row);
  });
}

function renderTags(raw) {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    return raw.map((tag) => `<span class="tag">${tag}</span>`).join(" ");
  }
  return String(raw)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => `<span class="tag">${tag}</span>`)
    .join(" ");
}

function populateAssignmentSelect() {
  const select = elements.assignmentClient;
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a client";
  select.append(placeholder);
  state.clients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.name || client.candidate || "Unnamed campaign";
    select.append(option);
  });
  if (previous && state.clients.some((client) => String(client.id) === String(previous))) {
    select.value = previous;
  }
}

function renderAssignmentLists() {
  const availableContainer = elements.assignmentAvailable;
  const assignedContainer = elements.assignmentAssigned;
  if (!availableContainer || !assignedContainer) return;

  availableContainer.innerHTML = "";
  assignedContainer.innerHTML = "";

  if (elements.assignmentAvailableLabel) {
    elements.assignmentAvailableLabel.textContent = "Available donors";
  }
  if (elements.assignmentAssignedLabel) {
    elements.assignmentAssignedLabel.textContent = state.selectedClientId
      ? `Assigned to ${state.selectedClientName || "client"}`
      : "Assigned donors";
  }

  if (!state.selectedClientId) {
    assignedContainer.innerHTML = `<p class="muted">Select a client to manage assignments.</p>`;
    return;
  }

  if (state.loadingAssignments) {
    assignedContainer.innerHTML = `<p class="muted">Loading assignments…</p>`;
    return;
  }

  const assignedIds = state.assignedIds;
  const assignedList = Array.from(assignedIds)
    .map((id) => state.assignedDonors.get(id) || state.donors.find((donor) => String(donor.id) === id))
    .filter(Boolean);

  const unassignedList = state.donors.filter((donor) => !assignedIds.has(String(donor.id)));

  if (!unassignedList.length) {
    availableContainer.innerHTML = `<p class="muted">All donors are currently assigned.</p>`;
  } else {
    unassignedList.forEach((donor) => {
      availableContainer.append(renderAssignmentCard(donor, "assign"));
    });
  }

  if (!assignedList.length) {
    assignedContainer.innerHTML = `<p class="muted">No donors assigned yet.</p>`;
  } else {
    assignedContainer.innerHTML = "";
    assignedList.forEach((donor) => {
      assignedContainer.append(renderAssignmentCard(donor, "unassign"));
    });
  }
}

async function handleDeleteClient(clientId) {
  const client = state.clients.find((item) => String(item.id) === String(clientId));
  const label = client?.name || client?.candidate || "this client";
  const confirmed = window.confirm(
    `Delete ${label}? This will remove the client and any related call records. This action cannot be undone.`,
  );
  if (!confirmed) return;

  try {
    const response = await managerFetch(`/api/clients/${clientId}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Unable to delete client");

    if (String(state.selectedClientId) === String(clientId)) {
      state.selectedClientId = "";
      state.selectedClientName = "";
      state.assignedIds = new Set();
      state.assignedDonors = new Map();
      if (elements.assignmentClient) {
        elements.assignmentClient.value = "";
      }
    }

    if (String(state.currentClientId) === String(clientId)) {
      state.currentClientId = "";
      state.clientSelectionTouched = false;
    }

    await loadOverview();
    await loadDonors();
  } catch (error) {
    reportError(error);
  }
}

async function handleDeleteDonor(donorId) {
  const donor = state.donors.find((item) => String(item.id) === String(donorId));
  const name =
    donor?.name || `${donor?.first_name || ""} ${donor?.last_name || ""}`.trim() || "this donor";
  const confirmed = window.confirm(
    `Delete ${name}? This will remove the donor and all related history. This action cannot be undone.`,
  );
  if (!confirmed) return;

  try {
    const response = await managerFetch(`/api/donors/${donorId}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Unable to delete donor");

    await loadOverview();
    await loadDonors();
  } catch (error) {
    reportError(error);
  }
}

function renderAssignmentCard(donor, mode) {
  const card = document.createElement("div");
  card.className = `assignable-donor${mode === "unassign" ? " assigned" : ""}`;
  card.setAttribute("data-donor-id", donor.id);
  const name = donor.name || `${donor.first_name || ""} ${donor.last_name || ""}`.trim() || "Unnamed donor";
  const company = donor.company || donor.employer || "";
  card.innerHTML = `
    <div class="donor-name">${name}</div>
    <div class="donor-details">${company || "No employer on file"}</div>
  `;
  return card;
}

async function assignDonor(clientId, donorId) {
  try {
    const response = await managerFetch("/api/manager/assign-donor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, donorId }),
    });
    if (!response.ok) throw new Error("Unable to assign donor");
    state.assignedIds.add(String(donorId));
    await loadAssignmentsForClient(clientId);
    await loadDonors();
  } catch (error) {
    reportError(error);
  }
}

async function unassignDonor(clientId, donorId) {
  try {
    const response = await managerFetch(`/api/manager/assign-donor/${clientId}/${donorId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Unable to remove donor assignment");
    state.assignedIds.delete(String(donorId));
    await loadAssignmentsForClient(clientId);
    await loadDonors();
  } catch (error) {
    reportError(error);
  }
}

function readClientFormValues() {
  return {
    name: elements.clientFormName?.value.trim() || "",
    candidate: elements.clientFormCandidate?.value.trim() || "",
    office: elements.clientFormOffice?.value.trim() || "",
    managerName: elements.clientFormManager?.value.trim() || "",
    contactEmail: elements.clientFormEmail?.value.trim() || "",
    contactPhone: elements.clientFormPhone?.value.trim() || "",
    launchDate: elements.clientFormLaunch?.value.trim() || "",
    goalInput: elements.clientFormGoal?.value.trim() || "",
    fundraisingGoal: parseFundraisingGoal(elements.clientFormGoal?.value.trim() || ""),
    sheetUrl: elements.clientFormSheet?.value.trim() || "",
    notes: elements.clientFormNotes?.value.trim() || "",
  };
}

async function handleClientFormSubmit() {
  const form = elements.clientForm;
  if (!form) return;
  if (!form.reportValidity()) {
    return;
  }

  const values = readClientFormValues();
  const {
    name,
    candidate,
    office,
    managerName,
    contactEmail,
    contactPhone,
    launchDate,
    goalInput,
    fundraisingGoal,
    sheetUrl,
    notes,
  } = values;

  if (!name) {
    setClientFormStatus("Campaign name is required.", "error");
    elements.clientFormName?.focus();
    return;
  }

  if (goalInput && fundraisingGoal === null) {
    setClientFormStatus("Enter a valid fundraising goal amount.", "error");
    elements.clientFormGoal?.focus();
    return;
  }

  setClientFormBusy(true);
  setClientFormStatus("Saving…");

  try {
    const isEditMode = state.clientFormMode === "edit";
    const targetId = state.editingClientId;
    const endpoint = isEditMode ? `/api/clients/${targetId}` : "/api/clients";
    const method = isEditMode ? "PUT" : "POST";

    if (!isEditMode && portalPassword.length < 6) {
      setClientFormStatus("Set a password with at least 6 characters.", "error");
      elements.clientFormPassword?.focus();
      return;
    }

    if (isEditMode && portalPassword && portalPassword.length < 6) {
      setClientFormStatus("Updated passwords must be at least 6 characters.", "error");
      elements.clientFormPassword?.focus();
      return;
    }

    if (isEditMode && !targetId) {
      throw new Error("No client selected for editing");
    }

    const payload = {
      name,
      candidate,
      office,
      managerName,
      contactEmail,
      contactPhone,
      launchDate,
      fundraisingGoal,
      sheetUrl,
      notes,
    };

    const response = await managerFetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(isEditMode ? "Unable to update client" : "Unable to create client");
    }

    let createdId = null;
    try {
      const payload = await response.json();
      if (payload && typeof payload === "object") {
        createdId = payload.id ?? null;
      }
    } catch (error) {
      // ignore JSON parsing errors for empty responses
    }

    if (!isEditMode && createdId) {
      state.currentClientId = String(createdId);
      state.clientSelectionTouched = true;
    }

    await loadOverview();

    if (isEditMode) {
      setClientFormStatus("Client updated successfully.", "success");
      window.setTimeout(() => {
        closeClientModal();
      }, 600);
    } else {
      form.reset();
      setClientFormStatus("Client created successfully.", "success");
      elements.clientFormName?.focus();
    }
  } catch (error) {
    const isEditMode = state.clientFormMode === "edit";
    setClientFormStatus(
      error.message || (isEditMode ? "Unable to update client." : "Unable to create client."),
      "error",
    );
  } finally {
    setClientFormBusy(false);
  }
}

async function handlePortalPasswordReset() {
  if (state.clientFormMode !== "edit" || !state.editingClientId) {
    setClientFormStatus("Open a client in edit mode to reset their password.", "error");
    return;
  }

  const values = readClientFormValues();
  if (!values.name) {
    setClientFormStatus("Add a campaign name before resetting the password.", "error");
    elements.clientFormName?.focus();
    return;
  }

  if (values.goalInput && values.fundraisingGoal === null) {
    setClientFormStatus("Enter a valid fundraising goal before resetting the password.", "error");
    elements.clientFormGoal?.focus();
    return;
  }

  setClientFormBusy(true);
  setClientFormStatus("Resetting portal password…");

  try {
    const response = await managerFetch(`/api/clients/${state.editingClientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        candidate: values.candidate,
        office: values.office,
        managerName: values.managerName,
        contactEmail: values.contactEmail,
        contactPhone: values.contactPhone,
        launchDate: values.launchDate,
        fundraisingGoal: values.fundraisingGoal,
        sheetUrl: values.sheetUrl,
        notes: values.notes,
        resetPortalPassword: true,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to reset the portal password.");
    }

    setClientFormStatus(
      "Portal password reset. Ask the client to sign in with password and choose a new one.",
      "success"
    );
  } catch (error) {
    setClientFormStatus(error.message || "Unable to reset the portal password.", "error");
  } finally {
    setClientFormBusy(false);
  }
}

function reportError(error) {
  if (error instanceof UnauthorizedError) {
    performLogout("Sign in to access the manager workspace.");
    return;
  }
  console.error(error);
  window.alert(error.message || "An unexpected error occurred.");
}

function openCreateClientModal(trigger = null) {
  prepareClientForm("create");
  showClientModal(trigger);
}

function openEditClientModal(client, trigger = null) {
  if (!client) return;
  prepareClientForm("edit", client);
  showClientModal(trigger);
}

function showClientModal(trigger = null) {
  if (!elements.clientModal) return;
  clientModalTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement;
  if (state.isClientModalOpen) {
    elements.clientFormName?.focus();
    return;
  }
  setClientFormBusy(false);
  elements.clientModal.classList.remove("hidden");
  elements.clientModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  state.isClientModalOpen = true;
  window.requestAnimationFrame(() => {
    elements.clientFormName?.focus();
  });
}

function closeClientModal() {
  if (!elements.clientModal || !state.isClientModalOpen) return;
  elements.clientModal.classList.add("hidden");
  elements.clientModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  state.isClientModalOpen = false;
  if (clientModalTrigger && typeof clientModalTrigger.focus === "function") {
    clientModalTrigger.focus();
  }
  clientModalTrigger = null;
  resetClientForm();
  setClientFormBusy(false);
}

function resetClientForm() {
  state.clientFormMode = "create";
  state.editingClientId = null;
  elements.clientForm?.reset();
  setClientFormStatus("");
  updateClientFormText();
  updateResetPasswordButtonVisibility();
}

function prepareClientForm(mode, client = null) {
  state.clientFormMode = mode === "edit" ? "edit" : "create";
  state.editingClientId = mode === "edit" && client ? client.id : null;
  setClientFormStatus("");
  if (mode === "edit" && client) {
    populateClientFormFromRecord(client);
  } else {
    elements.clientForm?.reset();
  }
  if (elements.clientFormPassword) {
    elements.clientFormPassword.value = "";
  }
  updateClientFormText(client);
  updateResetPasswordButtonVisibility();
}

function populateClientFormFromRecord(client) {
  if (!elements.clientForm) return;
  elements.clientFormName && (elements.clientFormName.value = client.name || "");
  elements.clientFormCandidate && (elements.clientFormCandidate.value = client.candidate || "");
  elements.clientFormOffice && (elements.clientFormOffice.value = client.office || "");
  const managerName = client.manager_name ?? client.managerName ?? "";
  if (elements.clientFormManager) {
    elements.clientFormManager.value = managerName;
  }
  const contactEmail = client.contact_email ?? client.contactEmail ?? "";
  if (elements.clientFormEmail) {
    elements.clientFormEmail.value = contactEmail;
  }
  const contactPhone = client.contact_phone ?? client.contactPhone ?? "";
  if (elements.clientFormPhone) {
    elements.clientFormPhone.value = contactPhone;
  }
  const launchDate = client.launch_date ?? client.launchDate ?? "";
  if (elements.clientFormLaunch) {
    elements.clientFormLaunch.value = launchDate;
  }
  const fundraisingGoal = client.fundraising_goal ?? client.fundraisingGoal ?? "";
  if (elements.clientFormGoal) {
    elements.clientFormGoal.value = fundraisingGoal === null ? "" : String(fundraisingGoal);
  }
  const sheetUrl = client.sheet_url ?? client.sheetUrl ?? "";
  if (elements.clientFormSheet) {
    elements.clientFormSheet.value = sheetUrl;
  }
  if (elements.clientFormNotes) {
    elements.clientFormNotes.value = client.notes || "";
  }
  if (elements.clientFormPassword) {
    elements.clientFormPassword.value = "";
  }
}

function updateClientFormText(client = null) {
  const isEditMode = state.clientFormMode === "edit";
  if (elements.clientModalTitle) {
    elements.clientModalTitle.textContent = isEditMode ? "Edit campaign client" : "New campaign client";
  }
  if (elements.clientModalDescription) {
    elements.clientModalDescription.textContent = isEditMode
      ? "Update the details so fundraisers stay aligned."
      : "Capture the key details so fundraisers have the context they need.";
  }
  if (elements.clientFormSubmit) {
    elements.clientFormSubmit.textContent = getClientFormSubmitLabel();
  }
  if (elements.editClient) {
    elements.editClient.disabled = !Boolean(getCurrentClient());
  }
  if (client && isEditMode && elements.clientFormName) {
    window.requestAnimationFrame(() => {
      elements.clientFormName?.focus();
      elements.clientFormName?.select?.();
    });
  }
}

function updateResetPasswordButtonVisibility() {
  if (!elements.clientResetPassword) return;
  if (state.clientFormMode === "edit") {
    elements.clientResetPassword.classList.remove("hidden");
    elements.clientResetPassword.disabled = false;
  } else {
    elements.clientResetPassword.classList.add("hidden");
    elements.clientResetPassword.disabled = true;
  }
}

function getClientFormSubmitLabel() {
  return state.clientFormMode === "edit" ? "Save changes" : "Create client";
}

function handleClientModalKeydown(event) {
  if (!state.isClientModalOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeClientModal();
  }
}

function setClientFormBusy(isBusy) {
  if (elements.clientFormSubmit) {
    elements.clientFormSubmit.disabled = isBusy;
    elements.clientFormSubmit.textContent = isBusy ? "Saving…" : getClientFormSubmitLabel();
  }
  if (elements.clientFormCancel) {
    elements.clientFormCancel.disabled = isBusy;
  }
  if (elements.createClient) {
    elements.createClient.disabled = isBusy;
  }
  if (elements.editClient && state.clientFormMode === "edit") {
    elements.editClient.disabled = isBusy;
  }
  if (elements.clientResetPassword) {
    elements.clientResetPassword.disabled = isBusy || state.clientFormMode !== "edit";
  }
}

function setClientFormStatus(message = "", tone = "info") {
  const status = elements.clientFormStatus;
  if (!status) return;
  status.textContent = message;
  status.className = "client-form__status";
  if (message && tone !== "info") {
    status.classList.add(`client-form__status--${tone}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseFundraisingGoal(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.]/g, "").trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function renderClientMetaItem(label, entry, options = {}) {
  const normalized =
    typeof entry === "object" && entry !== null && "value" in entry
      ? { value: entry.value, isHtml: Boolean(entry.isHtml) }
      : { value: entry, isHtml: Boolean(options.allowHtml) };
  const hasValue =
    normalized.value !== null &&
    normalized.value !== undefined &&
    !(typeof normalized.value === "string" && normalized.value.trim() === "");
  const display = hasValue
    ? normalized.isHtml
      ? normalized.value
      : escapeHtml(String(normalized.value))
    : '<span class="muted">Not set</span>';
  return `
    <div class="client-meta__item">
      <span class="client-meta__label">${escapeHtml(label)}</span>
      <span class="client-meta__value">${display}</span>
    </div>
  `;
}

function formatContact(email, phone) {
  const parts = [];
  if (email) {
    const trimmedEmail = email.trim();
    if (trimmedEmail) {
      parts.push(`<a href="mailto:${encodeURIComponent(trimmedEmail)}">${escapeHtml(trimmedEmail)}</a>`);
    }
  }
  if (phone) {
    const trimmedPhone = phone.trim();
    if (trimmedPhone) {
      const telHref = trimmedPhone.replace(/[^0-9+]/g, "");
      if (telHref) {
        parts.push(`<a href="tel:${telHref}">${escapeHtml(trimmedPhone)}</a>`);
      } else {
        parts.push(escapeHtml(trimmedPhone));
      }
    }
  }
  if (!parts.length) {
    return { value: "", isHtml: true };
  }
  return { value: parts.join("<br />"), isHtml: true };
}

function formatLaunchDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatFundraisingGoal(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "";
  }
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDataSource(url) {
  if (!url) {
    return { value: "", isHtml: true };
  }
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { value: parsed.href, isHtml: false };
    }
    const label = parsed.hostname.replace(/^www\./, "");
    return {
      value: `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
      isHtml: true,
    };
  } catch (error) {
    return { value: url, isHtml: false };
  }
}
