import {
  clientFetch,
  UnauthorizedError,
  getClientSession,
  setClientSession,
  clearClientSession,
} from "./auth.js";

const CALL_STATUSES = [
  "Not Contacted",
  "No Answer - Left Message",
  "No Answer - No Message",
  "Spoke - Interested",
  "Spoke - Needs Follow-up",
  "Spoke - Not Interested",
  "Committed - Amount TBD",
  "Committed - Specific Amount",
  "Contributed",
  "Do Not Call",
];

const state = {
  availableLoginClients: [],
  clients: [],
  selectedClientId: "",
  selectedClientName: "",
  donors: [],
  filteredDonors: [],
  selectedDonorId: "",
  selectedStatus: "",
  donorDetails: null,
  sessionId: null,
  sessionStart: null,
  sessionCallsAttempted: 0,
  sessionCallsCompleted: 0,
  sessionPledged: 0,
  hasBoundEvents: false,
  initialized: false,
  pendingPasswordReset: null,
  preselectedLoginClientId: null,
  loadingLoginClients: false,
};

const elements = {
  title: document.getElementById("client-title"),
  selector: document.getElementById("client-selector"),
  filter: document.getElementById("queue-filter"),
  startSession: document.getElementById("start-session"),
  queue: document.getElementById("call-queue"),
  stats: document.getElementById("client-stats"),
  donorCard: document.getElementById("donor-card"),
  donorName: document.getElementById("donor-name"),
  donorInfo: document.getElementById("donor-info"),
  callHistory: document.getElementById("call-history"),
  closeDonor: document.getElementById("close-donor"),
  callStatus: document.getElementById("call-status"),
  askAmount: document.getElementById("ask-amount"),
  committedAmount: document.getElementById("committed-amount"),
  callNotes: document.getElementById("call-notes"),
  followupDate: document.getElementById("followup-date"),
  saveOutcome: document.getElementById("save-outcome"),
  outcomeStatus: document.getElementById("outcome-status"),
  logout: document.getElementById("client-logout"),
};

const authElements = {
  screen: document.getElementById("client-login-screen"),
  form: document.getElementById("client-login-form"),
  clientSelect: document.getElementById("client-login-selector"),
  password: document.getElementById("client-login-password"),
  status: document.getElementById("client-login-status"),
};

const passwordResetElements = {
  screen: document.getElementById("client-password-reset-screen"),
  form: document.getElementById("client-password-reset-form"),
  newPassword: document.getElementById("client-new-password"),
  confirmPassword: document.getElementById("client-confirm-password"),
  status: document.getElementById("client-password-reset-status"),
  cancel: document.getElementById("client-password-reset-cancel"),
  description: document.getElementById("client-password-reset-description"),
};

if (typeof window === "undefined" || !window.__CALLTIME_TESTING__) {
  bootstrap();
}

function bootstrap() {
  bindAuthEvents();
  bindPasswordResetEvents();
  bindEvents();
  populateStatusOptions();
  populateClientSelector();
  loadLoginClientOptions();
  const session = getClientSession();
  const params = new URLSearchParams(window.location.search);
  const urlClientId = params.get("clientId");
  if (!session.clientId && urlClientId) {
    state.preselectedLoginClientId = String(urlClientId);
  }
  if (session.token && session.clientId) {
    hideLoginScreen();
    initializeClientSession(session.clientId, session.clientName);
  } else {
    showLoginScreen();
  }
}

function bindAuthEvents() {
  authElements.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleClientLogin();
  });
}

function bindPasswordResetEvents() {
  passwordResetElements.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handlePasswordReset();
  });
  passwordResetElements.cancel?.addEventListener("click", () => {
    cancelPasswordReset();
  });
}

