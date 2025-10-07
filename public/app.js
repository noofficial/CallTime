import { CallTimeDatabase, DATABASE_KEY } from "./database.js";

const STORAGE_KEYS = {
  interactions: "calltime:interactions:v1",
};

const STATUS_OPTIONS = [
  "Not Contacted",
  "No Answer",
  "Left Voicemail",
  "Call Back Scheduled",
  "Committed to Donate",
  "Received Contribution",
  "Do Not Call",
];

const STATUS_VARIANT = {
  "Not Contacted": "open",
  "No Answer": "waiting",
  "Left Voicemail": "waiting",
  "Call Back Scheduled": "waiting",
  "Committed to Donate": "waiting",
  "Received Contribution": "won",
  "Do Not Call": "closed",
};

const STATUS_DEFAULT_FIELDS = {
  "Left Voicemail": [
    { type: "date", name: "contactedOn", label: "Voicemail left", required: true },
  ],
  "Call Back Scheduled": [
    { type: "date", name: "followUpOn", label: "Follow-up date", required: true },
  ],
  "Committed to Donate": [
    { type: "date", name: "followUpOn", label: "Follow-up date", required: true },
    {
      type: "number",
      name: "pledgeAmount",
      label: "Pledge amount",
      min: 0,
      step: "25",
      placeholder: "500",
    },
  ],
  "Received Contribution": [
    {
      type: "number",
      name: "contributionAmount",
      label: "Contribution amount",
      min: 0,
      step: "25",
      required: true,
      placeholder: "1000",
    },
  ],
};

const db = new CallTimeDatabase();

maybeMigrateLegacyClients();

const DEMO_DATA = {
  clients: [
    {
      id: "client-northdale",
      label: "Avery for Northdale",
      candidate: "Avery Johnson",
      office: "State House District 14",
      timezone: "America/New_York",
      sheetUrl: "",
      donors: [
        {
          id: "d1",
          firstName: "Morgan",
          lastName: "Patel",
          name: "Morgan Patel",
          phone: "(312) 555-0199",
          email: "morgan@example.com",
          ask: 750,
          city: "Northdale",
          employer: "Patel Strategies",
          company: "Patel Strategies",
          industry: "Consulting",
          pictureUrl: "https://images.unsplash.com/photo-1524504388940-1d3f0ebdfa59?auto=format&fit=facearea&w=200&h=200&q=80",
          lastGift: "$500 (2023)",
          biography:
            "Longtime supporter from the primary. Interested in workforce development and clean energy incentives.",
          notes: "Prefers calls before noon Eastern.",
          tags: "High Priority",
          history: [
            { year: 2023, candidate: "Avery for Northdale", amount: 500 },
            { year: 2021, candidate: "Avery for Northdale", amount: 350 },
          ],
        },
        {
          id: "d2",
          firstName: "Jordan",
          lastName: "Smith",
          name: "Jordan Smith",
          phone: "(404) 555-2211",
          email: "jordan@smithco.com",
          ask: 1000,
          city: "Atlanta",
          employer: "SmithCo Logistics",
          company: "SmithCo Logistics",
          industry: "Logistics",
          pictureUrl: "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=facearea&w=200&h=200&q=80",
          lastGift: "$1,000 (2022)",
          biography:
            "Member of the regional chamber. Wants concrete infrastructure updates. Joined host committee in 2021.",
          notes: "Follow up with policy brief on port expansion.",
          tags: "High Priority",
          history: [
            { year: 2022, candidate: "Avery for Northdale", amount: 1000 },
            { year: 2020, candidate: "Northdale Forward PAC", amount: 750 },
          ],
        },
        {
          id: "d3",
          firstName: "Amelia",
          lastName: "Chen",
          name: "Amelia Chen",
          phone: "(470) 555-8844",
          email: "amelia.chen@gmail.com",
          ask: 500,
          city: "Roswell",
          employer: "Adobe",
          company: "Adobe",
          industry: "Technology",
          pictureUrl: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=facearea&w=200&h=200&q=80",
          lastGift: "New prospect",
          biography:
            "UX director and community volunteer. Board member at Northdale Literacy Fund.",
          notes: "Was introduced by campaign chair last week.",
          tags: "Warm",
          history: [
            { year: 2021, candidate: "Metro Literacy Fund", amount: 300 },
          ],
        },
      ],
    },
    {
      id: "client-riverbend",
      label: "Committee to Elect Lucas",
      candidate: "Lucas Martinez",
      office: "City Council District 3",
      timezone: "America/Chicago",
      sheetUrl: "",
      donors: [
        {
          id: "d4",
          firstName: "Taylor",
          lastName: "Nguyen",
          name: "Taylor Nguyen",
          phone: "(512) 555-0334",
          email: "taylor@nguyenco.org",
          ask: 350,
          city: "Riverbend",
          employer: "Nguyen Construction",
          company: "Nguyen Construction",
          industry: "Construction",
          pictureUrl: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=facearea&w=200&h=200&q=80",
          lastGift: "$250 (2021)",
          biography:
            "Supports walkable neighborhoods. Hosted Lucas in 2020 but sat out 2022 race.",
          notes: "Mention new zoning reform endorsement.",
          tags: "Reconnect",
          history: [
            { year: 2021, candidate: "Lucas Martinez for Council", amount: 250 },
            { year: 2019, candidate: "Riverbend Main Street PAC", amount: 200 },
          ],
        },
        {
          id: "d5",
          firstName: "Riley",
          lastName: "Carter",
          name: "Riley Carter",
          phone: "(210) 555-8832",
          email: "riley.carter@civicimpact.org",
          ask: 500,
          city: "Austin",
          employer: "Civic Impact Alliance",
          company: "Civic Impact Alliance",
          industry: "Non-profit",
          pictureUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=facearea&w=200&h=200&q=80",
          lastGift: "$500 (2023)",
          biography:
            "Non-profit director, enjoys policy deep dives. Values data and accountability.",
          notes: "Send deck outlining summer organizing push.",
          tags: "Renew",
          history: [
            { year: 2023, candidate: "Lucas Martinez for Council", amount: 500 },
            { year: 2022, candidate: "Central City Education Fund", amount: 300 },
          ],
        },
      ],
    },
  ],
};

const state = {
  clients: db.getClients(),
  interactions: loadInteractions(),
  activeClientId: null,
  donors: [],
  filteredDonors: [],
  activeDonorId: null,
  sessionActive: false,
};

