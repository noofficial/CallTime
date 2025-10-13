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
  bulkUpload: {
    file: null,
    fileName: "",
    uploading: false,
  },
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
  bulkUploadForm: document.getElementById("bulk-upload-form"),
  bulkUploadClient: document.getElementById("bulk-upload-client"),
  bulkUploadDropzone: document.getElementById("bulk-upload-dropzone"),
  bulkUploadInput: document.getElementById("bulk-upload-input"),
  bulkUploadFilename: document.getElementById("bulk-upload-filename"),
  bulkUploadStatus: document.getElementById("bulk-upload-status"),
  bulkUploadSubmit: document.getElementById("bulk-upload-submit"),
  bulkUploadClear: document.getElementById("bulk-upload-clear"),
};

const authElements = {
  screen: document.getElementById("manager-login-screen"),
  form: document.getElementById("manager-login-form"),
  password: document.getElementById("manager-login-password"),
  status: document.getElementById("manager-login-status"),
};

let clientModalTrigger = null;

if (typeof window === "undefined" || !window.__CALLTIME_TESTING__) {
  bootstrap();
}

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

async function performLogout(message = "You have been signed out.", options = {}) {
  const { redirect = true } = options;
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
  state.bulkUpload.file = null;
  state.bulkUpload.fileName = "";
  state.bulkUpload.uploading = false;
  clearBulkUploadFile();
  renderClients();
  renderDonors();
  renderAssignmentLists();
  showLoginScreen(message);
  if (redirect && typeof window !== "undefined") {
    window.location.assign("index.html");
  }
}

function bindAuthEvents() {
  authElements.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleManagerLogin();
  });
}

function showLoginScreen(message = "") {
  if (authElements.screen) {
    authElements.screen.classList.remove("hidden");
    authElements.screen.style.display = "";
    authElements.screen.setAttribute("aria-hidden", "false");
  }
  if (message && authElements.status) {
    authElements.status.textContent = message;
  }
  if (authElements.password) {
    authElements.password.value = "";
    authElements.password.focus();
  }
}

