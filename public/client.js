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
  clientId: document.getElementById("client-login-id"),
  password: document.getElementById("client-login-password"),
  status: document.getElementById("client-login-status"),
};

bootstrap();

function bootstrap() {
  bindAuthEvents();
  bindEvents();
  populateStatusOptions();
  populateClientSelector();
  const session = getClientSession();
  const params = new URLSearchParams(window.location.search);
  const urlClientId = params.get("clientId");
  if (!session.clientId && urlClientId && authElements.clientId) {
    authElements.clientId.value = urlClientId;
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

function showLoginScreen(message = "") {
  if (authElements.status) {
    authElements.status.textContent = message;
  }
  authElements.screen?.classList.remove("hidden");
  if (elements.selector) {
    elements.selector.disabled = true;
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

async function handleClientLogin() {
  if (!authElements.clientId || !authElements.password) return;
  const clientIdValue = authElements.clientId.value.trim();
  const password = authElements.password.value.trim();

  if (!clientIdValue) {
    authElements.status && (authElements.status.textContent = "Enter your campaign ID.");
    authElements.clientId.focus();
    return;
  }

  const clientId = Number(clientIdValue);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    authElements.status && (authElements.status.textContent = "Campaign ID must be a positive number.");
    authElements.clientId.focus();
    return;
  }

  if (!password) {
    authElements.status && (authElements.status.textContent = "Enter your portal password.");
    authElements.password.focus();
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
      throw new Error("Invalid campaign ID or password.");
    }
    const payload = await response.json();
    const clientName = payload.client?.name || payload.client?.candidate || "";
    setClientSession({ token: payload.token, clientId: payload.client?.id, clientName });
    hideLoginScreen();
    initializeClientSession(payload.client?.id, clientName, payload.client?.candidate || "");
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
  if (authElements.clientId) {
    authElements.clientId.value = session.clientId ? String(session.clientId) : authElements.clientId.value || "";
  }
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
  populateClientSelector();
  if (elements.queue) {
    elements.queue.innerHTML = `<p class="muted">Sign in to access your call queue.</p>`;
  }
  hideDonorDetails();
  if (elements.stats) {
    elements.stats.textContent = "Sign in to access your call queue.";
  }
  if (elements.title) {
    elements.title.textContent = "Client call portal";
  }
  showLoginScreen(message);
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
  container.innerHTML = "";
  if (!state.filteredDonors.length) {
    container.innerHTML = `<p class="muted">No donors in this view. Adjust your filters or assignments.</p>`;
    return;
  }

  state.filteredDonors.forEach((donor) => {
    const card = document.createElement("div");
    const status = donor.last_call_status || "Not Contacted";
    const isCompleted = !["Not Contacted", "No Answer - Left Message", "No Answer - No Message"].includes(status);
    card.className = `queue-item ${isCompleted ? "completed" : ""}`;
    card.setAttribute("data-donor-id", donor.id);
    card.innerHTML = `
      <div class="queue-donor-info">
        <div class="queue-donor-name">${donor.name || `${donor.first_name || ""} ${donor.last_name || ""}`.trim() || "Unnamed donor"}</div>
        <div class="queue-donor-details">
          ${(donor.company || donor.employer || "Unknown employer")} • ${donor.phone || "No phone"} • Capacity: $${formatCurrency(
            donor.capacity || donor.suggested_ask || 0,
          )}
        </div>
      </div>
      <div class="queue-status">
        <span class="status ${getStatusClass(status)}">${status}</span>
      </div>
    `;
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
  elements.donorName.textContent = name;
  elements.donorInfo.innerHTML = `
    <div class="donor-info-grid">
      ${renderInfoItem("Phone", details.phone || "No phone on file")}
      ${renderInfoItem("Email", details.email || "No email on file")}
      ${renderInfoItem("Employer", details.company || details.employer || "Unknown")}
      ${renderInfoItem("City", details.city || "Unknown")}
      ${renderInfoItem("Industry", details.industry || details.occupation || "Unknown")}
      ${renderInfoItem("Giving capacity", `$${formatCurrency(details.capacity || details.suggested_ask || 0)}`)}
      ${renderInfoItem("Last gift", details.last_gift || details.last_gift_note || "N/A")}
    </div>
    <div class="donor-tags">${renderTags(details.tags)}</div>
    ${renderResearch(details.research)}
    ${renderNotes(details.notes)}
  `;

  const latestStatus = (details.callHistory && details.callHistory[0]?.status) || "Not Contacted";
  elements.callStatus.value = CALL_STATUSES.includes(latestStatus) ? latestStatus : "";
  elements.askAmount.value = "";
  elements.committedAmount.value = "";
  elements.callNotes.value = "";
  elements.followupDate.value = "";
  elements.outcomeStatus.textContent = "";
  renderCallHistory(details.callHistory || []);
}

function renderResearch(research = []) {
  if (!Array.isArray(research) || !research.length) return "";
  const items = research
    .map(
      (entry) => `
        <article class="info-block">
          <h4>${entry.research_category}</h4>
          <p>${entry.research_content || "No research notes"}</p>
          <p class="muted">Updated ${formatDate(entry.updated_at)}</p>
        </article>
      `,
    )
    .join("");
  return `<section class="info-group"><h3>Research</h3>${items}</section>`;
}

function renderNotes(notes = []) {
  if (!Array.isArray(notes) || !notes.length) return "";
  const items = notes
    .map(
      (entry) => `
        <article class="info-block">
          <h4>${entry.note_type || "Note"}</h4>
          <p>${entry.note_content}</p>
          <p class="muted">Saved ${formatDate(entry.created_at)}</p>
        </article>
      `,
    )
    .join("");
  return `<section class="info-group"><h3>Private notes</h3>${items}</section>`;
}

function renderCallHistory(history = []) {
  elements.callHistory.innerHTML = "";
  if (!history.length) {
    elements.callHistory.innerHTML = `<p class="muted">No call history recorded yet.</p>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "call-history__list";
  history.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "call-history__item";
    item.innerHTML = `
      <header>
        <span class="status ${getStatusClass(entry.status)}">${entry.status}</span>
        <span class="muted">${formatDate(entry.call_date)}</span>
      </header>
      <p>${entry.outcome_notes || "No notes recorded."}</p>
      <footer>
        ${entry.pledge_amount ? `<span>Pledged: $${formatCurrency(entry.pledge_amount)}</span>` : ""}
        ${entry.contribution_amount ? `<span>Raised: $${formatCurrency(entry.contribution_amount)}</span>` : ""}
        ${entry.follow_up_date ? `<span>Follow-up: ${formatDate(entry.follow_up_date)}</span>` : ""}
      </footer>
    `;
    list.append(item);
  });
  elements.callHistory.append(list);
}

function renderInfoItem(label, value) {
  return `
    <div class="info-item">
      <div class="info-label">${label}</div>
      <div class="info-value">${value}</div>
    </div>
  `;
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

function populateStatusOptions() {
  if (!elements.callStatus) return;
  elements.callStatus.innerHTML = `<option value="">Select outcome…</option>`;
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