const databaseState = {
  donors: [],
  filtered: [],
  activeDonorId: null,
  selectedClientId: null,
  clientAssignments: new Set(),
};

const elements = {
  clientList: document.getElementById("client-list"),
  emptyState: document.getElementById("empty-state"),
  emptyCreate: document.getElementById("empty-create"),
  emptyDemo: document.getElementById("empty-demo"),
  clientDashboard: document.getElementById("client-dashboard"),
  clientName: document.getElementById("client-name"),
  clientMeta: document.getElementById("client-meta"),
  donorItems: document.getElementById("donor-items"),
  donorDetail: document.getElementById("donor-detail"),
  donorSearch: document.getElementById("donor-search"),
  statusFilter: document.getElementById("status-filter"),
  refreshDonors: document.getElementById("refresh-donors"),
  startSession: document.getElementById("start-session"),
  manageClients: document.getElementById("manage-clients"),
  manageDonors: document.getElementById("manage-donors"),
  openDatabase: document.getElementById("open-database"),
  addClient: document.getElementById("add-client"),
  loadDemo: document.getElementById("load-demo"),
  workspace: document.getElementById("workspace"),
  clientDialog: document.getElementById("client-dialog"),
  clientForm: document.getElementById("client-form"),
  clientFormTitle: document.getElementById("client-form-title"),
  emptyCreateButton: document.getElementById("empty-create"),
  emptyDemoButton: document.getElementById("empty-demo"),
  template: document.getElementById("donor-item-template"),
  donorDatabase: document.getElementById("donor-database"),
  closeDonorDatabase: document.getElementById("close-donor-database"),
  exportDonorData: document.getElementById("export-donor-data"),
  addDonor: document.getElementById("add-donor"),
  donorDatabaseSearch: document.getElementById("donor-database-search"),
  donorDatabaseItems: document.getElementById("donor-database-items"),
  donorForm: document.getElementById("donor-form"),
  donorPlaceholder: document.getElementById("donor-placeholder"),
  historyYear: document.getElementById("history-year"),
  historyCandidate: document.getElementById("history-candidate"),
  historyAmount: document.getElementById("history-amount"),
  addHistoryEntry: document.getElementById("add-history-entry"),
  historyList: document.getElementById("history-list"),
  deleteDonor: document.getElementById("delete-donor"),
  donorUpdated: document.getElementById("donor-updated"),
  databaseClientMeta: document.getElementById("database-client-meta"),
  databaseClientSelector: document.getElementById("database-client-selector"),
  donorClientAssignments: document.getElementById("donor-client-assignments"),
};

let clientFormMode = { mode: "create", id: null };

init();

function init() {
  bindEvents();
  renderStatusFilterOptions();
  renderClients();
  syncEmptyState();
}

function bindEvents() {
  elements.addClient.addEventListener("click", () => openClientModal());
  elements.manageClients.addEventListener("click", () => {
    if (state.activeClientId) {
      openClientModal(state.clients.find((c) => c.id === state.activeClientId));
    } else {
      openClientModal();
    }
  });
  elements.loadDemo.addEventListener("click", loadDemoWorkspace);
  elements.emptyCreateButton.addEventListener("click", () => openClientModal());
  elements.emptyDemoButton.addEventListener("click", loadDemoWorkspace);
  elements.clientDialog.addEventListener("close", handleClientFormClose);
  elements.clientForm.addEventListener("submit", handleClientFormSubmit);
  elements.donorSearch.addEventListener("input", handleSearch);
  elements.statusFilter.addEventListener("change", applyFilters);
  elements.refreshDonors.addEventListener("click", () => refreshDonorData());
  elements.startSession.addEventListener("click", startCallSession);
  elements.manageDonors.addEventListener("click", openDonorDatabase);
  elements.openDatabase.addEventListener("click", openDonorDatabase);
  elements.closeDonorDatabase.addEventListener("click", closeDonorDatabase);
  elements.donorDatabase.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDonorDatabase();
  });
  elements.addDonor.addEventListener("click", handleCreateDonor);
  elements.databaseClientSelector?.addEventListener("change", handleDatabaseClientChange);
  elements.donorDatabaseSearch.addEventListener("input", handleDatabaseSearch);
  elements.donorForm.addEventListener("submit", handleDonorFormSubmit);
  elements.addHistoryEntry.addEventListener("click", handleAddHistoryEntry);
  elements.historyList.addEventListener("click", handleHistoryListClick);
  elements.deleteDonor.addEventListener("click", handleDeleteDonor);
  elements.exportDonorData.addEventListener("click", exportDonorData);
}

function loadDemoWorkspace() {
  DEMO_DATA.clients.forEach((demo) => {
    const { donors = [], ...client } = demo;
    db.upsertClient(client);
    const currentDonors = db.getDonors(client.id);
    if (!currentDonors.length && donors.length) {
      db.replaceDonors(client.id, donors);
    }
  });
  state.clients = db.getClients();
  renderClients();
  syncEmptyState();
  if (!state.activeClientId && state.clients.length) {
    selectClient(state.clients[0].id);
  }
}

function renderStatusFilterOptions() {
  STATUS_OPTIONS.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    elements.statusFilter.append(option);
  });
}

function renderClients() {
  elements.clientList.innerHTML = "";
  state.clients.forEach((client) => {
    const item = document.createElement("li");
    item.className = "client-item";
    item.dataset.id = client.id;
    if (client.id === state.activeClientId) {
      item.classList.add("client-item--active");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "client-item__button";
    const clientTitle = escapeHtml(client.label || "Untitled client");
    const clientMeta = escapeHtml(formatClientMeta(client));
    button.innerHTML = `
      <span class="client-item__title">${clientTitle}</span>
      <span class="client-item__meta">${clientMeta}</span>
    `;
    button.addEventListener("click", () => {
      if (state.activeClientId !== client.id) {
        selectClient(client.id);
      }
    });

    const actions = document.createElement("div");
    actions.className = "client-item__actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.innerHTML = "✎";
    editButton.title = "Edit client";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openClientModal(client);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.innerHTML = "✕";
    deleteButton.title = "Remove client";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteClient(client.id);
    });

    actions.append(editButton, deleteButton);
    item.append(button, actions);
    elements.clientList.append(item);
  });
}

function formatClientMeta(client) {
  const parts = [];
  if (client.candidate) parts.push(client.candidate);
  if (client.office) parts.push(client.office);
  return parts.join(" • ") || "Draft setup";
}