function hideLoginScreen() {
  if (authElements.screen) {
    authElements.screen.classList.add("hidden");
    authElements.screen.style.display = "none";
    authElements.screen.setAttribute("aria-hidden", "true");
  }
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

  elements.bulkUploadForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleBulkUploadSubmit();
  });

  elements.bulkUploadDropzone?.addEventListener("click", () => {
    if (state.bulkUpload.uploading) return;
    elements.bulkUploadInput?.click();
  });

  elements.bulkUploadDropzone?.addEventListener("keydown", (event) => {
    if (state.bulkUpload.uploading) return;
    handleBulkUploadKeydown(event);
  });

  elements.bulkUploadDropzone?.addEventListener("dragover", (event) => {
    if (state.bulkUpload.uploading) return;
    handleBulkUploadDragOver(event);
  });

  elements.bulkUploadDropzone?.addEventListener("dragenter", (event) => {
    if (state.bulkUpload.uploading) return;
    handleBulkUploadDragOver(event);
  });

  elements.bulkUploadDropzone?.addEventListener("dragleave", (event) => {
    if (state.bulkUpload.uploading) return;
    handleBulkUploadDragLeave(event);
  });

  elements.bulkUploadDropzone?.addEventListener("drop", (event) => {
    if (state.bulkUpload.uploading) {
      event.preventDefault();
      return;
    }
    handleBulkUploadDrop(event);
  });

  elements.bulkUploadInput?.addEventListener("change", (event) => {
    if (state.bulkUpload.uploading) return;
    handleBulkUploadInput(event);
  });

  elements.bulkUploadClear?.addEventListener("click", () => {
    if (state.bulkUpload.uploading) return;
    clearBulkUploadFile();
  });

  elements.bulkUploadClient?.addEventListener("change", () => {
    if (state.bulkUpload.uploading) return;
    clearBulkUploadStatus();
  });

  updateBulkUploadUI();
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
    populateBulkUploadClientSelect();
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
  const notes = client.notes || "";

  const metaHtml = [
    renderClientMetaItem("Campaign manager", managerName),
    renderClientMetaItem("Contact", formatContact(contactEmail, contactPhone)),
    renderClientMetaItem("Launch date", formatLaunchDate(launchDate)),
    renderClientMetaItem("Fundraising goal", formatFundraisingGoal(fundraisingGoal)),
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
      donor.state,
      donor.postal_code,
      donor.street_address,
      donor.address_line2,
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
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "No donors match the current search.";
    container.append(message);
    return;
  }

  state.filteredDonors.forEach((donor) => {
    const row = document.createElement("div");
    row.className = "donor-item donor-item--row";

    const name = donor.name || `${donor.first_name || ""} ${donor.last_name || ""}`.trim() || "Unnamed donor";
    const company = donor.company || donor.employer || "";
    const street = donor.street_address ? donor.street_address : "";
    const addressLine2 = donor.address_line2 ? donor.address_line2 : "";
    const locality = [donor.city, donor.state].filter(Boolean).join(", ");
    const postalCode = donor.postal_code ? donor.postal_code : "";
    const location = locality ? (postalCode ? `${locality} ${postalCode}` : locality) : postalCode;
    const addressSummary = [street, addressLine2, location].filter(Boolean).join(", ");
    const capacity = donor.capacity || donor.suggested_ask || 0;
    const assignments = donor.assigned_clients
      ? donor.assigned_clients.split(",").map((item) => item.trim()).filter(Boolean)
      : [];

    const info = document.createElement("div");
    info.className = "donor-info";

    const nameEl = document.createElement("div");
    nameEl.className = "donor-name";
    nameEl.textContent = name;
    info.append(nameEl);

    const details = document.createElement("div");
    details.className = "donor-details";
    const detailParts = [];
    detailParts.push(company ? company : "Unknown employer");
    if (addressSummary) {
      detailParts.push(addressSummary);
    }
    if (capacity) {
      detailParts.push(`Capacity: $${Number(capacity).toLocaleString()}`);
    }
    details.textContent = detailParts.filter(Boolean).join(" • ");
    info.append(details);

    const tagsContainer = document.createElement("div");
    tagsContainer.className = "donor-tags";
    const tags = renderTags(donor.tags);
    if (tags) {
      tagsContainer.innerHTML = tags;
    }
    info.append(tagsContainer);

    const actions = document.createElement("div");
    actions.className = "donor-actions";

    const statusPill = document.createElement("span");
    statusPill.className = "status status--info";
    statusPill.textContent = `${assignments.length} assigned`;
    actions.append(statusPill);

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn btn--sm btn--danger";
    deleteButton.dataset.deleteDonorId = String(donor.id);
    deleteButton.textContent = "Delete";
    actions.append(deleteButton);

    row.append(info, actions);

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

    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      handleDeleteDonor(donor.id);
    });

    container.append(row);
  });
}

function renderTags(raw) {
  if (!raw) return "";
  const tags = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  if (!tags.length) return "";
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(" ");
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

function populateBulkUploadClientSelect() {
  const select = elements.bulkUploadClient;
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "No client (import as unassigned)";
  select.append(placeholder);

  state.clients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.name || client.candidate || `Client ${client.id}`;
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
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "Select a client to manage assignments.";
    assignedContainer.append(message);
    return;
  }

  if (state.loadingAssignments) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "Loading assignments…";
    assignedContainer.append(message);
    return;
  }

  const assignedIds = state.assignedIds;
  const assignedList = Array.from(assignedIds)
    .map((id) => state.assignedDonors.get(id) || state.donors.find((donor) => String(donor.id) === id))
    .filter(Boolean);

  const unassignedList = state.donors.filter((donor) => !assignedIds.has(String(donor.id)));

  if (!unassignedList.length) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "All donors are currently assigned.";
    availableContainer.append(message);
  } else {
    unassignedList.forEach((donor) => {
      availableContainer.append(renderAssignmentCard(donor, "assign"));
    });
  }

  if (!assignedList.length) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "No donors assigned yet.";
    assignedContainer.append(message);
  } else {
    assignedContainer.innerHTML = "";
    assignedList.forEach((donor) => {
      assignedContainer.append(renderAssignmentCard(donor, "unassign"));
    });
  }
}

