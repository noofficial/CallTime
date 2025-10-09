const state = {
  clients: [],
  donors: [],
  filteredDonors: [],
  statistics: null,
  selectedClientId: "",
  selectedClientName: "",
  assignedDonors: new Map(),
  assignedIds: new Set(),
  loadingAssignments: false,
  isClientFormVisible: false,
};

const elements = {
  stats: document.getElementById("manager-stats"),
  clients: document.getElementById("manager-clients"),
  donors: document.getElementById("manager-donors"),
  donorSearch: document.getElementById("manager-donor-search"),
  assignmentClient: document.getElementById("assignment-client"),
  assignmentAvailable: document.getElementById("assignment-unassigned"),
  assignmentAssigned: document.getElementById("assignment-assigned"),
  assignmentAvailableLabel: document.getElementById("assignment-available-label"),
  assignmentAssignedLabel: document.getElementById("assignment-assigned-label"),
  refresh: document.getElementById("refresh-overview"),
  createClient: document.getElementById("create-client"),
  clientFormContainer: document.getElementById("client-form"),
  clientForm: document.getElementById("client-create-form"),
  clientFormName: document.getElementById("client-form-name"),
  clientFormSheet: document.getElementById("client-form-sheet"),
  clientFormCancel: document.getElementById("client-form-cancel"),
  clientFormStatus: document.getElementById("client-form-status"),
  clientFormSubmit: document.getElementById("client-form-submit"),
};

init();

function init() {
  bindEvents();
  Promise.all([loadOverview(), loadDonors()]).catch((error) => reportError(error));
}

function bindEvents() {
  elements.donorSearch?.addEventListener("input", () => {
    applyDonorFilter();
    renderDonors();
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

  elements.refresh?.addEventListener("click", () => {
    Promise.all([loadOverview(), loadDonors()]).catch((error) => reportError(error));
  });

  elements.createClient?.addEventListener("click", () => {
    toggleClientForm(!state.isClientFormVisible);
  });

  elements.clientFormCancel?.addEventListener("click", () => {
    toggleClientForm(false);
  });

  elements.clientForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleCreateClientSubmit();
  });
}

async function loadOverview() {
  try {
    const response = await fetch("/api/manager/overview");
    if (!response.ok) throw new Error("Unable to load manager overview");
    const data = await response.json();
    state.clients = Array.isArray(data.clients) ? data.clients : [];
    state.statistics = data.statistics || null;
    renderStats();
    renderClients();
    populateAssignmentSelect();
  } catch (error) {
    reportError(error);
  }
}

async function loadDonors() {
  try {
    const response = await fetch("/api/manager/donors");
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
    const response = await fetch(`/api/client/${clientId}/donors`);
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

function renderStats() {
  const container = elements.stats;
  if (!container) return;
  container.innerHTML = "";
  if (!state.statistics) {
    container.innerHTML = `<p class="muted">Statistics unavailable. Try refreshing.</p>`;
    return;
  }

  const stats = [
    {
      label: "Total donors",
      value: state.statistics.totalDonors ?? 0,
    },
    {
      label: "Unassigned donors",
      value: state.statistics.unassignedDonors ?? 0,
    },
    {
      label: "Active clients",
      value: state.statistics.activeClients ?? 0,
    },
  ];

  const statGrid = document.createElement("div");
  statGrid.className = "stat-grid";

  stats.forEach((stat) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-value">${Number(stat.value).toLocaleString()}</div>
      <div class="stat-label">${stat.label}</div>
    `;
    statGrid.append(card);
  });

  container.append(statGrid);
}

function renderClients() {
  const container = elements.clients;
  if (!container) return;
  container.innerHTML = "";
  if (!state.clients.length) {
    container.innerHTML = `<p class="muted">No clients found. Create a client to get started.</p>`;
    return;
  }

  state.clients.forEach((client) => {
    const assigned = client.assigned_donors ?? 0;
    const totalCalls = client.total_calls ?? 0;
    const totalPledged = client.total_pledged ?? 0;
    const totalRaised = client.total_raised ?? 0;

    const card = document.createElement("div");
    card.className = "client-item";
    card.innerHTML = `
      <div class="client-header">
        <div>
          <h3 class="client-name">${client.name || "Unnamed campaign"}</h3>
          <p class="client-office">${client.candidate || "Candidate pending"}${client.office ? ` • ${client.office}` : ""}</p>
        </div>
        <div class="client-actions">
          <button class="btn btn--sm btn--outline" data-action="manage" data-client-id="${client.id}">Manage queue</button>
          <button class="btn btn--sm btn--danger" data-action="delete" data-client-id="${client.id}">Delete</button>
        </div>
      </div>
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
  });
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
    const response = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
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
    const response = await fetch(`/api/donors/${donorId}`, { method: "DELETE" });
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
    const response = await fetch("/api/manager/assign-donor", {
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
    const response = await fetch(`/api/manager/assign-donor/${clientId}/${donorId}`, {
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

async function handleCreateClientSubmit() {
  const form = elements.clientForm;
  if (!form) return;
  if (!form.reportValidity()) {
    return;
  }

  const name = elements.clientFormName?.value.trim() || "";
  const sheetUrl = elements.clientFormSheet?.value.trim() || "";
  if (!name) {
    setClientFormStatus("Campaign name is required.", "error");
    elements.clientFormName?.focus();
    return;
  }

  setClientFormBusy(true);
  setClientFormStatus("Saving…");

  try {
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sheet_url: sheetUrl }),
    });
    if (!response.ok) throw new Error("Unable to create client");
    await loadOverview();
    form.reset();
    setClientFormStatus("Client created successfully.", "success");
    elements.clientFormName?.focus();
  } catch (error) {
    setClientFormStatus(error.message || "Unable to create client.", "error");
  } finally {
    setClientFormBusy(false);
  }
}

function reportError(error) {
  console.error(error);
  window.alert(error.message || "An unexpected error occurred.");
}

function toggleClientForm(shouldShow) {
  if (!elements.clientFormContainer || !elements.createClient) return;
  if (shouldShow) {
    elements.clientFormContainer.classList.remove("hidden");
    elements.clientFormContainer.setAttribute("aria-hidden", "false");
    elements.createClient.setAttribute("aria-expanded", "true");
    elements.clientForm?.reset();
    setClientFormBusy(false);
    setClientFormStatus("");
    state.isClientFormVisible = true;
    window.requestAnimationFrame(() => {
      elements.clientFormName?.focus();
    });
  } else {
    elements.clientFormContainer.classList.add("hidden");
    elements.clientFormContainer.setAttribute("aria-hidden", "true");
    elements.createClient.setAttribute("aria-expanded", "false");
    elements.clientForm?.reset();
    setClientFormStatus("");
    state.isClientFormVisible = false;
  }
}

function setClientFormBusy(isBusy) {
  if (elements.clientFormSubmit) {
    elements.clientFormSubmit.disabled = isBusy;
    elements.clientFormSubmit.textContent = isBusy ? "Saving…" : "Create client";
  }
  if (elements.clientFormCancel) {
    elements.clientFormCancel.disabled = isBusy;
  }
  if (elements.createClient) {
    elements.createClient.disabled = isBusy;
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