function selectClient(clientId) {
  state.activeClientId = clientId;
  state.activeDonorId = null;
  state.sessionActive = false;
  renderClients();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;
  elements.clientName.textContent = client.label || "Untitled client";
  const metaParts = [];
  if (client.candidate) metaParts.push(client.candidate);
  if (client.office) metaParts.push(client.office);
  metaParts.push(client.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  elements.clientMeta.textContent = metaParts.filter(Boolean).join(" • ");
  loadDonorData(client);
  syncEmptyState();
}

function syncEmptyState() {
  const hasClients = state.clients.length > 0;
  if (!hasClients) {
    elements.emptyState.classList.remove("hidden");
    elements.clientDashboard.classList.add("hidden");
  } else {
    elements.emptyState.classList.add("hidden");
    elements.clientDashboard.classList.toggle("hidden", !state.activeClientId);
  }
}

function openClientModal(client) {
  clientFormMode = client ? { mode: "edit", id: client.id } : { mode: "create", id: null };
  elements.clientForm.reset();
  if (client) {
    elements.clientFormTitle.textContent = "Edit client";
    elements.clientForm.elements.label.value = client.label || "";
    elements.clientForm.elements.candidate.value = client.candidate || "";
    elements.clientForm.elements.office.value = client.office || "";
    elements.clientForm.elements.sheet.value = client.sheetUrl || "";
    elements.clientForm.elements.timezone.value = client.timezone || "";
  } else {
    elements.clientFormTitle.textContent = "New client";
  }
  if (typeof elements.clientDialog.showModal === "function") {
    elements.clientDialog.showModal();
  } else {
    elements.clientDialog.setAttribute("open", "");
  }
}

function handleClientFormClose() {
  clientFormMode = { mode: "create", id: null };
}

function handleClientFormSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.clientForm);
  const payload = Object.fromEntries(formData.entries());
  const timezone = payload.timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clientRecord = {
    id: clientFormMode.mode === "edit" ? clientFormMode.id : createId(payload.label),
    label: payload.label?.trim(),
    candidate: payload.candidate?.trim(),
    office: payload.office?.trim(),
    sheetUrl: payload.sheet?.trim(),
    timezone,
  };
  db.upsertClient(clientRecord);
  state.clients = db.getClients();
  if (typeof elements.clientDialog.close === "function" && elements.clientDialog.open) {
    elements.clientDialog.close();
  } else {
    elements.clientDialog.removeAttribute("open");
  }
  renderClients();
  if (!state.activeClientId || clientFormMode.mode === "create") {
    selectClient(clientRecord.id);
  }
  syncEmptyState();
}

function deleteClient(clientId) {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;
  const confirmDelete = window.confirm(
    `Remove ${client.label || "this client"}? Local notes for this client will also be removed.`,
  );
  if (!confirmDelete) return;
  db.removeClient(clientId);
  state.clients = db.getClients();
  const interactions = loadInteractions();
  delete interactions[clientId];
  saveInteractions(interactions);
  if (state.activeClientId === clientId) {
    state.activeClientId = null;
    state.donors = [];
    state.filteredDonors = [];
    state.activeDonorId = null;
  }
  state.interactions = interactions;
  renderClients();
  syncEmptyState();
  if (state.clients.length) {
    selectClient(state.clients[0].id);
  }
}

async function loadDonorData(client) {
  renderLoadingState();
  try {
    const previousDonorId = state.activeDonorId;
    let donors = db.getDonors(client.id);
    if (!donors.length && client.donors?.length) {
      db.replaceDonors(client.id, client.donors);
      donors = db.getDonors(client.id);
    }
    if (client.sheetUrl) {
      const sheetDonors = await fetchDonorSheet(client.sheetUrl);
      db.replaceDonors(client.id, sheetDonors);
      donors = db.getDonors(client.id);
    }
    state.donors = donors.map((donor, index) => normalizeDonor(donor, index));
    applyFilters();
    if (previousDonorId && state.donors.some((donor) => donor.id === previousDonorId)) {
      renderDonorDetail(previousDonorId);
    } else if (state.donors.length) {
      renderDonorDetail(state.donors[0].id);
    } else {
      renderEmptyDetail("No donor records found. Refresh after publishing your sheet.");
    }
  } catch (error) {
    console.error(error);
    renderEmptyDetail("We couldn't load donors. Check the sheet link and try again.");
    elements.donorItems.innerHTML = `<li class="donor-item"><div class="donor-item__button">${escapeHtml(
      error.message || "Failed to load donors",
    )}</div></li>`;
  }
}

function refreshDonorData() {
  if (!state.activeClientId) return;
  const client = state.clients.find((c) => c.id === state.activeClientId);
  if (!client) return;
  loadDonorData(client);
}

function renderLoadingState() {
  elements.donorItems.innerHTML = "<li class=\"donor-item\"><div class=\"donor-item__button\">Loading donors…</div></li>";
  renderEmptyDetail("Loading donor details");
}

function handleSearch() {
  applyFilters();
}