function showLoginScreen(message = "") {
  if (authElements.status) {
    authElements.status.textContent = message;
  }
  authElements.screen?.classList.remove("hidden");
  if (elements.selector) {
    elements.selector.disabled = true;
  }
  populateLoginClientOptions();
  if (authElements.clientSelect) {
    const hasOptions = state.availableLoginClients.length > 0;
    authElements.clientSelect.disabled = !hasOptions && state.loadingLoginClients;
    if (state.preselectedLoginClientId && hasOptions) {
      const exists = state.availableLoginClients.some(
        (client) => String(client.id) === state.preselectedLoginClientId
      );
      authElements.clientSelect.value = exists ? state.preselectedLoginClientId : "";
      if (!exists) {
        state.preselectedLoginClientId = null;
      }
    } else {
      authElements.clientSelect.value = "";
    }
  }
  if (authElements.password) {
    authElements.password.value = "";
    authElements.password.focus();
  }
}

function showPasswordResetScreen(clientName = "") {
  hideLoginScreen();
  if (passwordResetElements.status) {
    passwordResetElements.status.textContent = "";
  }
  if (passwordResetElements.description) {
    passwordResetElements.description.textContent = clientName
      ? `${clientName} currently has a temporary password. Create a new password to continue.`
      : "Your temporary password must be replaced before you can access your call portal.";
  }
  passwordResetElements.screen?.classList.remove("hidden");
  if (passwordResetElements.newPassword) {
    passwordResetElements.newPassword.value = "";
    passwordResetElements.newPassword.focus();
  }
  if (passwordResetElements.confirmPassword) {
    passwordResetElements.confirmPassword.value = "";
  }
}

function hidePasswordResetScreen() {
  passwordResetElements.screen?.classList.add("hidden");
  if (passwordResetElements.status) {
    passwordResetElements.status.textContent = "";
  }
  if (passwordResetElements.newPassword) {
    passwordResetElements.newPassword.value = "";
  }
  if (passwordResetElements.confirmPassword) {
    passwordResetElements.confirmPassword.value = "";
  }
}

async function handlePasswordReset() {
  if (!state.pendingPasswordReset) {
    return;
  }
  const newPassword = passwordResetElements.newPassword?.value.trim() || "";
  const confirmPassword = passwordResetElements.confirmPassword?.value.trim() || "";

  if (!newPassword || newPassword.length < 6) {
    if (passwordResetElements.status) {
      passwordResetElements.status.textContent = "Choose a password with at least 6 characters.";
    }
    passwordResetElements.newPassword?.focus();
    return;
  }

  if (newPassword !== confirmPassword) {
    if (passwordResetElements.status) {
      passwordResetElements.status.textContent = "Passwords do not match.";
    }
    passwordResetElements.confirmPassword?.focus();
    return;
  }

  try {
    passwordResetElements.form?.classList.add("auth-form--busy");
    const { token, clientId, clientName, clientCandidate, currentPassword } =
      state.pendingPasswordReset;
    const response = await fetch(`/api/client/${clientId}/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newPassword, currentPassword }),
    });
    if (!response.ok) {
      throw new Error("Unable to update password. Try again.");
    }

    setClientSession({ token, clientId, clientName });
    state.pendingPasswordReset = null;
    hidePasswordResetScreen();
    initializeClientSession(clientId, clientName, clientCandidate);
  } catch (error) {
    if (passwordResetElements.status) {
      passwordResetElements.status.textContent = error.message || "Unable to update password.";
    }
    passwordResetElements.newPassword?.focus();
  } finally {
    passwordResetElements.form?.classList.remove("auth-form--busy");
  }
}

function cancelPasswordReset() {
  const pending = state.pendingPasswordReset;
  state.pendingPasswordReset = null;
  hidePasswordResetScreen();
  if (pending?.token) {
    fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${pending.token}` },
    }).catch((error) => console.warn("Failed to cancel pending session", error));
  }
  state.preselectedLoginClientId = pending?.clientId
    ? String(pending.clientId)
    : state.preselectedLoginClientId;
  clearClientSession();
  showLoginScreen();
  loadLoginClientOptions();
}

function hideLoginScreen() {
  authElements.screen?.classList.add("hidden");
  if (authElements.status) {
    authElements.status.textContent = "";
  }
  if (authElements.password) {
    authElements.password.value = "";
  }
  if (authElements.clientSelect) {
    authElements.clientSelect.disabled = false;
  }
  if (elements.selector) {
    elements.selector.disabled = false;
  }
}