function removeClientLocally(clientId) {
  const targetId = String(clientId);
  state.clients = state.clients.filter((client) => String(client.id) !== targetId);

  if (String(state.selectedClientId) === targetId) {
    state.selectedClientId = "";
    state.selectedClientName = "";
    state.assignedIds = new Set();
    state.assignedDonors = new Map();
    if (elements.assignmentClient) {
      elements.assignmentClient.value = "";
    }
  }

  if (String(state.currentClientId) === targetId) {
    state.currentClientId = "";
    state.clientSelectionTouched = false;
  }

  ensureCurrentClientSelection();
  renderClients();
  populateAssignmentSelect();
  populateBulkUploadClientSelect();
  renderAssignmentLists();
}

function removeDonorLocally(donorId) {
  const targetId = String(donorId);
  state.donors = state.donors.filter((donor) => String(donor.id) !== targetId);
  state.assignedDonors.delete(targetId);
  state.assignedIds.delete(targetId);
  applyDonorFilter();
  renderDonors();
  renderAssignmentLists();
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

    removeClientLocally(clientId);

    const refreshTasks = [loadOverview(), loadDonors()];
    const assignmentsClientId = state.selectedClientId ? String(state.selectedClientId) : "";
    if (assignmentsClientId) {
      refreshTasks.push(loadAssignmentsForClient(assignmentsClientId));
    }
    await Promise.all(refreshTasks);
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

    removeDonorLocally(donorId);

    const refreshTasks = [loadOverview(), loadDonors()];
    const assignmentsClientId = state.selectedClientId ? String(state.selectedClientId) : "";
    if (assignmentsClientId) {
      refreshTasks.push(loadAssignmentsForClient(assignmentsClientId));
    }
    await Promise.all(refreshTasks);
  } catch (error) {
    reportError(error);
  }
}

function renderAssignmentCard(donor, mode) {
  const card = document.createElement("div");
  card.className = `assignable-donor${mode === "unassign" ? " assigned" : ""}`;
  card.dataset.donorId = String(donor.id);
  const name = donor.name || `${donor.first_name || ""} ${donor.last_name || ""}`.trim() || "Unnamed donor";
  const company = donor.company || donor.employer || "";
  const nameEl = document.createElement("div");
  nameEl.className = "donor-name";
  nameEl.textContent = name;
  const detailsEl = document.createElement("div");
  detailsEl.className = "donor-details";
  detailsEl.textContent = company || "No employer on file";
  card.append(nameEl, detailsEl);
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

async function handleBulkUploadSubmit() {
  if (state.bulkUpload.uploading) return;
  if (!state.bulkUpload.file) {
    setBulkUploadStatus("Choose a CSV or Excel file before importing.", "error");
    return;
  }

  setBulkUploadUploading(true);
  setBulkUploadStatus("Importing donors…");

  try {
    const formData = new FormData();
    formData.append("file", state.bulkUpload.file);
    const clientValue = elements.bulkUploadClient?.value?.trim();
    if (clientValue) {
      formData.append("clientId", clientValue);
    }

    const response = await managerFetch("/api/manager/donors/upload", {
      method: "POST",
      body: formData,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && payload.error
          ? payload.error
          : "Unable to import donors.";
      throw new Error(message);
    }

    const summary = payload && typeof payload === "object" ? payload.summary : null;
    setBulkUploadStatus(buildBulkUploadSummary(summary), "success");
    clearBulkUploadFile({ preserveStatus: true });
    await Promise.all([loadOverview(), loadDonors()]);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      reportError(error);
      return;
    }
    setBulkUploadStatus(error.message || "Unable to import donors.", "error");
  } finally {
    setBulkUploadUploading(false);
  }
}

function handleBulkUploadInput(event) {
  const file = event?.target?.files?.[0] || null;
  if (!file) {
    setBulkUploadFile(null);
    return;
  }
  setBulkUploadFile(file);
}

function handleBulkUploadDrop(event) {
  event.preventDefault();
  const file = event?.dataTransfer?.files?.[0] || null;
  setBulkUploadDropzoneActive(false);
  if (!file) return;
  setBulkUploadFile(file);
}

function handleBulkUploadDragOver(event) {
  event.preventDefault();
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  setBulkUploadDropzoneActive(true);
}

function handleBulkUploadDragLeave(event) {
  if (!elements.bulkUploadDropzone) return;
  const related = event?.relatedTarget;
  if (related && elements.bulkUploadDropzone.contains(related)) {
    return;
  }
  setBulkUploadDropzoneActive(false);
}

function handleBulkUploadKeydown(event) {
  if (!event) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.bulkUploadInput?.click();
  }
}

