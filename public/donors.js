import {
  configureDonorEditor,
  refreshDonorEditorClients,
  resetDonorEditorForm,
} from "./donor-editor.js";
import { managerFetch, UnauthorizedError, getManagerToken, clearManagerSession } from "./auth.js";

const state = {
  donors: [],
  filtered: [],
  clients: [],
  assignments: new Map(),
  selectedDonorId: null,
  searchTerm: "",
  clientFilter: "",
  assignmentFilter: "all",
  contactFilter: "all",
  detailDraft: null,
  detailStatus: null,
  detailStatusTimeout: null,
  donorDetails: new Map(),
  loadingDetailFor: null,
};

const elements = {
  clientFilter: document.getElementById("database-client-filter"),
  assignmentFilter: document.getElementById("database-assignment-filter"),
  contactFilter: document.getElementById("database-contact-filter"),
  search: document.getElementById("database-search"),
  list: document.getElementById("database-list"),
  detail: document.getElementById("database-detail"),
  empty: document.getElementById("database-empty"),
  export: document.getElementById("export-donors"),
  newDonorButton: document.getElementById("open-donor-modal"),
};

const modal = {
  container: document.getElementById("donor-modal"),
  firstField: document.getElementById("editor-first-name"),
};

let isDonorModalOpen = false;
let donorModalTrigger = null;

configureDonorEditor({
  onSuccess: async (result) => {
    try {
      const donorId = result?.id ? String(result.id) : null;
      await refreshData({ donorId, preserveDraft: false, skipClients: false });
    } finally {
      closeDonorModal();
    }
  },
});

ensureManagerAccess();
init();

function ensureManagerAccess() {
  if (!getManagerToken()) {
    window.location.href = "manager.html";
  }
}

function handleUnauthorized() {
  clearManagerSession();
  window.location.href = "manager.html";
}