async function loadLoginClientOptions() {
  if (!authElements.clientSelect) {
    return;
  }
  state.loadingLoginClients = true;
  authElements.clientSelect.disabled = true;
  try {
    const response = await fetch("/api/auth/clients");
    if (!response.ok) {
      throw new Error("Unable to load campaigns.");
    }
    const clients = await response.json();
    state.availableLoginClients = Array.isArray(clients) ? clients : [];
    populateLoginClientOptions();
  } catch (error) {
    console.error("Failed to load client list", error);
    if (authElements.status) {
      authElements.status.textContent =
        "Unable to load campaigns. Refresh the page or contact your manager.";
    }
  } finally {
    state.loadingLoginClients = false;
    if (authElements.clientSelect) {
      authElements.clientSelect.disabled = false;
    }
  }
}

function populateLoginClientOptions() {
  if (!authElements.clientSelect) {
    return;
  }
  const select = authElements.clientSelect;
  const previousValue = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select your campaign…";
  select.append(placeholder);

  state.availableLoginClients.forEach((client) => {
    const option = document.createElement("option");
    option.value = String(client.id);
    const primary = client.name || client.candidate || `Campaign ${client.id}`;
    const hasCandidate = Boolean(
      client.candidate && client.candidate !== primary
    );
    option.textContent = hasCandidate
      ? `${primary} – ${client.candidate}`
      : primary;
    select.append(option);
  });
}

async function handleClientLogin() {
  if (!authElements.clientSelect || !authElements.password) return;
  const clientIdValue = authElements.clientSelect.value.trim();
  const password = authElements.password.value.trim();

  if (!clientIdValue) {
    if (authElements.status) {
      authElements.status.textContent = "Select your campaign to sign in.";
    }
    authElements.clientSelect.focus();
    return;
  }

  if (!password) {
    if (authElements.status) {
      authElements.status.textContent = "Enter your portal password.";
    }
    authElements.password.focus();
    return;
  }

  const clientId = Number(clientIdValue);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    if (authElements.status) {
      authElements.status.textContent = "Campaign selection is invalid.";
    }
    authElements.clientSelect.focus();
    return;
  }

  try {
    authElements.form?.classList.add("auth-form--busy");
    const response = await fetch("/api/auth/client-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, password }),
    });
    if (!response.ok) {
      throw new Error("Invalid campaign or password. Try again.");
    }
    const payload = await response.json();
    const selectedClient = state.availableLoginClients.find(
      (client) => String(client.id) === String(clientId)
    );
    const clientRecord = payload.client || selectedClient || null;
    const clientName =
      clientRecord?.name || clientRecord?.candidate || selectedClient?.name || selectedClient?.candidate || "";
    const clientCandidate = clientRecord?.candidate || selectedClient?.candidate || "";

    if (payload.mustResetPassword) {
      state.pendingPasswordReset = {
        token: payload.token,
        clientId: payload.client?.id ?? clientId,
        clientName,
        clientCandidate,
        currentPassword: password,
      };
      showPasswordResetScreen(clientName);
      return;
    }

    setClientSession({ token: payload.token, clientId: payload.client?.id ?? clientId, clientName });
    hideLoginScreen();
    initializeClientSession(payload.client?.id ?? clientId, clientName, clientCandidate);
  } catch (error) {
    if (authElements.status) {
      authElements.status.textContent = error.message || "Unable to sign in.";
    }
    authElements.password?.focus();
  } finally {
    authElements.form?.classList.remove("auth-form--busy");
  }
}

function initializeClientSession(clientId, clientName = "", clientCandidate = "") {
  if (!clientId) return;
  state.clients = [
    {
      id: String(clientId),
      name: clientName,
      candidate: clientCandidate,
    },
  ];
  state.selectedClientId = String(clientId);
  state.selectedClientName = clientName || clientCandidate || `Campaign ${clientId}`;
  populateClientSelector();
  updateClientTitle();
  state.initialized = true;
  loadDonorQueue();
}