function setBulkUploadDropzoneActive(isActive) {
  if (!elements.bulkUploadDropzone) return;
  if (isActive) {
    elements.bulkUploadDropzone.classList.add("is-active");
  } else {
    elements.bulkUploadDropzone.classList.remove("is-active");
  }
}

function setBulkUploadFile(file) {
  if (!file) {
    state.bulkUpload.file = null;
    state.bulkUpload.fileName = "";
    if (elements.bulkUploadInput) {
      elements.bulkUploadInput.value = "";
    }
    updateBulkUploadUI();
    return;
  }

  const validationError = validateBulkUploadFile(file);
  if (validationError) {
    state.bulkUpload.file = null;
    state.bulkUpload.fileName = "";
    if (elements.bulkUploadInput) {
      elements.bulkUploadInput.value = "";
    }
    updateBulkUploadUI();
    setBulkUploadStatus(validationError, "error");
    return;
  }

  state.bulkUpload.file = file;
  state.bulkUpload.fileName = file.name || "Selected file";
  updateBulkUploadUI();
  setBulkUploadStatus(`Selected ${state.bulkUpload.fileName}. Ready to import.`);
}

function clearBulkUploadFile(options = {}) {
  state.bulkUpload.file = null;
  state.bulkUpload.fileName = "";
  if (elements.bulkUploadInput) {
    elements.bulkUploadInput.value = "";
  }
  if (!options?.preserveStatus) {
    clearBulkUploadStatus();
  }
  updateBulkUploadUI();
}

function setBulkUploadUploading(isUploading) {
  state.bulkUpload.uploading = Boolean(isUploading);
  if (elements.bulkUploadInput) {
    elements.bulkUploadInput.disabled = state.bulkUpload.uploading;
  }
  setBulkUploadDropzoneActive(false);
  updateBulkUploadUI();
}

function updateBulkUploadUI() {
  const file = state.bulkUpload.file;
  const uploading = state.bulkUpload.uploading;

  if (elements.bulkUploadFilename) {
    if (file) {
      const sizeText = typeof file.size === "number" ? ` (${formatFileSize(file.size)})` : "";
      const name = state.bulkUpload.fileName || file.name || "Selected file";
      elements.bulkUploadFilename.textContent = `${name}${sizeText}`;
    } else {
      elements.bulkUploadFilename.textContent = "";
    }
  }

  if (elements.bulkUploadSubmit) {
    elements.bulkUploadSubmit.disabled = !file || uploading;
  }

  if (elements.bulkUploadClear) {
    elements.bulkUploadClear.disabled = !file || uploading;
  }

  if (elements.bulkUploadDropzone) {
    elements.bulkUploadDropzone.classList.toggle("is-disabled", uploading);
    elements.bulkUploadDropzone.setAttribute("aria-busy", uploading ? "true" : "false");
    elements.bulkUploadDropzone.setAttribute("aria-disabled", uploading ? "true" : "false");
  }
}