async function init() {
  bindEvents();
  await loadData();
  const params = new URLSearchParams(window.location.search);
  const initialDonor = params.get("donor");
  if (initialDonor) {
    await selectDonor(initialDonor);
  }
  const shouldOpenModal =
    params.get("create") === "1" || params.get("new") === "1" || params.get("modal") === "donor";
  if (shouldOpenModal) {
    await openDonorModal();
    params.delete("create");
    params.delete("new");
    params.delete("modal");
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", url);
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
  elements.assignmentFilter?.addEventListener("change", () => {
    state.assignmentFilter = elements.assignmentFilter.value;
    applyFilters();
    render();
  });
  elements.contactFilter?.addEventListener("change", () => {
    state.contactFilter = elements.contactFilter.value;
    applyFilters();
    render();
  });
  elements.list?.addEventListener("click", async (event) => {
    const createTrigger = event.target.closest("[data-open-donor-modal]");
    if (createTrigger) {
      event.preventDefault();
      await openDonorModal(createTrigger);
      return;
    }
    const button = event.target.closest("[data-donor-id]");
    if (!button) return;
    const donorId = button.getAttribute("data-donor-id");
    await selectDonor(donorId);
    render();
  });
  elements.export?.addEventListener("click", async (event) => {
    event.preventDefault();
    await exportDonors();
  });
  elements.newDonorButton?.addEventListener("click", async (event) => {
    await openDonorModal(event.currentTarget || event.target);
  });
  modal.container?.addEventListener("click", (event) => {
    const dismiss = event.target.closest("[data-modal-dismiss]");
    if (dismiss) {
      event.preventDefault();
      closeDonorModal();
    }
  });
  document.addEventListener("keydown", handleDonorModalKeydown);
}

async function loadData() {
  try {
    const [overview, donorList] = await Promise.all([
      fetchJson("/api/manager/overview"),
      fetchJson("/api/manager/donors"),
    ]);
    state.clients = Array.isArray(overview?.clients)
      ? overview.clients.map(normalizeClient)
      : [];
    state.donors = Array.isArray(donorList)
      ? sortDonors(donorList.map(normalizeDonorSummary))
      : [];
    state.assignments = buildAssignmentMap(state.donors);
    renderClientFilter();
    applyFilters();
  } catch (error) {
    console.error("Failed to load donors", error);
  }
}

function normalizeClient(client) {
  if (!client) return null;
  const id = client.id != null ? String(client.id) : "";
  return {
    id,
    label: client.name || client.label || client.candidate || "Unnamed candidate",
    candidate: client.name || client.candidate || client.label || "Unnamed candidate",
  };
}

function normalizeDonorSummary(donor) {
  if (!donor) return null;
  const id = donor.id != null ? String(donor.id) : "";
  const firstName = donor.first_name || "";
  const lastName = donor.last_name || "";
  const name = donor.name || `${firstName} ${lastName}`.trim();
  const askValue =
    donor.suggested_ask === null || donor.suggested_ask === undefined
      ? null
      : Number(donor.suggested_ask);
  return {
    id,
    name: name || "New donor",
    firstName,
    lastName,
    email: donor.email || "",
    phone: donor.phone || "",
    city: donor.city || "",
    company: donor.employer || "",
    industry: donor.occupation || "",
    tags: donor.tags || "",
    ask: Number.isNaN(askValue) ? null : askValue,
    lastGift: donor.last_gift_note || "",
    notes: donor.notes || "",
    biography: donor.bio || "",
    pictureUrl: donor.photo_url || "",
    assignedClientIds: parseAssignedIds(donor.assigned_client_ids),
    assignedLabel: donor.assigned_clients || "",
  };
}

function parseAssignedIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildAssignmentMap(donors) {
  const map = new Map();
  donors.forEach((donor) => {
    map.set(donor.id, new Set(donor.assignedClientIds || []));
  });
  return map;
}

function sortDonors(list = []) {
  return [...list].sort(
    (a, b) =>
      (a.lastName || "").localeCompare(b.lastName || "") ||
      (a.firstName || "").localeCompare(b.firstName || "") ||
      (a.name || "").localeCompare(b.name || ""),
  );
}

function applyFilters() {
  const term = state.searchTerm;
  const filterId = state.clientFilter;
  const assignmentFilter = state.assignmentFilter;
  const contactFilter = state.contactFilter;
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
    if (assignmentFilter && assignmentFilter !== "all") {
      const assigned = state.assignments.get(donor.id);
      const count = assigned ? assigned.size : 0;
      if (assignmentFilter === "assigned" && count === 0) {
        return false;
      }
      if (assignmentFilter === "unassigned" && count > 0) {
        return false;
      }
    }
    if (contactFilter && contactFilter !== "all") {
      const hasEmail = Boolean(donor.email && donor.email.trim());
      const hasPhone = Boolean(donor.phone && donor.phone.trim());
      if (contactFilter === "email" && !hasEmail) {
        return false;
      }
      if (contactFilter === "phone" && !hasPhone) {
        return false;
      }
      if (contactFilter === "both" && (!hasEmail || !hasPhone)) {
        return false;
      }
      if (contactFilter === "none" && (hasEmail || hasPhone)) {
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

async function selectDonor(donorId) {
  if (!donorId) {
    state.selectedDonorId = null;
    return;
  }
  const exists = state.donors.some((donor) => donor.id === donorId);
  state.selectedDonorId = exists ? donorId : null;
  if (state.selectedDonorId) {
    await ensureDonorDetail(state.selectedDonorId);
  }
}

async function ensureDonorDetail(donorId) {
  if (!donorId) return;
  if (state.donorDetails.has(donorId)) return;
  state.loadingDetailFor = donorId;
  render();
  try {
    const detail = await fetchJson(`/api/donors/${donorId}`);
    if (!detail) return;
    const normalized = normalizeDonorDetail(detail);
    state.donorDetails.set(donorId, normalized);
  } catch (error) {
    console.error("Failed to load donor detail", error);
  } finally {
    if (state.loadingDetailFor === donorId) {
      state.loadingDetailFor = null;
    }
  }
  render();
}

function normalizeDonorDetail(detail) {
  const summary = normalizeDonorSummary(detail);
  const history = Array.isArray(detail.history)
    ? detail.history.map((entry) => ({
        id: String(entry.id),
        year: entry.year,
        candidate: entry.candidate,
        amount: entry.amount,
      }))
    : [];
  history.sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    if (yearA !== yearB) {
      return yearB - yearA;
    }
    return (a.candidate || "").localeCompare(b.candidate || "");
  });
  const candidateNotes = Array.isArray(detail.client_notes)
    ? detail.client_notes
        .map((group) => {
          const notes = Array.isArray(group.notes)
            ? group.notes.map((note) => ({
                id: note.id != null ? String(note.id) : "",
                type: note.note_type || "general",
                content: note.note_content || "",
                isPrivate: Boolean(note.is_private),
                isImportant: Boolean(note.is_important),
                createdAt: note.created_at || null,
                updatedAt: note.updated_at || null,
              }))
            : [];
          return {
            clientId: group.client_id != null ? String(group.client_id) : "",
            clientName: group.client_name || group.client_candidate || "Unknown candidate",
            candidateLabel: group.client_candidate || group.client_name || "Unknown candidate",
            notes,
          };
        })
        .filter((group) => group.notes.length)
    : [];
  return {
    ...summary,
    history,
    candidateNotes,
  };
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
    if (!client) return;
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.label || client.candidate || "Unnamed candidate";
    select.append(option);
  });
  if (previous && state.clients.some((client) => client?.id === previous)) {
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
      <button class="btn btn--ghost" type="button" data-open-donor-modal>Create a donor</button>
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
    empty.removeAttribute("aria-hidden");
    empty.removeAttribute("hidden");
    return;
  }
  const summary = state.donors.find((item) => item.id === state.selectedDonorId);
  if (!summary) {
    empty.classList.remove("hidden");
    empty.removeAttribute("aria-hidden");
    empty.removeAttribute("hidden");
    state.selectedDonorId = null;
    return;
  }
  empty.classList.add("hidden");
  empty.setAttribute("aria-hidden", "true");
  empty.setAttribute("hidden", "");

  const detail = state.donorDetails.get(summary.id);
  if (state.loadingDetailFor === summary.id && !detail) {
    const loading = document.createElement("article");
    loading.className = "donor-profile";
    loading.innerHTML = `<p class="muted">Loading donor details…</p>`;
    container.append(loading);
    return;
  }
  if (!detail) {
    const missing = document.createElement("article");
    missing.className = "donor-profile";
    missing.innerHTML = `<p class="muted">Unable to load this donor right now.</p>`;
    container.append(missing);
    return;
  }

  if (!state.detailDraft || state.detailDraft.id !== summary.id) {
    state.detailDraft = createDraftFromDonor(detail);
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
  nameHeading.textContent = buildDraftDisplayName(draft.values, detail);
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
  if (state.detailStatus && state.detailStatus.donorId === detail.id) {
    status.textContent = state.detailStatus.message;
  }
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn--danger";
  deleteButton.textContent = "Delete donor";
  deleteButton.addEventListener("click", () => {
    void handleDeleteDonor(detail.id);
  });
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "btn btn--primary";
  saveButton.textContent = "Save changes";
  actions.append(status, deleteButton, saveButton);

  header.append(identity, actions);
  form.append(header);

  form.append(createIdentitySection(draft));
  form.append(createGivingSection(draft));
  form.append(createNotesSection(draft));
  form.append(createCandidateNotesSection(detail));
  form.append(createAssignmentSection(detail));
  form.append(createHistorySection(detail));

  profile.append(form);
  container.append(profile);

  form.addEventListener("input", (event) => handleInlineInput(event, detail, nameHeading, meta));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) {
      void handleInlineSubmit(detail);
      return;
    }
    if (!event.currentTarget.reportValidity()) {
      return;
    }
    void handleInlineSubmit(detail);
  });
}