function updateClientTitle() {
  const title = state.selectedClientName || "Client call portal";
  if (elements.title) {
    elements.title.textContent = title;
  }
}

async function performLogout(message = "You have been signed out.") {
  const session = getClientSession();
  if (session.token) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch (error) {
      console.warn("Client logout request failed", error);
    }
  }
  state.preselectedLoginClientId = session.clientId ? String(session.clientId) : null;
  clearClientSession();
  state.clients = [];
  state.selectedClientId = "";
  state.selectedClientName = "";
  state.donors = [];
  state.filteredDonors = [];
  state.selectedDonorId = "";
  state.donorDetails = null;
  state.sessionId = null;
  state.sessionStart = null;
  state.sessionCallsAttempted = 0;
  state.sessionCallsCompleted = 0;
  state.sessionPledged = 0;
  state.pendingPasswordReset = null;
  hidePasswordResetScreen();
  populateClientSelector();
  if (elements.queue) {
    elements.queue.textContent = "";
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "Sign in to access your call queue.";
    elements.queue.append(message);
  }
  hideDonorDetails();
  if (elements.stats) {
    elements.stats.textContent = "Sign in to access your call queue.";
  }
  if (elements.title) {
    elements.title.textContent = "Client call portal";
  }
  showLoginScreen(message);
  loadLoginClientOptions();
}

function handleUnauthorized(message = "Session expired. Please sign in again.") {
  performLogout(message);
}
function bindEvents() {
  if (state.hasBoundEvents) return;
  state.hasBoundEvents = true;
  elements.filter?.addEventListener("change", () => {
    applyFilter();
    renderQueue();
  });

  elements.queue?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-donor-id]");
    if (!target) return;
    const donorId = target.getAttribute("data-donor-id");
    showDonorDetails(donorId);
  });

  elements.closeDonor?.addEventListener("click", () => {
    hideDonorDetails();
  });

  elements.saveOutcome?.addEventListener("click", () => {
    recordCallOutcome();
  });

  elements.startSession?.addEventListener("click", () => {
    if (!state.selectedClientId) {
      window.alert("Select your campaign before starting a session.");
      return;
    }
    if (state.sessionId) {
      endSession();
    } else {
      startSession();
    }
  });

  elements.logout?.addEventListener("click", () => {
    performLogout();
  });
}

function populateClientSelector() {
  const select = elements.selector;
  if (!select) return;
  select.innerHTML = "";
  if (!state.clients.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Sign in to access your campaign";
    select.append(placeholder);
    select.disabled = true;
    return;
  }

  const client = state.clients[0];
  const option = document.createElement("option");
  option.value = client.id;
  option.textContent = client.name || client.candidate || "Your campaign";
  select.append(option);
  select.value = client.id;
  select.disabled = true;
}

async function loadDonorQueue() {
  if (!state.selectedClientId) return;
  try {
    if (elements.stats) {
      elements.stats.textContent = "Loading call queue…";
    }
    const response = await clientFetch(`/api/client/${state.selectedClientId}/donors`);
    if (!response.ok) throw new Error("Unable to load donor queue");
    const donors = await response.json();
    state.donors = Array.isArray(donors) ? donors : [];
    applyFilter();
    renderQueue();
    updateClientStats();
  } catch (error) {
    reportError(error);
  }
}

function applyFilter() {
  const filter = elements.filter?.value || "all";
  state.filteredDonors = state.donors.filter((donor) => {
    const status = donor.last_call_status || "Not Contacted";
    switch (filter) {
      case "not-contacted":
        return status === "Not Contacted" || status === "No Answer - Left Message" || status === "No Answer - No Message";
      case "interested":
        return status === "Spoke - Interested" || status === "Committed - Specific Amount" || status === "Committed - Amount TBD";
      case "follow-up":
        return status === "Spoke - Needs Follow-up";
      default:
        return true;
    }
  });
}