function applyFilters() {
  const query = elements.donorSearch.value?.toLowerCase().trim() || "";
  const statusFilter = elements.statusFilter.value;
  const interactions = state.interactions[state.activeClientId] || {};

  state.filteredDonors = state.donors.filter((donor) => {
    const haystack = [
      donor.name,
      donor.firstName,
      donor.lastName,
      donor.city,
      donor.company,
      donor.industry,
      donor.employer,
      donor.tags,
      donor.notes,
      donor.email,
      donor.phone,
      donor.biography,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const donorStatus = interactions[donor.id]?.status || "Not Contacted";
    const matchesStatus =
      statusFilter === "all" || statusFilter.toLowerCase() === donorStatus.toLowerCase();
    return matchesQuery && matchesStatus;
  });

  renderDonorList();
}

function renderDonorList() {
  elements.donorItems.innerHTML = "";
  if (!state.filteredDonors.length) {
    elements.donorItems.innerHTML =
      '<li class="donor-item"><div class="donor-item__button">No donors match your filters yet.</div></li>';
    return;
  }

  const clientInteractions = state.interactions[state.activeClientId] || {};

  state.filteredDonors.forEach((donor) => {
    const clone = elements.template.content.firstElementChild.cloneNode(true);
    const button = clone.querySelector(".donor-item__button");
    button.addEventListener("click", () => renderDonorDetail(donor.id));
    const status = clientInteractions[donor.id]?.status || "Not Contacted";
    const variant = STATUS_VARIANT[status] || "open";
    const statusLabel = `<span class="status-pill" data-variant="${variant}">${escapeHtml(status)}</span>`;
    const metaParts = [];
    if (donor.city) metaParts.push(escapeHtml(donor.city));
    if (donor.company) metaParts.push(escapeHtml(donor.company));
    else if (donor.employer) metaParts.push(escapeHtml(donor.employer));
    if (donor.industry) metaParts.push(escapeHtml(donor.industry));
    if (donor.ask) metaParts.push(escapeHtml(`Ask $${formatCurrency(donor.ask)}`));
    button.innerHTML = `
      <div class="donor-item__title">
        <span class="donor-item__name">${escapeHtml(donor.name)}</span>
        ${statusLabel}
      </div>
      <div class="donor-item__meta">${metaParts.join(" • ")}</div>
    `;
    if (state.activeDonorId === donor.id) {
      clone.classList.add("donor-item--active");
    }
    elements.donorItems.append(clone);
  });
}

function renderDonorDetail(donorId) {
  const donor = state.donors.find((item) => item.id === donorId);
  if (!donor) {
    renderEmptyDetail("Select a donor to begin");
    return;
  }
  state.activeDonorId = donorId;
  renderDonorList();
  const interaction = (state.interactions[state.activeClientId] || {})[donorId] || {
    status: "Not Contacted",
  };
  const today = new Date().toISOString().slice(0, 10);
  const identity = [donor.city, donor.company || donor.employer, donor.industry]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" • ");
  const quickActions = STATUS_OPTIONS.map(
    (status) => `
      <button class="quick-action" type="button" data-status="${escapeAttribute(status)}">
        ${escapeHtml(status)}
      </button>
    `,
  ).join("");
  const options = STATUS_OPTIONS.map(
    (status) => `<option value="${escapeAttribute(status)}" ${
      status === interaction.status ? "selected" : ""
    }>${escapeHtml(status)}</option>`,
  ).join("");
  const biographySection = donor.biography
    ? `<section class="donor-bio">${formatMultiline(donor.biography)}</section>`
    : "";
  const tagsSection = donor.tags
    ? `<div class="donor-tags">${donor.tags
        .split(/[,;]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => `<span class="donor-tag">${escapeHtml(tag)}</span>`)
        .join("")}</div>`
    : "";
  const historySection = renderDonorHistorySection(donor.history || []);
  const photo = donor.pictureUrl
    ? `<figure class="donor-photo"><img src="${escapeAttribute(
        donor.pictureUrl,
      )}" alt="${escapeAttribute(donor.name)}" loading="lazy" /></figure>`
    : "";
  const updatedText = interaction.updatedAt
    ? `Updated ${escapeHtml(formatRelativeTime(interaction.updatedAt))}`
    : "No call logged yet";

  elements.donorDetail.innerHTML = `
    <article class="donor-profile" data-donor="${escapeAttribute(donor.id)}">
      <header class="donor-detail__header">
        <div class="donor-detail__headline">
          <h2>${escapeHtml(donor.name)}</h2>
          <div class="donor-detail__identity">${identity || ""}</div>
          ${tagsSection}
        </div>
        ${photo}
        <div class="donor-nav">
          <button class="btn btn--ghost" data-nav="prev">Prev</button>
          <button class="btn btn--ghost" data-nav="next">Next</button>
        </div>
      </header>

      <section class="donor-contact">
        ${renderContactCard("Mobile", donor.phone, donor.phone ? `tel:${donor.phone}` : "")}
        ${renderContactCard("Email", donor.email, donor.email ? `mailto:${donor.email}` : "")}
        ${renderContactCard("Ask", donor.ask ? `$${formatCurrency(donor.ask)}` : "—")}
        ${renderContactCard("Last gift", donor.lastGift || "—")}
        ${renderContactCard("Company", donor.company || donor.employer || "—")}
        ${renderContactCard("Industry", donor.industry || "—")}
      </section>

      ${biographySection}
      ${historySection}

      <section class="donor-actions">
        <div>
          <h3>Quick outcomes</h3>
          <div class="quick-actions">${quickActions}</div>
        </div>
        <form class="interaction-form" id="interaction-form">
          <div class="form-row">
            <label class="form-label" for="outcome-select">Outcome</label>
            <select class="input select" id="outcome-select" name="status">
              ${options}
            </select>
          </div>
          <div class="dynamic-fields" id="dynamic-fields">
            ${renderDynamicFields(interaction.status, interaction, today)}
          </div>
          <div class="form-row">
            <label class="form-label" for="interaction-notes">Notes</label>
            <textarea class="input textarea" id="interaction-notes" name="notes" placeholder="Conversation highlights, commitments, follow-ups">${escapeHtml(
              interaction.notes || "",
            )}</textarea>
          </div>
          <div class="interaction-save">
            <div class="timestamp">${updatedText}</div>
            <button class="btn btn--primary" type="submit">Save outcome</button>
          </div>
        </form>
      </section>
    </article>
  `;

  const interactionForm = document.getElementById("interaction-form");
  const outcomeSelect = document.getElementById("outcome-select");
  const dynamicFields = document.getElementById("dynamic-fields");

  outcomeSelect.addEventListener("change", () => {
    dynamicFields.innerHTML = renderDynamicFields(outcomeSelect.value, interaction, today);
  });
  elements.donorDetail
    .querySelectorAll(".quick-action")
    .forEach((button) =>
      button.addEventListener("click", () => {
        outcomeSelect.value = button.dataset.status;
        dynamicFields.innerHTML = renderDynamicFields(outcomeSelect.value, interaction, today);
      }),
    );
  interactionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveInteraction(donor.id, new FormData(interactionForm));
  });
  elements.donorDetail
    .querySelectorAll("[data-nav]")
    .forEach((button) => button.addEventListener("click", handleDonorNavigation));
}