async function openDonorModal(trigger = null) {
  if (!modal.container) return;
  donorModalTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement;
  if (isDonorModalOpen) {
    modal.firstField?.focus();
    return;
  }
  try {
    await refreshDonorEditorClients();
  } catch (error) {
    console.error("Failed to refresh clients for donor form", error);
  }
  resetDonorEditorForm();
  modal.container.classList.remove("hidden");
  modal.container.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  isDonorModalOpen = true;
  window.requestAnimationFrame(() => {
    modal.firstField?.focus();
  });
}

function closeDonorModal() {
  if (!modal.container || !isDonorModalOpen) return;
  modal.container.classList.add("hidden");
  modal.container.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  isDonorModalOpen = false;
  if (donorModalTrigger && typeof donorModalTrigger.focus === "function") {
    donorModalTrigger.focus();
  }
  donorModalTrigger = null;
}

function handleDonorModalKeydown(event) {
  if (!isDonorModalOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeDonorModal();
  }
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
      notes: donor.notes || "",
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

function createCandidateNotesSection(donor) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section donor-inline-form__section--client-notes";

  const header = document.createElement("div");
  header.className = "donor-inline-form__section-header";
  const title = document.createElement("h3");
  title.textContent = "Call time notes by candidate";
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent =
    "Review the notes captured by each candidate during call time. Candidates can only see their own notes in their workspace.";
  header.append(title, description);
  section.append(header);

  const groups = Array.isArray(donor.candidateNotes) ? donor.candidateNotes : [];
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No call time notes have been recorded yet.";
    section.append(empty);
    return section;
  }

  groups.forEach((group) => {
    const card = document.createElement("article");
    card.className = "donor-client-notes";

    const cardHeader = document.createElement("header");
    cardHeader.className = "donor-client-notes__header";
    const name = document.createElement("h4");
    name.className = "donor-client-notes__title";
    name.textContent = group.clientName || group.candidateLabel || "Unknown candidate";
    cardHeader.append(name);
    card.append(cardHeader);

    const list = document.createElement("ul");
    list.className = "donor-client-notes__list";
    if (!group.notes.length) {
      const empty = document.createElement("li");
      empty.className = "donor-client-notes__empty muted";
      empty.textContent = "No notes recorded.";
      list.append(empty);
    } else {
      group.notes.forEach((note) => {
        const item = document.createElement("li");
        item.className = "donor-client-notes__item";

        const meta = document.createElement("div");
        meta.className = "donor-client-notes__meta";
        const metaParts = [];
        if (note.type) {
          metaParts.push(formatNoteType(note.type));
        }
        if (note.isPrivate) {
          metaParts.push("Private");
        }
        if (note.isImportant) {
          metaParts.push("Important");
        }
        if (note.createdAt) {
          metaParts.push(formatTimestamp(note.createdAt));
        }
        meta.textContent = metaParts.join(" • ");

        const body = document.createElement("p");
        body.className = "donor-client-notes__body";
        body.textContent = note.content || "";

        item.append(meta, body);
        list.append(item);
      });
    }

    card.append(list);
    section.append(card);
  });

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