function renderQueue() {
  const container = elements.queue;
  if (!container) return;
  container.textContent = "";
  if (!state.filteredDonors.length) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "No donors in this view. Adjust your filters or assignments.";
    container.append(message);
    return;
  }

  state.filteredDonors.forEach((donor) => {
    const card = document.createElement("div");
    card.className = "queue-item";
    const status = donor.last_call_status || "Not Contacted";
    if (!["Not Contacted", "No Answer - Left Message", "No Answer - No Message"].includes(status)) {
      card.classList.add("completed");
    }
    if (donor.id !== undefined && donor.id !== null) {
      card.setAttribute("data-donor-id", String(donor.id));
    }

    const employer = donor.company || donor.employer || "";
    const jobTitle = donor.job_title || donor.title || "";
    const location = formatDonorLocation(donor);
    let professional = "";
    if (jobTitle && employer) {
      professional = `${jobTitle} @ ${employer}`;
    } else if (jobTitle) {
      professional = jobTitle;
    } else if (employer) {
      professional = employer;
    } else {
      professional = "Unknown employer";
    }

    const info = document.createElement("div");
    info.className = "queue-donor-info";

    const nameEl = document.createElement("div");
    nameEl.className = "queue-donor-name";
    const fullName =
      donor.name || `${donor.first_name || ""} ${donor.last_name || ""}`.trim() || "Unnamed donor";
    nameEl.textContent = fullName;
    info.append(nameEl);

    const details = document.createElement("div");
    details.className = "queue-donor-details";
    const parts = [professional];
    if (location) {
      parts.push(location);
    }
    const primaryPhone = getPrimaryPhone(donor);
    const alternatePhone = getAlternatePhone(donor);
    if (primaryPhone || alternatePhone) {
      const phoneParts = [];
      if (primaryPhone) {
        phoneParts.push(primaryPhone);
      }
      if (alternatePhone) {
        phoneParts.push(`Alt: ${alternatePhone}`);
      }
      parts.push(phoneParts.join(" • "));
    } else {
      parts.push("No phone");
    }
    const capacityValue = donor.capacity || donor.suggested_ask || 0;
    parts.push(`Capacity: $${formatCurrency(capacityValue)}`);
    details.textContent = parts.filter(Boolean).join(" • ");
    info.append(details);

    const statusWrapper = document.createElement("div");
    statusWrapper.className = "queue-status";

    const statusEl = document.createElement("span");
    statusEl.className = `status ${getStatusClass(status)}`;
    statusEl.textContent = status;
    statusWrapper.append(statusEl);

    card.append(info, statusWrapper);
    container.append(card);
  });
}

function updateClientStats() {
  if (!elements.stats) return;
  const total = state.donors.length;
  if (!total) {
    elements.stats.textContent = "No donors assigned yet.";
    return;
  }
  const completed = state.donors.filter((donor) => {
    const status = donor.last_call_status || "Not Contacted";
    return !["Not Contacted", "No Answer - Left Message", "No Answer - No Message"].includes(status);
  }).length;
  elements.stats.textContent = `${completed} of ${total} calls completed`;
}

async function showDonorDetails(donorId) {
  if (!state.selectedClientId || !donorId) return;
  try {
    const response = await clientFetch(`/api/client/${state.selectedClientId}/donor/${donorId}`);
    if (!response.ok) throw new Error("Unable to load donor details");
    const details = await response.json();
    state.donorDetails = details;
    state.selectedDonorId = donorId;
    renderDonorDetails(details);
    elements.donorCard?.classList.remove("hidden");
    elements.donorCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    reportError(error);
  }
}

function hideDonorDetails() {
  state.selectedDonorId = "";
  state.donorDetails = null;
  elements.donorCard?.classList.add("hidden");
}