function setBulkUploadStatus(message, tone = "") {
  if (!elements.bulkUploadStatus) return;
  elements.bulkUploadStatus.textContent = message || "";
  elements.bulkUploadStatus.classList.remove("form-status--error", "form-status--success");
  if (!message) {
    return;
  }
  if (tone === "error") {
    elements.bulkUploadStatus.classList.add("form-status--error");
  } else if (tone === "success") {
    elements.bulkUploadStatus.classList.add("form-status--success");
  }
}

function clearBulkUploadStatus() {
  setBulkUploadStatus("");
}

function validateBulkUploadFile(file) {
  if (!file) {
    return "Select a CSV or Excel file.";
  }

  const allowedExtensions = [".csv", ".xls", ".xlsx"];
  const allowedTypes = new Set([
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);

  const lowerName = (file.name || "").toLowerCase();
  const hasAllowedExtension = allowedExtensions.some((ext) => lowerName.endsWith(ext));
  const hasAllowedType = file.type ? allowedTypes.has(file.type) : false;
  if (!hasAllowedExtension && !hasAllowedType) {
    return "Use a CSV or Excel (.xlsx) file.";
  }

  if (typeof file.size === "number" && file.size > 10 * 1024 * 1024) {
    return "File is too large. Choose a file smaller than 10 MB.";
  }

  if (typeof file.size === "number" && file.size === 0) {
    return "The selected file is empty.";
  }

  return null;
}

function buildBulkUploadSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return "Import completed.";
  }

  const totalRows = Number(summary.totalRows) || 0;
  const inserted = Number(summary.inserted) || 0;
  const updated = Number(summary.updated) || 0;
  const skipped = Number(summary.skipped) || 0;
  const assigned = Number(summary.assigned) || 0;
  const unassigned = Number(summary.unassigned) || 0;
  const contributionsAdded = Number(summary.contributionsAdded) || 0;
  const contributionsSkipped = Number(summary.contributionsSkipped) || 0;
  const contributionErrors = Number(summary.contributionErrors) || 0;
  const ignoredColumns = Array.isArray(summary.ignoredColumns) ? summary.ignoredColumns : [];
  const errorCount = Number(summary.errorCount) || 0;
  const errors = Array.isArray(summary.errors) ? summary.errors : [];

  const parts = [];
  if (inserted) parts.push(`${inserted} new`);
  if (updated) parts.push(`${updated} updated`);
  if (skipped) parts.push(`${skipped} skipped`);

  let message = totalRows
    ? `Processed ${totalRows} row${totalRows === 1 ? "" : "s"}.`
    : "Import completed.";

  if (parts.length) {
    message += ` Breakdown: ${parts.join(", ")}.`;
  }

  if (ignoredColumns.length) {
    message += ` Ignored columns: ${ignoredColumns.join(", ")}.`;
  }

  const assignmentParts = [];
  if (assigned) assignmentParts.push(`${assigned} assigned`);
  if (unassigned) assignmentParts.push(`${unassigned} unassigned`);
  if (assignmentParts.length) {
    message += ` Assignments: ${assignmentParts.join(", ")}.`;
  }

  const contributionParts = [];
  if (contributionsAdded) contributionParts.push(`${contributionsAdded} added`);
  if (contributionsSkipped) contributionParts.push(`${contributionsSkipped} skipped`);
  if (contributionParts.length) {
    message += ` Contributions: ${contributionParts.join(", ")}.`;
  }

  if (contributionErrors) {
    message += ` Contribution issues on ${contributionErrors} row${contributionErrors === 1 ? "" : "s"}.`;
  }

  if (errorCount > 0) {
    message += ` ${errorCount} row${errorCount === 1 ? "" : "s"} skipped.`;
    if (errors.length) {
      message += ` Example: ${errors[0]}.`;
    }
  }

  return message.trim();
}

function formatFileSize(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reportError(error) {
  if (error instanceof UnauthorizedError) {
    performLogout("Sign in to access the manager workspace.", { redirect: false });
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

export const __TESTING__ = {
  state,
  elements,
  renderDonors,
  renderTags,
  renderAssignmentLists,
  renderAssignmentCard,
  escapeHtml,
};