async function handleInlineSubmit(donor) {
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
    notes: values.notes.trim(),
    biography: values.biography.trim(),
    pictureUrl: values.pictureUrl.trim(),
  };

  try {
    const updated = await fetchJson(`/api/donors/${donor.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!updated) return;
    const normalized = normalizeDonorDetail(updated);
    state.donorDetails.set(donor.id, normalized);
    state.detailDraft = createDraftFromDonor(normalized);
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
    await refreshData({ donorId: donor.id, preserveDraft: true, skipClients: true });
  } catch (error) {
    console.error("Failed to update donor", error);
  }
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
        void toggleAssignment(donor.id, client.id, event.target.checked);
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

async function toggleAssignment(donorId, clientId, shouldAssign) {
  try {
    if (shouldAssign) {
      await fetchJson("/api/manager/assign-donor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, donorId }),
      });
    } else {
      await fetchJson(`/api/manager/assign-donor/${clientId}/${donorId}`, { method: "DELETE" });
    }
    await refreshData({ donorId, preserveDraft: true });
  } catch (error) {
    console.error("Failed to update assignment", error);
  }
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
    void addHistoryEntry(donor.id, yearInput, candidateInput, amountInput);
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
    void removeHistoryEntry(donor.id, entryId);
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

async function addHistoryEntry(donorId, yearInput, candidateInput, amountInput) {
  const yearValue = parseInt(yearInput.value, 10);
  const candidate = candidateInput.value.trim();
  const amountValue = parseNumber(amountInput.value);
  if (!candidate && Number.isNaN(yearValue) && amountValue === null) {
    return;
  }
  try {
    const payload = {
      year: Number.isNaN(yearValue) ? undefined : yearValue,
      candidate,
      amount: amountValue,
    };
    await fetchJson(`/api/donors/${donorId}/giving`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    yearInput.value = "";
    candidateInput.value = "";
    amountInput.value = "";
    await refreshData({ donorId, preserveDraft: true, skipClients: true });
  } catch (error) {
    console.error("Failed to add contribution", error);
  }
}

async function removeHistoryEntry(donorId, entryId) {
  if (!entryId) return;
  try {
    await fetchJson(`/api/donors/${donorId}/giving/${entryId}`, { method: "DELETE" });
    await refreshData({ donorId, preserveDraft: true, skipClients: true });
  } catch (error) {
    console.error("Failed to remove contribution", error);
  }
}

async function handleDeleteDonor(donorId) {
  const donor = state.donors.find((item) => item.id === donorId);
  const name = donor?.name || `${donor?.firstName || ""} ${donor?.lastName || ""}`.trim() || "this donor";
  const confirmed = window.confirm(
    `Delete ${name}? This will remove the donor and all related history. This action cannot be undone.`,
  );
  if (!confirmed) return;
  try {
    await fetchJson(`/api/donors/${donorId}`, { method: "DELETE" });
    state.donorDetails.delete(donorId);
    await refreshData({ donorId: null, preserveDraft: false });
  } catch (error) {
    console.error("Failed to delete donor", error);
  }
}

async function refreshData({ donorId = state.selectedDonorId, preserveDraft = false, skipClients = false } = {}) {
  try {
    const donors = await fetchJson("/api/manager/donors");
    if (Array.isArray(donors)) {
      const normalized = sortDonors(donors.map(normalizeDonorSummary));
      state.donors = normalized;
      state.assignments = buildAssignmentMap(state.donors);
    }
    if (!skipClients) {
      const overview = await fetchJson("/api/manager/overview");
      if (overview && Array.isArray(overview.clients)) {
        state.clients = overview.clients.map(normalizeClient).filter(Boolean);
      }
    }
    applyFilters();
    const isActiveDonor = Boolean(donorId && state.filtered.some((item) => item.id === donorId));
    if (isActiveDonor) {
      state.selectedDonorId = donorId;
      await ensureDonorDetail(donorId);
      const detail = state.donorDetails.get(donorId);
      if (detail) {
        if (preserveDraft && state.detailDraft && state.detailDraft.id === donorId) {
          state.detailDraft = {
            id: donorId,
            values: { ...state.detailDraft.values },
            history: detail.history ? detail.history.map((entry) => ({ ...entry })) : [],
          };
        } else {
          state.detailDraft = createDraftFromDonor(detail);
        }
      }
    } else {
      state.selectedDonorId = state.filtered.length ? state.filtered[0].id : null;
      if (state.selectedDonorId) {
        await ensureDonorDetail(state.selectedDonorId);
        const detail = state.donorDetails.get(state.selectedDonorId);
        if (detail) {
          if (preserveDraft && state.detailDraft && state.detailDraft.id === state.selectedDonorId) {
            state.detailDraft = {
              id: state.selectedDonorId,
              values: { ...state.detailDraft.values },
              history: detail.history ? detail.history.map((entry) => ({ ...entry })) : [],
            };
          } else {
            state.detailDraft = createDraftFromDonor(detail);
          }
        }
      } else {
        state.detailDraft = null;
      }
    }
    render();
  } catch (error) {
    console.error("Failed to refresh data", error);
  }
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isNaN(numeric) ? null : numeric;
}

function formatNoteType(value) {
  if (!value) return "";
  return value
    .toString()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

async function exportDonors() {
  try {
    const donors = await fetchJson("/api/manager/donors");
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
  } catch (error) {
    console.error("Failed to export donors", error);
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