function renderDonorDetails(details) {
  if (!details) return;
  const name = details.name || `${details.first_name || ""} ${details.last_name || ""}`.trim() || "Unnamed donor";
  if (elements.donorName) {
    elements.donorName.textContent = name;
  }
  if (elements.donorInfo) {
    elements.donorInfo.textContent = "";

    const grid = document.createElement("div");
    grid.className = "donor-info-grid";
    const detailPrimaryPhone = getPrimaryPhone(details);
    const detailAlternatePhone = getAlternatePhone(details);
    const phoneLines = [];
    if (detailPrimaryPhone) {
      phoneLines.push(detailPrimaryPhone);
    }
    if (detailAlternatePhone) {
      phoneLines.push(`Alternate: ${detailAlternatePhone}`);
    }
    const streetLines = formatStreetAddress(details);
    grid.append(
      renderInfoItem("Phone", phoneLines.length ? phoneLines : "No phone on file"),
      renderInfoItem("Email", details.email || "No email on file"),
      renderInfoItem("Employer", details.company || details.employer || "Unknown"),
      renderInfoItem("Title", details.job_title || details.title || "Unknown"),
      renderInfoItem("Street address", streetLines.length ? streetLines : "Unknown"),
      renderInfoItem("City", normalizeText(details.city) || "Unknown"),
      renderInfoItem("State / Region", normalizeText(details.state) || "Unknown"),
      renderInfoItem(
        "Postal code",
        normalizeText(details.postal_code || details.postalCode) || "Unknown",
      ),
      renderInfoItem("Industry", details.industry || details.occupation || "Unknown"),
      renderInfoItem("Giving capacity", `$${formatCurrency(details.capacity || details.suggested_ask || 0)}`),
      renderInfoItem("Last gift", details.last_gift || details.last_gift_note || "N/A"),
    );
    elements.donorInfo.append(grid);

    const tagsContainer = document.createElement("div");
    tagsContainer.className = "donor-tags";
    const tags = renderTags(details.tags);
    if (tags) {
      tagsContainer.append(tags);
    }
    elements.donorInfo.append(tagsContainer);

    const researchSection = renderResearch(details.research);
    if (researchSection) {
      elements.donorInfo.append(researchSection);
    }

    const donorDatabaseNotesSection = renderDatabaseNotes(
      resolveDonorDatabaseNotes(details),
    );
    if (donorDatabaseNotesSection) {
      elements.donorInfo.append(donorDatabaseNotesSection);
    }

    const privateNotesSection = renderPrivateNotes(resolvePrivateNotes(details));
    if (privateNotesSection) {
      elements.donorInfo.append(privateNotesSection);
    }
  }

  const latestStatus = (details.callHistory && details.callHistory[0]?.status) || "Not Contacted";
  if (elements.callStatus) {
    elements.callStatus.value = CALL_STATUSES.includes(latestStatus) ? latestStatus : "";
  }
  if (elements.askAmount) {
    elements.askAmount.value = "";
  }
  if (elements.committedAmount) {
    elements.committedAmount.value = "";
  }
  if (elements.callNotes) {
    elements.callNotes.value = "";
  }
  if (elements.followupDate) {
    elements.followupDate.value = "";
  }
  if (elements.outcomeStatus) {
    elements.outcomeStatus.textContent = "";
  }
  renderCallHistory(details.callHistory || []);
}

function renderResearch(research = []) {
  if (!Array.isArray(research) || !research.length) return null;
  const section = document.createElement("section");
  section.className = "info-group";
  const heading = document.createElement("h3");
  heading.textContent = "Research";
  section.append(heading);

  research.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "info-block";

    const title = document.createElement("h4");
    title.textContent = entry.research_category || "Research";
    article.append(title);

    const content = document.createElement("p");
    content.textContent = entry.research_content || "No research notes";
    article.append(content);

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `Updated ${formatDate(entry.updated_at)}`;
    article.append(meta);

    section.append(article);
  });

  return section;
}

function renderDatabaseNotes(notes) {
  const text = typeof notes === "string" ? notes.trim() : "";
  if (!text) return null;

  const section = document.createElement("section");
  section.className = "info-group";
  const heading = document.createElement("h3");
  heading.textContent = "Donor database notes";
  section.append(heading);

  const article = document.createElement("article");
  article.className = "info-block";

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length) {
    lines.forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      article.append(paragraph);
    });
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    article.append(paragraph);
  }

  section.append(article);
  return section;
}