function renderDynamicFields(status, interaction, today) {
  const fields = STATUS_DEFAULT_FIELDS[status];
  if (!fields || !fields.length) {
    return "";
  }
  const data = interaction || {};
  return fields
    .map((field) => {
      const value = data[field.name] || (field.type === "date" ? today : "");
      const attributes = [
        'class="input"',
        `type="${field.type}"`,
        `name="${field.name}"`,
        `id="${field.name}"`,
        field.placeholder ? `placeholder="${escapeAttribute(field.placeholder)}"` : "",
        field.min !== undefined ? `min="${escapeAttribute(field.min)}"` : "",
        field.step ? `step="${escapeAttribute(field.step)}"` : "",
        field.required ? "required" : "",
        `value="${escapeAttribute(value ?? "")}"`,
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <div class="form-field">
          <label class="form-label" for="${field.name}">${escapeHtml(field.label)}</label>
          <input ${attributes} />
        </div>
      `;
    })
    .join("");
}

function renderContactCard(label, value, href) {
  const safeLabel = escapeHtml(label);
  if (!value || value === "—") {
    return `
      <div class="contact-card">
        <span class="contact-card__label">${safeLabel}</span>
        <span class="contact-card__value">—</span>
      </div>
    `;
  }
  const safeValue = escapeHtml(value);
  const content = href
    ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener">${safeValue}</a>`
    : safeValue;
  return `
    <div class="contact-card">
      <span class="contact-card__label">${safeLabel}</span>
      <span class="contact-card__value">${content}</span>
    </div>
  `;
}

function renderDonorHistorySection(history) {
  if (!history.length) {
    return `
      <section class="donor-history" aria-labelledby="donor-history-title">
        <div class="donor-history__title">
          <h3 id="donor-history-title">Donor history</h3>
          <p class="muted">Election-year contributions logged for this donor.</p>
        </div>
        <div class="history-empty">No contributions recorded yet.</div>
      </section>
    `;
  }
  const grouped = history.reduce((acc, entry) => {
    const key = entry.year || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});
  const years = Object.keys(grouped)
    .map((value) => Number(value))
    .sort((a, b) => b - a);
  const sections = years
    .map((year) => {
      const entries = grouped[year];
      const rows = entries
        .map((entry) => {
          const amountLabel =
            entry.amount !== null && entry.amount !== undefined
              ? `$${formatCurrency(entry.amount)}`
              : "—";
          return `
            <li>
              <span class="donor-history__candidate">${escapeHtml(entry.candidate || "")}</span>
              <span class="donor-history__amount">${escapeHtml(amountLabel)}</span>
            </li>
          `;
        })
        .join("");
      return `
        <article class="donor-history__group">
          <header>
            <h4>${escapeHtml(String(year))}</h4>
            <span class="donor-history__count">${entries.length} entr${entries.length === 1 ? "y" : "ies"}</span>
          </header>
          <ul>${rows}</ul>
        </article>
      `;
    })
    .join("");
  return `
    <section class="donor-history" aria-labelledby="donor-history-title">
      <div class="donor-history__title">
        <h3 id="donor-history-title">Donor history</h3>
        <p class="muted">Election-year contributions logged for this donor.</p>
      </div>
      ${sections}
    </section>
  `;
}

function renderEmptyDetail(message) {
  elements.donorDetail.innerHTML = `<div class="donor-detail__placeholder">${escapeHtml(message)}</div>`;
}

function handleDonorNavigation(event) {
  const direction = event.currentTarget.dataset.nav;
  if (!direction) return;
  const currentIndex = state.filteredDonors.findIndex((donor) => donor.id === state.activeDonorId);
  if (currentIndex === -1) return;
  const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
  const nextDonor = state.filteredDonors[nextIndex];
  if (nextDonor) {
    renderDonorDetail(nextDonor.id);
  }
}

function saveInteraction(donorId, formData) {
  const data = Object.fromEntries(formData.entries());
  const status = data.status || "Not Contacted";
  const record = {
    status,
    notes: data.notes?.trim() || "",
    updatedAt: new Date().toISOString(),
  };
  if (STATUS_DEFAULT_FIELDS[status]) {
    STATUS_DEFAULT_FIELDS[status].forEach((field) => {
      if (data[field.name]) {
        record[field.name] = data[field.name];
      }
    });
  }
  if (!state.interactions[state.activeClientId]) {
    state.interactions[state.activeClientId] = {};
  }
  state.interactions[state.activeClientId][donorId] = record;
  saveInteractions(state.interactions);
  renderDonorList();
  renderDonorDetail(donorId);
}

function startCallSession() {
  state.sessionActive = true;
  const interactions = state.interactions[state.activeClientId] || {};
  const nextDonor = state.filteredDonors.find((donor) => {
    const status = interactions[donor.id]?.status || "Not Contacted";
    return status === "Not Contacted" || status === "No Answer" || status === "Left Voicemail";
  });
  if (nextDonor) {
    renderDonorDetail(nextDonor.id);
  }
  elements.workspace.focus();
}


function openDonorDatabase() {
  if (!state.clients.length) {
    databaseState.selectedClientId = null;
  } else if (
    !databaseState.selectedClientId ||
    !state.clients.some((client) => client.id === databaseState.selectedClientId)
  ) {
    databaseState.selectedClientId = state.activeClientId || state.clients[0].id;
  }
  elements.donorDatabaseSearch.value = "";
  databaseState.activeDonorId = null;
  syncDatabaseState({ preserveActive: false });
  populateDatabaseClientSelector();
  updateDatabaseMeta();
  renderDatabaseList();
  renderDatabaseEditor();
  if (typeof elements.donorDatabase.showModal === "function") {
    elements.donorDatabase.showModal();
  } else {
    elements.donorDatabase.setAttribute("open", "");
  }
}

function closeDonorDatabase() {
  if (typeof elements.donorDatabase.close === "function" && elements.donorDatabase.open) {
    elements.donorDatabase.close();
  } else {
    elements.donorDatabase.removeAttribute("open");
  }
}

function handleCreateDonor() {
  const assignedClients = [];
  if (databaseState.selectedClientId) {
    assignedClients.push(databaseState.selectedClientId);
  } else if (state.activeClientId) {
    assignedClients.push(state.activeClientId);
  }
  const donor = db.createDonor({ firstName: "New", lastName: "Donor" }, assignedClients);
  databaseState.activeDonorId = donor.id;
  syncDatabaseState({ preserveActive: true });
  populateDatabaseClientSelector();
  updateDatabaseMeta();
  renderDatabaseList();
  renderDatabaseEditor();
  if (assignedClients.includes(state.activeClientId)) {
    refreshActiveClientQueue(true);
  }
}

function handleDatabaseSearch() {
  syncDatabaseState({ preserveActive: true });
  renderDatabaseList();
  renderDatabaseEditor();
}

function handleDonorSelection(donorId) {
  databaseState.activeDonorId = donorId;
  renderDatabaseList();
  renderDatabaseEditor();
}

function handleDonorFormSubmit(event) {
  event.preventDefault();
  if (!databaseState.activeDonorId) return;
  const formData = new FormData(elements.donorForm);
  const payload = Object.fromEntries(formData.entries());
  const donorId = databaseState.activeDonorId;
  const previousClients = new Set(db.getClientsForDonor(donorId));
  db.updateDonor(donorId, {
    firstName: payload.firstName?.trim(),
    lastName: payload.lastName?.trim(),
    email: payload.email?.trim(),
    phone: payload.phone?.trim(),
    company: payload.company?.trim(),
    industry: payload.industry?.trim(),
    city: payload.city?.trim(),
    tags: payload.tags?.trim(),
    pictureUrl: payload.pictureUrl?.trim(),
    ask: payload.ask === "" ? null : Number(payload.ask),
    lastGift: payload.lastGift?.trim(),
    donorNotes: payload.notes?.trim(),
    biography: payload.biography?.trim(),
  });
  const assignments = Array.from(
    elements.donorClientAssignments?.querySelectorAll('input[name="donorClients"]:checked') || [],
  ).map((input) => input.value);
  db.setDonorClients(donorId, assignments);
  const updatedClients = new Set(db.getClientsForDonor(donorId));
  syncDatabaseState({ preserveActive: true });
  updateDatabaseMeta();
  renderDatabaseList();
  renderDatabaseEditor();
  const activeClient = state.activeClientId;
  if (activeClient && (previousClients.has(activeClient) || updatedClients.has(activeClient))) {
    refreshActiveClientQueue(true);
  }
  elements.donorUpdated.textContent = `Saved ${new Date().toLocaleString()}`;
}

function handleAddHistoryEntry() {
  if (!databaseState.activeDonorId) return;
  const yearValue = Number(elements.historyYear.value);
  const candidate = elements.historyCandidate.value.trim();
  const amountValue = elements.historyAmount.value;
  const amount = amountValue === "" ? null : Number(amountValue);
  if (!candidate) {
    window.alert("Add a candidate name before saving the contribution.");
    return;
  }
  const donorId = databaseState.activeDonorId;
  const previousClients = new Set(db.getClientsForDonor(donorId));
  db.addContribution(donorId, {
    year: Number.isNaN(yearValue) ? undefined : yearValue,
    candidate,
    amount,
  });
  elements.historyYear.value = "";
  elements.historyCandidate.value = "";
  elements.historyAmount.value = "";
  syncDatabaseState({ preserveActive: true });
  renderDatabaseEditor();
  const activeClient = state.activeClientId;
  if (activeClient && previousClients.has(activeClient)) {
    refreshActiveClientQueue(true);
  }
  elements.donorUpdated.textContent = `Logged contribution ${new Date().toLocaleTimeString()}`;
}

function handleHistoryListClick(event) {
  const button = event.target.closest("button[data-history]");
  if (!button || !databaseState.activeDonorId) return;
  const donorId = databaseState.activeDonorId;
  const previousClients = new Set(db.getClientsForDonor(donorId));
  db.removeContribution(donorId, button.dataset.history);
  syncDatabaseState({ preserveActive: true });
  renderDatabaseEditor();
  const activeClient = state.activeClientId;
  if (activeClient && previousClients.has(activeClient)) {
    refreshActiveClientQueue(true);
  }
  elements.donorUpdated.textContent = `Removed contribution ${new Date().toLocaleTimeString()}`;
}

function handleDeleteDonor() {
  if (!databaseState.activeDonorId) return;
  const donor = databaseState.donors.find((item) => item.id === databaseState.activeDonorId);
  const confirmDelete = window.confirm(
    `Remove ${donor?.name || "this donor"} from the database? This can't be undone.`,
  );
  if (!confirmDelete) return;
  const donorId = databaseState.activeDonorId;
  const previousClients = db.getClientsForDonor(donorId);
  db.deleteDonor(donorId);
  databaseState.activeDonorId = null;
  syncDatabaseState({ preserveActive: false });
  populateDatabaseClientSelector();
  updateDatabaseMeta();
  renderDatabaseList();
  renderDatabaseEditor();
  if (state.activeClientId && previousClients.includes(state.activeClientId)) {
    refreshActiveClientQueue(false);
  }
  elements.donorUpdated.textContent = `Deleted donor ${new Date().toLocaleTimeString()}`;
}

function exportDonorData() {
  const payload = {
    generatedAt: new Date().toISOString(),
    donors: db.getAllDonors(),
    assignments: db.getAssignments(),
    clients: db.getClients(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `calltime-complete-donor-database.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function syncDatabaseState({ preserveActive = false } = {}) {
  databaseState.donors = db.getAllDonors().sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  if (
    databaseState.selectedClientId &&
    !state.clients.some((client) => client.id === databaseState.selectedClientId)
  ) {
    databaseState.selectedClientId = state.clients[0]?.id || null;
  }
  refreshClientAssignments();
  const query = elements.donorDatabaseSearch.value?.toLowerCase().trim() || "";
  databaseState.filtered = databaseState.donors.filter((donor) => {
    if (!query) return true;
    const haystack = [
      donor.name,
      donor.firstName,
      donor.lastName,
      donor.company,
      donor.industry,
      donor.email,
      donor.city,
      donor.tags,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
  if (
    !preserveActive ||
    !databaseState.activeDonorId ||
    !databaseState.filtered.some((donor) => donor.id === databaseState.activeDonorId)
  ) {
    databaseState.activeDonorId = databaseState.filtered[0]?.id || null;
  }
}

function renderDatabaseList() {
  elements.donorDatabaseItems.innerHTML = "";
  if (!databaseState.filtered.length) {
    const item = document.createElement("li");
    item.className = "database-panel__item";
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.classList.add("database-panel__select");
    button.innerHTML = `
      <span class="database-panel__item-title">No donors saved yet</span>
      <span class="database-panel__item-meta">Add a donor to begin tracking calls.</span>
    `;
    item.append(button);
    elements.donorDatabaseItems.append(item);
    return;
  }
  const selectedClient = state.clients.find((client) => client.id === databaseState.selectedClientId);
  databaseState.filtered.forEach((donor) => {
    const item = document.createElement("li");
    item.className = "database-panel__item";
    if (databaseState.activeDonorId === donor.id) {
      item.classList.add("database-panel__item--active");
    }
    const button = document.createElement("button");
    button.type = "button";
    const meta = [donor.company, donor.industry, donor.city].filter(Boolean).join(" • ") || donor.email || "";
    button.innerHTML = `
      <span class="database-panel__item-title">${escapeHtml(donor.name)}</span>
      <span class="database-panel__item-meta">${escapeHtml(meta)}</span>
    `;
    button.addEventListener("click", () => handleDonorSelection(donor.id));
    button.classList.add("database-panel__select");

    const toggleWrapper = document.createElement("div");
    toggleWrapper.className = "database-panel__item-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `focus-${donor.id}`;
    checkbox.className = "database-panel__focus";
    checkbox.checked =
      !!databaseState.selectedClientId && databaseState.clientAssignments.has(donor.id);
    checkbox.disabled = !databaseState.selectedClientId;
    checkbox.setAttribute(
      "aria-label",
      selectedClient
        ? `Toggle ${selectedClient.label || "this client"} focus for ${donor.name}`
        : "Select a client to manage focus assignments",
    );
    checkbox.addEventListener("change", (event) => handleFocusToggle(donor.id, event.currentTarget.checked));
    const label = document.createElement("label");
    label.setAttribute("for", checkbox.id);
    label.textContent = "Focus";
    toggleWrapper.append(checkbox, label);

    item.append(button, toggleWrapper);
    elements.donorDatabaseItems.append(item);
  });
}

function renderDatabaseEditor() {
  const donor = databaseState.donors.find((item) => item.id === databaseState.activeDonorId);
  const hasDonor = Boolean(donor);
  elements.donorForm.classList.toggle("hidden", !hasDonor);
  elements.donorPlaceholder?.classList.toggle("hidden", hasDonor);
  if (!hasDonor) {
    elements.donorForm.reset();
    elements.donorUpdated.textContent = "";
    elements.historyList.innerHTML = "";
    if (elements.donorClientAssignments) {
      elements.donorClientAssignments.innerHTML = "";
    }
    return;
  }
  elements.donorForm.scrollTop = 0;
  elements.donorForm.elements.firstName.value = donor.firstName || "";
  elements.donorForm.elements.lastName.value = donor.lastName || "";
  elements.donorForm.elements.email.value = donor.email || "";
  elements.donorForm.elements.phone.value = donor.phone || "";
  elements.donorForm.elements.company.value = donor.company || "";
  elements.donorForm.elements.industry.value = donor.industry || "";
  elements.donorForm.elements.city.value = donor.city || "";
  elements.donorForm.elements.tags.value = donor.tags || "";
  elements.donorForm.elements.pictureUrl.value = donor.pictureUrl || "";
  elements.donorForm.elements.ask.value = donor.ask ?? "";
  elements.donorForm.elements.lastGift.value = donor.lastGift || "";
  elements.donorForm.elements.notes.value = donor.notes || "";
  elements.donorForm.elements.biography.value = donor.biography || "";
  elements.donorUpdated.textContent = "";
  renderDonorClientAssignments(donor);
  renderHistoryList(donor.history || []);
}

function populateDatabaseClientSelector() {
  const selector = elements.databaseClientSelector;
  if (!selector) return;
  selector.innerHTML = "";
  if (!state.clients.length) {
    selector.disabled = true;
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No clients available";
    selector.append(option);
    return;
  }
  selector.disabled = false;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "View all donors";
  selector.append(placeholder);
  state.clients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.label || "Untitled client";
    selector.append(option);
  });
  selector.value = databaseState.selectedClientId || "";
}

function updateDatabaseMeta() {
  const meta = elements.databaseClientMeta;
  if (!meta) return;
  if (!state.clients.length) {
    meta.textContent = "Add a client to assign donors to focus lists.";
    return;
  }
  if (!databaseState.selectedClientId) {
    meta.textContent = "Viewing the full donor database. Select a client to manage assignments.";
    return;
  }
  const client = state.clients.find((item) => item.id === databaseState.selectedClientId);
  if (!client) {
    meta.textContent = "Select a client to manage assignments.";
    return;
  }
  const count = databaseState.clientAssignments.size;
  meta.textContent = `${count} donor${count === 1 ? "" : "s"} assigned to ${client.label || "this client"}.`;
}

function refreshClientAssignments() {
  if (databaseState.selectedClientId) {
    databaseState.clientAssignments = new Set(
      db.getClientDonorIds(databaseState.selectedClientId),
    );
  } else {
    databaseState.clientAssignments = new Set();
  }
}

function handleDatabaseClientChange(event) {
  const value = event.target.value || "";
  databaseState.selectedClientId = value || null;
  syncDatabaseState({ preserveActive: true });
  populateDatabaseClientSelector();
  updateDatabaseMeta();
  renderDatabaseList();
}

function handleFocusToggle(donorId, isChecked) {
  if (!databaseState.selectedClientId) return;
  if (isChecked) {
    databaseState.clientAssignments.add(donorId);
  } else {
    databaseState.clientAssignments.delete(donorId);
  }
  db.setClientDonorIds(databaseState.selectedClientId, Array.from(databaseState.clientAssignments));
  syncDatabaseState({ preserveActive: true });
  updateDatabaseMeta();
  renderDatabaseList();
  if (state.activeClientId === databaseState.selectedClientId) {
    refreshActiveClientQueue(true);
  }
}

function renderDonorClientAssignments(donor) {
  const container = elements.donorClientAssignments;
  if (!container) return;
  container.innerHTML = "";
  if (!state.clients.length) {
    container.innerHTML = '<p class="muted">Add a client to assign this donor.</p>';
    return;
  }
  const assignedClients = new Set(db.getClientsForDonor(donor.id));
  state.clients.forEach((client) => {
    const label = document.createElement("label");
    label.className = "donor-access__item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "donorClients";
    input.value = client.id;
    input.checked = assignedClients.has(client.id);
    const span = document.createElement("span");
    span.textContent = client.label || "Untitled client";
    label.append(input, span);
    container.append(label);
  });
}

function refreshActiveClientQueue(preserveDonor = true) {
  if (!state.activeClientId) return;
  const donors = db.getDonors(state.activeClientId);
  const previousDonorId = preserveDonor ? state.activeDonorId : null;
  state.donors = donors.map((donor, index) => normalizeDonor(donor, index));
  applyFilters();
  if (preserveDonor && previousDonorId && state.donors.some((donor) => donor.id === previousDonorId)) {
    renderDonorDetail(previousDonorId);
  } else if (state.donors.length) {
    renderDonorDetail(state.donors[0].id);
  } else {
    renderEmptyDetail(
      "No donor records selected for this client yet. Use the donor database to assign supporters.",
    );
  }
}

function renderHistoryList(history) {
  if (!history.length) {
    elements.historyList.innerHTML = '<div class="history-empty">No contributions recorded yet.</div>';
    return;
  }
  const groups = history.reduce((acc, entry) => {
    const key = entry.year || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});
  const years = Object.keys(groups)
    .map((value) => Number(value))
    .sort((a, b) => b - a);
  elements.historyList.innerHTML = years
    .map((year) => {
      const entries = groups[year];
      const rows = entries
        .map(
          (entry) => `
            <tr>
              <td>${escapeHtml(entry.candidate || "")}</td>
              <td>${entry.amount !== null && entry.amount !== undefined ? `$${formatCurrency(entry.amount)}` : "—"}</td>
              <td class="history-table__actions"><button type="button" class="history-delete" data-history="${escapeAttribute(
                entry.id,
              )}">Remove</button></td>
            </tr>
          `,
        )
        .join("");
      return `
        <article class="history-group">
          <div class="history-group__title">
            <span>${escapeHtml(String(year))}</span>
            <span>${entries.length} entr${entries.length === 1 ? "y" : "ies"}</span>
          </div>
          <table class="history-table">
            <thead>
              <tr><th>Candidate</th><th>Amount</th><th></th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </article>
      `;
    })
    .join("");
}

function fetchDonorSheet(url) {
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Unable to fetch sheet. Make sure it is published and public.");
      }
      return response.text();
    })
    .then((text) => {
      if (text.trim().startsWith("google.visualization")) {
        return parseGviz(text);
      }
      if (text.includes(",")) {
        return parseCsv(text);
      }
      throw new Error("Unsupported sheet format. Use the gviz JSON or CSV publish link.");
    });
}

function parseGviz(text) {
  const json = JSON.parse(text.replace(/^.*?\(/, "").replace(/\);?$/, ""));
  const cols = json.table.cols.map((col) => col.label || col.id);
  return json.table.rows
    .map((row) => row.c)
    .map((cells) => {
      const entry = {};
      cells.forEach((cell, index) => {
        entry[cols[index]] = cell && cell.v !== null ? cell.v : "";
      });
      return entry;
    });
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      current.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (field || current.length) {
        current.push(field);
        rows.push(current);
        current = [];
        field = "";
      }
      if (char === "\r" && text[i + 1] === "\n") i += 1;
    } else {
      field += char;
    }
  }
  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] ? row[index].trim() : "";
      });
      return entry;
    });
}

function normalizeDonor(raw, index) {
  const safe = typeof raw === "object" ? { ...raw } : {};
  const id = safe.id || createId(`${safe.Name || safe.name || safe.Email || index}`);
  const askValue = parseNumber(safe.Ask || safe.ask || safe["Ask Amount"]);
  const firstName = safe.firstName || safe.FirstName || safe["First Name"] || "";
  const lastName = safe.lastName || safe.LastName || safe["Last Name"] || "";
  const company = safe.company || safe.Company || safe.employer || safe.Employer || "";
  const industry = safe.industry || safe.Industry || safe.Sector || "";
  const pictureUrl = safe.pictureUrl || safe.Picture || safe.photo || safe.Photo || "";
  const history = Array.isArray(safe.history)
    ? safe.history.map((item) => normalizeHistoryEntry(item)).filter(Boolean)
    : [];
  const derivedName = `${firstName} ${lastName}`.trim();
  return {
    id,
    name:
      safe.Name || safe.name || safe["Full Name"] || safe["Donor"] || derivedName || "Unknown Donor",
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: safe.Phone || safe.phone || safe["Phone Number"] || safe["Cell"] || "",
    email: safe.Email || safe.email || safe["Email Address"] || "",
    ask: askValue,
    city: safe.City || safe.city || safe["Mailing City"] || safe["City, State"] || "",
    employer:
      safe.Employer || safe.employer || safe["Occupation"] || safe["Company"] || safe["Employer/Occupation"] || company || "",
    company: company.trim(),
    industry: industry.trim(),
    lastGift: safe["Last Gift"] || safe["Last Donation"] || safe["Giving History"] || safe["History"] || "",
    biography: safe.Bio || safe.biography || safe["Profile"] || safe["Notes Bio"] || "",
    notes: safe.Notes || safe.notes || "",
    tags: safe.Priority || safe.priority || safe["Tag"] || "",
    pictureUrl: pictureUrl.trim(),
    history,
  };
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function normalizeHistoryEntry(entry) {
  if (!entry) return null;
  const source = typeof entry === "object" ? { ...entry } : {};
  const yearValue = Number(source.year ?? source.Year ?? source["Election Year"]);
  const candidate = (source.candidate || source.Candidate || "").trim();
  const amount = parseNumber(source.amount ?? source.Amount ?? source["Contribution"]);
  const id = source.id || createId(`${yearValue || ""}-${candidate || ""}-${amount ?? ""}`);
  const year = Number.isNaN(yearValue) ? new Date().getFullYear() : yearValue;
  return {
    id,
    year,
    candidate,
    amount,
  };
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

function escapeAttribute(value) {
  return escapeHtml(value);
}

function formatMultiline(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function formatRelativeTime(timestamp) {
  const updated = new Date(timestamp);
  const now = new Date();
  const diff = Math.round((now - updated) / (1000 * 60));
  if (diff < 1) return "Just now";
  if (diff < 60) return `${diff} min ago`;
  const hours = Math.round(diff / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function createId(value = "") {
  const cleaned = value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (cleaned) return cleaned;
  const fallback =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `id-${fallback}`;
}

function loadInteractions() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.interactions);
    if (!value) return {};
    return JSON.parse(value);
  } catch (error) {
    console.error("Failed to parse interactions", error);
    return {};
  }
}

function saveInteractions(interactions) {
  localStorage.setItem(STORAGE_KEYS.interactions, JSON.stringify(interactions));
}

function maybeMigrateLegacyClients() {
  try {
    const legacy = localStorage.getItem("calltime:clients:v2");
    if (!legacy) return;
    if (db.getClients().length) return;
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((client) => {
      if (!client || !client.id) return;
      const { donors = [], ...rest } = client;
      db.upsertClient(rest);
      if (donors.length) {
        db.replaceDonors(client.id, donors);
      }
    });
    localStorage.removeItem("calltime:clients:v2");
  } catch (error) {
    console.error("Failed to migrate legacy clients", error);
  }
}

window.addEventListener("storage", (event) => {
  if (event.key && ![DATABASE_KEY, STORAGE_KEYS.interactions].includes(event.key)) {
    return;
  }
  db.reload();
  state.clients = db.getClients();
  state.interactions = loadInteractions();
  renderClients();
  if (state.activeClientId) {
    selectClient(state.activeClientId);
  } else {
    syncEmptyState();
  }
});