function renderPrivateNotes(notes = []) {
  if (!Array.isArray(notes) || !notes.length) return null;
  const section = document.createElement("section");
  section.className = "info-group";
  const heading = document.createElement("h3");
  heading.textContent = "Private notes";
  section.append(heading);

  notes.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "info-block";

    const title = document.createElement("h4");
    title.textContent = entry.note_type || "Note";
    article.append(title);

    const content = document.createElement("p");
    content.textContent = entry.note_content || "";
    article.append(content);

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `Saved ${formatDate(entry.created_at)}`;
    article.append(meta);

    section.append(article);
  });

  return section;
}

function resolveDonorDatabaseNotes(details) {
  if (!details) return "";
  if (typeof details.donorDatabaseNotes === "string") {
    return details.donorDatabaseNotes;
  }
  if (details.donorDatabaseNotes != null) {
    return String(details.donorDatabaseNotes);
  }
  if (typeof details.notes === "string") {
    return details.notes;
  }
  return "";
}

function resolvePrivateNotes(details) {
  if (!details) return [];
  if (Array.isArray(details.privateNotes)) {
    return details.privateNotes;
  }
  if (Array.isArray(details.notes)) {
    return details.notes;
  }
  return [];
}

function renderCallHistory(history = []) {
  if (!elements.callHistory) return;
  elements.callHistory.textContent = "";
  if (!history.length) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "No call history recorded yet.";
    elements.callHistory.append(message);
    return;
  }
  const list = document.createElement("div");
  list.className = "call-history__list";
  history.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "call-history__item";

    const header = document.createElement("header");
    const status = document.createElement("span");
    status.className = `status ${getStatusClass(entry.status)}`;
    status.textContent = entry.status || "Unknown";
    header.append(status);

    const date = document.createElement("span");
    date.className = "muted";
    date.textContent = formatDate(entry.call_date);
    header.append(date);

    const body = document.createElement("p");
    body.textContent = entry.outcome_notes || "No notes recorded.";

    const footer = document.createElement("footer");
    if (entry.pledge_amount) {
      const pledge = document.createElement("span");
      pledge.textContent = `Pledged: $${formatCurrency(entry.pledge_amount)}`;
      footer.append(pledge);
    }
    if (entry.contribution_amount) {
      const contribution = document.createElement("span");
      contribution.textContent = `Raised: $${formatCurrency(entry.contribution_amount)}`;
      footer.append(contribution);
    }
    if (entry.follow_up_date) {
      const followUp = document.createElement("span");
      followUp.textContent = `Follow-up: ${formatDate(entry.follow_up_date)}`;
      footer.append(followUp);
    }

    item.append(header, body, footer);
    list.append(item);
  });
  elements.callHistory.append(list);
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getPrimaryPhone(record) {
  if (!record) return "";
  return normalizeText(record.phone);
}

function getAlternatePhone(record) {
  if (!record) return "";
  return normalizeText(
    record.alternate_phone ??
      record.alternatePhone ??
      record.phone2 ??
      record.secondaryPhone ??
      record.secondary_phone ??
      "",
  );
}

function formatDonorLocation(donor) {
  if (!donor) return "";
  const city = normalizeText(donor.city);
  const state = normalizeText(donor.state);
  const postal = normalizeText(donor.postal_code || donor.postalCode);
  const locality = [city, state].filter(Boolean).join(", ");
  if (postal) {
    return locality ? `${locality} ${postal}` : postal;
  }
  return locality;
}

function formatStreetAddress(donor) {
  if (!donor) return [];
  const street = normalizeText(donor.street_address || donor.streetAddress);
  const line2 = normalizeText(donor.address_line2 || donor.addressLine2);
  return [street, line2].filter(Boolean);
}

function renderInfoItem(label, value) {
  const item = document.createElement("div");
  item.className = "info-item";

  const labelEl = document.createElement("div");
  labelEl.className = "info-label";
  labelEl.textContent = label;
  item.append(labelEl);

  const valueEl = document.createElement("div");
  valueEl.className = "info-value";
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (index > 0) {
        valueEl.append(document.createElement("br"));
      }
      valueEl.append(document.createTextNode(String(entry)));
    });
  } else if (value instanceof Node) {
    valueEl.append(value);
  } else {
    valueEl.textContent = value;
  }
  item.append(valueEl);
  return item;
}

function renderTags(raw) {
  if (!raw) return null;
  const tags = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  if (!tags.length) return null;
  const fragment = document.createDocumentFragment();
  tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    fragment.append(chip);
  });
  return fragment;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function populateStatusOptions() {
  if (!elements.callStatus) return;
  elements.callStatus.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select outcome…";
  elements.callStatus.append(placeholder);
  CALL_STATUSES.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    elements.callStatus.append(option);
  });
}

async function recordCallOutcome() {
  if (!state.selectedClientId || !state.selectedDonorId) {
    window.alert("Select a donor before saving an outcome.");
    return;
  }
  const status = elements.callStatus.value;
  if (!status) {
    window.alert("Choose a call outcome");
    return;
  }
  try {
    const payload = {
      donorId: state.selectedDonorId,
      status,
      outcomeNotes: elements.callNotes.value,
      followUpDate: elements.followupDate.value || null,
      pledgeAmount: parseFloat(elements.askAmount.value) || null,
      contributionAmount: parseFloat(elements.committedAmount.value) || null,
      nextAction: null,
      callDuration: null,
      callQuality: null,
    };
    const response = await clientFetch(`/api/client/${state.selectedClientId}/call-outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Unable to save call outcome");
    elements.outcomeStatus.textContent = "Outcome saved";
    setTimeout(() => {
      elements.outcomeStatus.textContent = "";
    }, 3000);
    state.sessionCallsAttempted += 1;
    state.sessionCallsCompleted += 1;
    if (payload.pledgeAmount) {
      state.sessionPledged += payload.pledgeAmount;
    }
    await loadDonorQueue();
    if (state.selectedDonorId) {
      showDonorDetails(state.selectedDonorId);
    }
  } catch (error) {
    reportError(error);
  }
}

async function startSession() {
  try {
    const response = await clientFetch(`/api/client/${state.selectedClientId}/start-session`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Unable to start session");
    const data = await response.json();
    state.sessionId = data.sessionId;
    state.sessionStart = new Date();
    state.sessionCallsAttempted = 0;
    state.sessionCallsCompleted = 0;
    state.sessionPledged = 0;
    elements.startSession.textContent = "End call session";
    elements.startSession.classList.add("btn--danger");
  } catch (error) {
    reportError(error);
  }
}

async function endSession() {
  if (!state.sessionId) return;
  try {
    const response = await clientFetch(`/api/client/${state.selectedClientId}/end-session/${state.sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callsAttempted: state.sessionCallsAttempted,
        callsCompleted: state.sessionCallsCompleted,
        totalPledged: state.sessionPledged,
        sessionNotes: null,
      }),
    });
    if (!response.ok) throw new Error("Unable to end session");
    window.alert("Call session saved.");
  } catch (error) {
    reportError(error);
  } finally {
    state.sessionId = null;
    state.sessionStart = null;
    state.sessionCallsAttempted = 0;
    state.sessionCallsCompleted = 0;
    state.sessionPledged = 0;
    elements.startSession.textContent = "Start call session";
    elements.startSession.classList.remove("btn--danger");
  }
}

function getStatusClass(status) {
  if (["Contributed", "Committed - Specific Amount"].includes(status)) return "status--success";
  if (["Spoke - Not Interested", "Do Not Call"].includes(status)) return "status--error";
  if (["Spoke - Needs Follow-up", "Committed - Amount TBD"].includes(status)) return "status--warning";
  return "status--info";
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString();
}

function formatDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function reportError(error) {
  if (error instanceof UnauthorizedError) {
    handleUnauthorized();
    return;
  }
  console.error(error);
  window.alert(error.message || "Something went wrong");
}

export const __TESTING__ = {
  state,
  elements,
  renderQueue,
  renderDonorDetails,
  renderResearch,
  renderDatabaseNotes,
  renderPrivateNotes,
  renderCallHistory,
  renderInfoItem,
  renderTags,
  formatDonorLocation,
  formatStreetAddress,
  escapeHtml,
  resolveDonorDatabaseNotes,
  resolvePrivateNotes,
};
