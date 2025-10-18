import {
  configureDonorEditor,
  refreshDonorEditorClients,
  resetDonorEditorForm,
} from "./donor-editor.js";
import { managerFetch, UnauthorizedError, getManagerToken, clearManagerSession } from "./auth.js";

const DONOR_TYPE = {
  INDIVIDUAL: "individual",
  BUSINESS: "business",
  CAMPAIGN: "campaign",
};

const ALL_DONOR_TYPES = [DONOR_TYPE.INDIVIDUAL, DONOR_TYPE.BUSINESS, DONOR_TYPE.CAMPAIGN];
const DONOR_TYPE_ORDER = [...ALL_DONOR_TYPES];

const ORGANIZATION_DONOR_TYPES = new Set([DONOR_TYPE.BUSINESS, DONOR_TYPE.CAMPAIGN]);

const DONOR_TYPE_LABELS = {
  [DONOR_TYPE.INDIVIDUAL]: "Individual",
  [DONOR_TYPE.BUSINESS]: "Business",
  [DONOR_TYPE.CAMPAIGN]: "Campaign / PAC",
};
const DONOR_TYPE_SECTION_LABELS = {
  [DONOR_TYPE.INDIVIDUAL]: "Individuals",
  [DONOR_TYPE.BUSINESS]: "Businesses",
  [DONOR_TYPE.CAMPAIGN]: "Campaigns / PACs",
};
const DONOR_TYPE_POSITION = DONOR_TYPE_ORDER.reduce((acc, type, index) => {
  acc[type] = index;
  return acc;
}, {});

const state = {
  donors: [],
  filtered: [],
  clients: [],
  assignments: new Map(),
  selectedDonorId: null,
  filters: getDefaultFilters(),
  hasExecutedSearch: false,
  availableGivingCandidates: [],
  detailDraft: null,
  detailStatus: null,
  detailStatusTimeout: null,
  historyEdit: null,
  donorDetails: new Map(),
  loadingDetailFor: null,
  givingInsights: {
    isOpen: false,
    mode: "search",
    candidate: "",
    candidateKey: "",
    candidateReport: null,
    candidateLoading: false,
    candidateError: null,
    searchFilters: {
      amount: "",
      minAmount: "",
      maxAmount: "",
      year: "",
    },
    searchResults: null,
    searchLoading: false,
    searchError: null,
    lastExecutedFilters: null,
  },
};

const elements = {
  searchForm: document.getElementById("donor-search-form"),
  searchTypeContainer: document.getElementById("donor-search-types"),
  searchIndividualName: document.getElementById("donor-search-individual-name"),
  searchOrganizationName: document.getElementById("donor-search-organization-name"),
  searchCandidates: document.getElementById("donor-search-candidates"),
  searchMinAmount: document.getElementById("donor-search-min-amount"),
  searchMaxAmount: document.getElementById("donor-search-max-amount"),
  searchCity: document.getElementById("donor-search-city"),
  searchCompany: document.getElementById("donor-search-company"),
  searchTags: document.getElementById("donor-search-tags"),
  searchReset: document.getElementById("donor-search-reset"),
  resultsList: document.getElementById("database-results-list"),
  resultsEmpty: document.getElementById("database-results-empty"),
  resultsEmptyTitle: document.getElementById("database-results-empty-title"),
  resultsEmptyMessage: document.getElementById("database-results-empty-message"),
  detail: document.getElementById("database-detail"),
  detailEmpty: document.getElementById("database-detail-empty"),
  export: document.getElementById("export-donors"),
  newDonorButton: document.getElementById("open-donor-modal"),
  givingInsightsOpen: document.getElementById("open-giving-insights"),
  givingInsightsPanel: document.getElementById("giving-insights"),
  givingInsightsBody: document.getElementById("giving-insights-body"),
  givingInsightsTitle: document.getElementById("giving-insights-title"),
  givingInsightsSubtitle: document.getElementById("giving-insights-subtitle"),
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
  elements.searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    executeSearch();
  });
  getTypeFilterInputs().forEach((input) => {
    input.addEventListener("change", handleTypeFilterChange);
  });
  elements.searchReset?.addEventListener("click", (event) => {
    event.preventDefault();
    resetSearchFilters();
    render();
  });
  elements.resultsList?.addEventListener("click", async (event) => {
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
  elements.givingInsightsOpen?.addEventListener("click", () => {
    openGivingInsights({ mode: "search" });
  });
  elements.givingInsightsPanel?.addEventListener("click", handleGivingInsightsClick);
  elements.givingInsightsPanel?.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement && event.target.id === "giving-insights-search") {
      event.preventDefault();
      handleGivingSearchSubmit(event.target);
    }
  });
  modal.container?.addEventListener("click", (event) => {
    const dismiss = event.target.closest("[data-modal-dismiss]");
    if (dismiss) {
      event.preventDefault();
      closeDonorModal();
    }
  });
  document.addEventListener("keydown", handleDonorModalKeydown);
  document.addEventListener("keydown", handleGivingInsightsKeydown);
}

async function loadData() {
  try {
    const [overview, donorList] = await Promise.all([
      fetchJson("/api/manager/overview"),
      fetchJson("/api/manager/donors"),
    ]);
    const clients = Array.isArray(overview?.clients)
      ? overview.clients.map(normalizeClient).filter(Boolean)
      : [];
    state.clients = clients;
    state.donors = Array.isArray(donorList)
      ? sortDonors(donorList.map((donor) => normalizeDonorSummary(donor, clients)))
      : [];
    state.assignments = buildAssignmentMap(state.donors);
    state.availableGivingCandidates = buildGivingCandidates(state.donors);
    renderCandidateFilter();
    applyFilters();
  } catch (error) {
    console.error("Failed to load donors", error);
  }
}

function executeSearch() {
  state.filters = collectSearchFilters();
  state.hasExecutedSearch = true;
  applyFilters();
  render();
}

function resetSearchFilters() {
  state.filters = getDefaultFilters();
  state.hasExecutedSearch = false;
  state.filtered = [];
  state.selectedDonorId = null;
  if (elements.searchForm instanceof HTMLFormElement) {
    elements.searchForm.reset();
  }
  getTypeFilterInputs().forEach((input) => {
    input.checked = true;
  });
  if (elements.searchCandidates instanceof HTMLSelectElement) {
    Array.from(elements.searchCandidates.options).forEach((option) => {
      option.selected = false;
    });
  }
  renderCandidateFilter();
  applyFilters();
}

function getTypeFilterInputs() {
  if (!elements.searchTypeContainer) {
    return [];
  }
  return Array.from(
    elements.searchTypeContainer.querySelectorAll("input[name='donorType']") || [],
  );
}

function handleTypeFilterChange() {
  const inputs = getTypeFilterInputs();
  if (!inputs.length) return;
  if (!inputs.some((input) => input.checked)) {
    inputs.forEach((input) => {
      input.checked = true;
    });
  }
}

function collectSearchFilters() {
  const candidates = elements.searchCandidates instanceof HTMLSelectElement
    ? Array.from(elements.searchCandidates.selectedOptions)
        .map((option) => option.value)
        .filter(Boolean)
    : [];
  const typeInputs = getTypeFilterInputs();
  const selectedTypes = typeInputs.length
    ? typeInputs.filter((input) => input.checked).map((input) => input.value)
    : [];
  return {
    individualName: (elements.searchIndividualName?.value || "").trim(),
    organizationName: (elements.searchOrganizationName?.value || "").trim(),
    types: selectedTypes.length ? selectedTypes : [...ALL_DONOR_TYPES],
    candidates,
    minAmount: (elements.searchMinAmount?.value || "").trim(),
    maxAmount: (elements.searchMaxAmount?.value || "").trim(),
    city: (elements.searchCity?.value || "").trim(),
    company: (elements.searchCompany?.value || "").trim(),
    tags: (elements.searchTags?.value || "").trim(),
  };
}

function getDefaultFilters() {
  return {
    individualName: "",
    organizationName: "",
    types: [...ALL_DONOR_TYPES],
    candidates: [],
    minAmount: "",
    maxAmount: "",
    city: "",
    company: "",
    tags: "",
  };
}

function parseAmountInput(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBooleanInput(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ["1", "true", "yes", "y", "on"].includes(normalized);
  }
  return false;
}

function buildGivingCandidates(donors = []) {
  const candidateSet = new Set();
  donors.forEach((donor) => {
    if (!donor) return;
    const list = Array.isArray(donor.searchCandidates)
      ? donor.searchCandidates
      : Array.isArray(donor.givingCandidates)
        ? donor.givingCandidates
        : [];
    list.forEach((candidate) => {
      if (candidate) {
        candidateSet.add(candidate);
      }
    });
  });
  return Array.from(candidateSet).sort((a, b) => a.localeCompare(b));
}

function renderCandidateFilter() {
  const select = elements.searchCandidates;
  if (!(select instanceof HTMLSelectElement)) return;
  const selectedValues = new Set(state.filters?.candidates || []);
  select.innerHTML = "";
  if (!state.availableGivingCandidates.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No candidates available";
    option.disabled = true;
    select.append(option);
    return;
  }
  state.availableGivingCandidates.forEach((candidate) => {
    const option = document.createElement("option");
    option.value = candidate;
    option.textContent = candidate;
    option.selected = selectedValues.has(candidate);
    select.append(option);
  });
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

const clientRosterCache = new WeakMap();

function normalizeCandidateKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildCandidateRoster(clients = state.clients || []) {
  if (!Array.isArray(clients)) return [];
  const cached = clientRosterCache.get(clients);
  if (cached) {
    return cached;
  }
  const seen = new Set();
  const roster = [];
  clients.forEach((client) => {
    if (!client) return;
    const label = client.candidate || client.label || client.name || "";
    const trimmedLabel = typeof label === "string" ? label.trim() : "";
    if (!trimmedLabel) return;
    const key = normalizeCandidateKey(trimmedLabel);
    if (!key || seen.has(key)) return;
    seen.add(key);
    roster.push({ label: trimmedLabel, key });
  });
  clientRosterCache.set(clients, roster);
  return roster;
}

function canonicalizeCandidateName(value, clients = state.clients || [], roster) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label) return "";
  const key = normalizeCandidateKey(label);
  if (!key) return "";
  const candidates = Array.isArray(roster) ? roster : buildCandidateRoster(clients);
  let exactMatch = null;
  let partialMatch = null;
  let partialMatchLength = 0;
  for (const candidate of candidates) {
    if (!candidate || !candidate.key) continue;
    if (candidate.key === key) {
      exactMatch = candidate;
      break;
    }
    if (candidate.key.includes(key) || key.includes(candidate.key)) {
      const overlapLength = Math.max(candidate.key.length, key.length);
      if (!partialMatch || overlapLength > partialMatchLength) {
        partialMatch = candidate;
        partialMatchLength = overlapLength;
      }
    }
  }
  if (exactMatch) {
    return exactMatch.label;
  }
  if (partialMatch) {
    return partialMatch.label;
  }
  return label;
}

function resolveDonorTypeFromRecord(donor) {
  const rawType = (donor.donor_type || donor.donorType || donor.category || donor.entity_type || "")
    .toString()
    .trim()
    .toLowerCase();
  if (ALL_DONOR_TYPES.includes(rawType)) {
    return rawType;
  }
  if (/campaign|committee|pac/.test(rawType)) {
    return DONOR_TYPE.CAMPAIGN;
  }
  if (/business|company|organisation|organization|corp/.test(rawType)) {
    return DONOR_TYPE.BUSINESS;
  }
  const isBusinessFlag = parseBooleanInput(
    donor.is_business ?? donor.isBusiness ?? donor.business_entity ?? donor.isBusinessEntity,
  );
  if (isBusinessFlag) {
    return DONOR_TYPE.BUSINESS;
  }
  const organizationName =
    donor.business_name || donor.businessName || donor.organization_name || donor.organizationName || "";
  if (organizationName && !((donor.first_name || "").trim() || (donor.last_name || "").trim())) {
    return DONOR_TYPE.BUSINESS;
  }
  return DONOR_TYPE.INDIVIDUAL;
}

function normalizeDonorSummary(donor, clients = state.clients || []) {
  if (!donor) return null;
  const id = donor.id != null ? String(donor.id) : "";
  const firstName = donor.first_name || "";
  const lastName = donor.last_name || "";
  const donorType = resolveDonorTypeFromRecord(donor);
  const isOrganization = ORGANIZATION_DONOR_TYPES.has(donorType);
  const rawOrganizationName =
    donor.business_name || donor.businessName || donor.organization_name || donor.organizationName || "";
  const fallbackName = `${firstName} ${lastName}`.trim();
  const baseName = donor.name || fallbackName || rawOrganizationName;
  const displayName = isOrganization ? rawOrganizationName || baseName : baseName;
  const clientMap = Array.isArray(clients)
    ? clients.reduce((map, client) => {
        if (client && client.id) {
          map.set(String(client.id), client);
        }
        return map;
      }, new Map())
    : new Map();
  const candidateRoster = buildCandidateRoster(clients);
  const askValue =
    donor.suggested_ask === null || donor.suggested_ask === undefined
      ? null
      : Number(donor.suggested_ask);
  const totalContributedRaw =
    donor.total_contributed !== undefined && donor.total_contributed !== null
      ? Number(donor.total_contributed)
      : donor.totalContributed !== undefined && donor.totalContributed !== null
        ? Number(donor.totalContributed)
        : null;
  const totalContributed = Number.isFinite(totalContributedRaw) ? totalContributedRaw : 0;
  const givingCandidates = mergeCandidateNames(
    parseDelimitedList(donor.donated_candidates || donor.giving_candidates)
      .map((candidate) => canonicalizeCandidateName(candidate, clients, candidateRoster))
      .filter(Boolean),
  );
  const assignedClientIds = parseAssignedIds(donor.assigned_client_ids);
  const assignedClientFreeform = parseDelimitedList(donor.assigned_clients || donor.assignedClients)
    .map((candidate) => canonicalizeCandidateName(candidate, clients, candidateRoster))
    .filter(Boolean);
  const assignedClientLabels = mergeCandidateNames(
    assignedClientIds
      .map((clientId) => clientMap.get(clientId))
      .filter(Boolean)
      .map((client) =>
        canonicalizeCandidateName(client.candidate || client.label || client.name || "", clients, candidateRoster),
      ),
    assignedClientFreeform,
  );
  const searchableCandidates = mergeCandidateNames(givingCandidates, assignedClientLabels);
  return {
    id,
    name: displayName || "New donor",
    firstName,
    lastName,
    type: donorType,
    typeLabel: DONOR_TYPE_LABELS[donorType] || "Donor",
    isBusiness: isOrganization,
    organizationName: rawOrganizationName || "",
    businessName: rawOrganizationName || "",
    email: donor.email || "",
    phone: donor.phone || "",
    city: donor.city || "",
    state: donor.state || "",
    postalCode: donor.postal_code || "",
    street: donor.street_address || "",
    addressLine2: donor.address_line2 || "",
    company: donor.employer || "",
    title: donor.job_title || donor.title || "",
    industry: donor.occupation || "",
    tags: donor.tags || "",
    ask: Number.isNaN(askValue) ? null : askValue,
    totalContributed,
    givingCandidates,
    lastGift: donor.last_gift_note || "",
    notes: donor.notes || "",
    biography: donor.bio || "",
    pictureUrl: donor.photo_url || "",
    assignedClientIds,
    assignedCandidateNames: assignedClientLabels,
    searchCandidates: searchableCandidates,
    assignedLabel: donor.assigned_clients || "",
    exclusiveDonor: Boolean(Number(donor.exclusive_donor || donor.exclusiveDonor || 0)),
    exclusiveClientId:
      donor.exclusive_client_id != null && donor.exclusive_client_id !== ""
        ? String(donor.exclusive_client_id)
        : "",
  };
}

function parseAssignedIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseDelimitedList(raw) {
  if (!raw) return [];
  const seen = new Set();
  const values = [];
  String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      if (!seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    });
  return values;
}

function mergeCandidateNames(...lists) {
  const seen = new Set();
  const result = [];
  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((value) => {
      const normalized = typeof value === "string" ? value.trim() : "";
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      result.push(normalized);
    });
  });
  return result;
}

function buildAssignmentMap(donors) {
  const map = new Map();
  donors.forEach((donor) => {
    map.set(donor.id, new Set(donor.assignedClientIds || []));
  });
  return map;
}

function sortDonors(list = []) {
  return [...list].sort((a, b) => {
    const orderA = DONOR_TYPE_POSITION[a.type] ?? 99;
    const orderB = DONOR_TYPE_POSITION[b.type] ?? 99;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    if (ORGANIZATION_DONOR_TYPES.has(a.type) && ORGANIZATION_DONOR_TYPES.has(b.type)) {
      return (a.organizationName || a.name || "").localeCompare(b.organizationName || b.name || "");
    }
    return (
      (a.lastName || "").localeCompare(b.lastName || "") ||
      (a.firstName || "").localeCompare(b.firstName || "") ||
      (a.name || "").localeCompare(b.name || "")
    );
  });
}

function applyFilters() {
  if (!state.hasExecutedSearch) {
    state.filtered = [];
    state.selectedDonorId = null;
    return;
  }
  const filters = state.filters || getDefaultFilters();
  const typeSelection = Array.isArray(filters.types) && filters.types.length
    ? filters.types
    : [...ALL_DONOR_TYPES];
  const typeSet = new Set(typeSelection.map((type) => String(type).toLowerCase()));
  const individualNameTerm = (filters.individualName || "").toLowerCase();
  const organizationNameTerm = (filters.organizationName || "").toLowerCase();
  const cityTerm = filters.city.toLowerCase();
  const companyTerm = filters.company.toLowerCase();
  const tagsTerm = filters.tags.toLowerCase();
  const minAmount = parseAmountInput(filters.minAmount);
  const maxAmount = parseAmountInput(filters.maxAmount);
  const candidateSet = new Set(
    Array.isArray(filters.candidates)
      ? filters.candidates.map((candidate) => candidate.toLowerCase())
      : [],
  );

  state.filtered = state.donors.filter((donor) => {
    if (!donor) return false;
    if (!typeSet.has(donor.type)) {
      return false;
    }
    if (individualNameTerm) {
      if (donor.type !== DONOR_TYPE.INDIVIDUAL) {
        return false;
      }
      const nameHaystack = [donor.name, donor.firstName, donor.lastName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!nameHaystack.includes(individualNameTerm)) {
        return false;
      }
    }
    if (organizationNameTerm) {
      if (!ORGANIZATION_DONOR_TYPES.has(donor.type)) {
        return false;
      }
      const organizationHaystack = (donor.organizationName || donor.name || "").toLowerCase();
      if (!organizationHaystack.includes(organizationNameTerm)) {
        return false;
      }
    }
    if (candidateSet.size) {
      const donorCandidates = Array.isArray(donor.searchCandidates)
        ? donor.searchCandidates.map((candidate) => candidate.toLowerCase())
        : Array.isArray(donor.givingCandidates)
          ? donor.givingCandidates.map((candidate) => candidate.toLowerCase())
          : [];
      const hasCandidate = donorCandidates.some((candidate) => candidateSet.has(candidate));
      if (!hasCandidate) {
        return false;
      }
    }
    const total = Number.isFinite(donor.totalContributed) ? donor.totalContributed : 0;
    if (minAmount !== null && total < minAmount) {
      return false;
    }
    if (maxAmount !== null && total > maxAmount) {
      return false;
    }
    if (cityTerm) {
      const cityHaystack = [donor.city, donor.state, donor.postalCode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!cityHaystack.includes(cityTerm)) {
        return false;
      }
    }
    if (companyTerm) {
      const companyHaystack = [donor.company, donor.title, donor.industry]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!companyHaystack.includes(companyTerm)) {
        return false;
      }
    }
    if (tagsTerm) {
      const tagsHaystack = (donor.tags || "").toLowerCase();
      if (!tagsHaystack.includes(tagsTerm)) {
        return false;
      }
    }
    return true;
  });

  if (state.selectedDonorId && !state.filtered.some((donor) => donor.id === state.selectedDonorId)) {
    state.selectedDonorId = null;
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

async function ensureDonorDetail(donorId, { force = false } = {}) {
  if (!donorId) return;
  if (!force && state.donorDetails.has(donorId)) return;
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
  const summary = normalizeDonorSummary(detail, state.clients);
  const history = Array.isArray(detail.history)
    ? detail.history.map((entry) => ({
        id: entry.id != null ? String(entry.id) : "",
        year: Number.isInteger(Number.parseInt(entry.year, 10))
          ? Number.parseInt(entry.year, 10)
          : null,
        candidate: entry.candidate || "",
        officeSought: entry.officeSought || entry.office_sought || "",
        amount: entry.amount,
        createdAt: entry.createdAt || entry.created_at || null,
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
  renderSearchResults();
  renderDonorDetail();
  renderGivingInsights();
}

function renderSearchResults() {
  const list = elements.resultsList;
  const empty = elements.resultsEmpty;
  const emptyTitle = elements.resultsEmptyTitle;
  const emptyMessage = elements.resultsEmptyMessage;
  if (!list || !empty || !emptyTitle || !emptyMessage) return;

  list.innerHTML = "";

  if (!state.hasExecutedSearch) {
    setResultsEmptyState("Search donors", "Enter one or more filters above, then search to see matching donors.");
    empty.classList.remove("hidden");
    list.classList.add("hidden");
    if (elements.detailEmpty) {
      elements.detailEmpty.classList.add("hidden");
    }
    return;
  }

  if (!state.filtered.length) {
    setResultsEmptyState("No donors found", "Try adjusting your filters or clearing them to expand the results.");
    empty.classList.remove("hidden");
    list.classList.add("hidden");
    if (elements.detailEmpty) {
      elements.detailEmpty.classList.add("hidden");
    }
    return;
  }

  empty.classList.add("hidden");
  list.classList.remove("hidden");

  const groups = buildDonorTypeGroups(state.filtered);
  const selectedTypes = Array.isArray(state.filters?.types) && state.filters.types.length
    ? state.filters.types
    : [...ALL_DONOR_TYPES];
  const shouldGroupByType = groups.length > 1 || selectedTypes.length > 1;

  groups.forEach((group, index) => {
    if (shouldGroupByType) {
      const heading = createTypeSectionHeading(group.type, group.donors.length, index === 0);
      list.append(heading);
    }
    group.donors.forEach((donor) => {
      const item = createDonorListItem(donor);
      list.append(item);
    });
  });

  if (!state.selectedDonorId && elements.detailEmpty) {
    elements.detailEmpty.classList.remove("hidden");
    elements.detailEmpty.removeAttribute("aria-hidden");
    elements.detailEmpty.removeAttribute("hidden");
  }
}

function buildDonorTypeGroups(donors) {
  const grouped = new Map();
  donors.forEach((donor) => {
    if (!donor) return;
    const type = DONOR_TYPE_ORDER.includes(donor.type) ? donor.type : DONOR_TYPE.INDIVIDUAL;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type).push(donor);
  });
  return DONOR_TYPE_ORDER.filter((type) => grouped.has(type)).map((type) => ({
    type,
    donors: grouped.get(type) || [],
  }));
}

function createTypeSectionHeading(type, count, isFirstSection) {
  const item = document.createElement("li");
  item.className = "database-list__section";
  item.setAttribute("data-donor-type-section", type);
  if (isFirstSection) {
    item.classList.add("database-list__section--first");
  }
  const label = document.createElement("span");
  label.className = "database-list__section-label";
  label.textContent = DONOR_TYPE_SECTION_LABELS[type] || DONOR_TYPE_LABELS[type] || "Donors";
  label.setAttribute("role", "heading");
  label.setAttribute("aria-level", "3");
  const countLabel = document.createElement("span");
  countLabel.className = "database-list__section-count";
  countLabel.textContent = formatDonorCount(count);
  item.append(label, countLabel);
  return item;
}

function createDonorListItem(donor) {
  const item = document.createElement("li");
  item.className = "database-list__item";
  if (donor.id === state.selectedDonorId) {
    item.classList.add("database-list__item--active");
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "database-list__button";
  button.setAttribute("data-donor-id", donor.id);

  const metaLines = [];
  if (donor.typeLabel) {
    metaLines.push(donor.typeLabel);
  }
  const assigned = state.assignments.get(donor.id) || new Set();
  const assignedCount = assigned.size;
  const focusLabel = assignedCount
    ? `${assignedCount} focus ${assignedCount === 1 ? "list" : "lists"}`
    : "Not assigned";
  const totalLabel = donor.totalContributed > 0
    ? `$${formatCurrency(donor.totalContributed)} recorded`
    : "No giving history";
  metaLines.push(`${totalLabel} • ${focusLabel}`);

  const location = buildLocationLabel(donor.city, donor.state, donor.postalCode);
  const professionalParts = [location, donor.company, donor.title].filter(Boolean);
  if (professionalParts.length) {
    metaLines.push(professionalParts.join(" • "));
  }

  const candidateSummary = formatCandidateSummary(donor.givingCandidates);
  if (candidateSummary) {
    metaLines.push(`Donated to: ${candidateSummary}`);
  }

  button.innerHTML = [
    `<span class="database-list__title">${escapeHtml(donor.name || "New donor")}</span>`,
    ...metaLines.map((line) => `<span class="database-list__meta">${escapeHtml(line)}</span>`),
  ].join("");

  item.append(button);
  return item;
}

function formatDonorCount(count) {
  const safeCount = Number.isFinite(count) ? count : 0;
  if (safeCount === 1) {
    return "1 donor";
  }
  return `${safeCount} donors`;
}

function setResultsEmptyState(title, message) {
  if (elements.resultsEmptyTitle) {
    elements.resultsEmptyTitle.textContent = title;
  }
  if (elements.resultsEmptyMessage) {
    elements.resultsEmptyMessage.textContent = message;
  }
}

function renderDonorDetail() {
  const container = elements.detail;
  const empty = elements.detailEmpty;
  if (!container || !empty) return;
  container.querySelectorAll(".donor-profile").forEach((node) => node.remove());
  if (!state.selectedDonorId) {
    if (state.hasExecutedSearch && state.filtered.length) {
      empty.classList.remove("hidden");
      empty.removeAttribute("aria-hidden");
      empty.removeAttribute("hidden");
    } else {
      empty.classList.add("hidden");
      empty.setAttribute("aria-hidden", "true");
      empty.setAttribute("hidden", "true");
    }
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
  if (!state.historyEdit || state.historyEdit.donorId !== summary.id) {
    state.historyEdit = null;
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

  if (detail.typeLabel) {
    const badge = document.createElement("span");
    badge.className = "status status--info";
    badge.textContent = detail.typeLabel;
    identity.append(badge);
  }

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

  updateInlineIdentityRequirements(form, draft.values);

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
        id: entry.id != null ? String(entry.id) : "",
        year: entry.year,
        candidate: entry.candidate,
        officeSought: entry.officeSought || "",
        amount: entry.amount,
        createdAt: entry.createdAt || null,
      }))
    : [];
  sortHistory(history);
  return {
    id: donor.id,
    values: {
      firstName: donor.firstName || "",
      lastName: donor.lastName || "",
      donorType: ALL_DONOR_TYPES.includes(donor.type) ? donor.type : DONOR_TYPE.INDIVIDUAL,
      organizationName: donor.organizationName || "",
      email: donor.email || "",
      phone: donor.phone || "",
      street: donor.street || "",
      addressLine2: donor.addressLine2 || "",
      city: donor.city || "",
      state: donor.state || "",
      postalCode: donor.postalCode || "",
      company: donor.company || "",
      title: donor.title || "",
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
      exclusiveDonor: donor.exclusiveDonor ? "yes" : "no",
      exclusiveClientId: donor.exclusiveClientId || "",
    },
    history,
  };
}

function buildDraftDisplayName(values, donor) {
  const donorType = values.donorType && ALL_DONOR_TYPES.includes(values.donorType)
    ? values.donorType
    : donor.type || DONOR_TYPE.INDIVIDUAL;
  if (ORGANIZATION_DONOR_TYPES.has(donorType)) {
    const organizationName = (values.organizationName || donor.organizationName || donor.name || "").trim();
    if (organizationName) return organizationName;
  }
  const name = `${values.firstName || ""} ${values.lastName || ""}`.trim();
  if (name) return name;
  if (donor.name) return donor.name;
  if (donor.organizationName) return donor.organizationName;
  if (values.email) return values.email;
  return "New donor";
}

function buildLocationLabel(city, state, postalCode) {
  const locality = [city, state].filter(Boolean).join(", ");
  if (postalCode) {
    return locality ? `${locality} ${postalCode}` : postalCode;
  }
  return locality;
}

function formatCandidateSummary(candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return "";
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length === 2) {
    return `${candidates[0]}, ${candidates[1]}`;
  }
  const [first, second, ...rest] = candidates;
  return `${first}, ${second} +${rest.length} more`;
}

function buildDraftMeta(values) {
  const location = buildLocationLabel(values.city, values.state, values.postalCode);
  return [location, values.title, values.company, values.industry]
    .filter(Boolean)
    .join(" • ");
}

function createIdentitySection(draft) {
  const section = document.createElement("section");
  section.className = "donor-inline-form__section";
  const heading = document.createElement("h3");
  heading.textContent = "Identity & contact";
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "form-grid";
  const donorTypeValue = ALL_DONOR_TYPES.includes(draft.values.donorType)
    ? draft.values.donorType
    : DONOR_TYPE.INDIVIDUAL;
  const organizationRequired = ORGANIZATION_DONOR_TYPES.has(donorTypeValue);
  grid.append(
    createSelectField("inline-donor-type", "donorType", "Donor type", donorTypeValue, [
      { value: DONOR_TYPE.INDIVIDUAL, label: "Individual" },
      { value: DONOR_TYPE.BUSINESS, label: "Business / Organization" },
      { value: DONOR_TYPE.CAMPAIGN, label: "Campaign / PAC" },
    ]),
    createInputField(
      "inline-organization-name",
      "organizationName",
      "Organization name",
      draft.values.organizationName,
      {
        required: organizationRequired,
        autocomplete: "organization",
      },
    ),
    createInputField("inline-first-name", "firstName", "First name", draft.values.firstName, {
      required: !organizationRequired,
      autocomplete: "given-name",
    }),
    createInputField("inline-last-name", "lastName", "Last name", draft.values.lastName, {
      required: !organizationRequired,
      autocomplete: "family-name",
    }),
    createInputField("inline-email", "email", "Email", draft.values.email, {
      type: "email",
      autocomplete: "email",
    }),
    createInputField("inline-phone", "phone", "Phone", draft.values.phone, {
      autocomplete: "tel",
    }),
    createInputField("inline-street", "street", "Street address", draft.values.street, {
      autocomplete: "address-line1",
    }),
    createInputField(
      "inline-address-line-2",
      "addressLine2",
      "Address line 2",
      draft.values.addressLine2,
      {
        autocomplete: "address-line2",
      },
    ),
    createInputField("inline-city", "city", "City", draft.values.city, {
      autocomplete: "address-level2",
    }),
    createInputField("inline-state", "state", "State / Region", draft.values.state, {
      autocomplete: "address-level1",
    }),
    createInputField("inline-postal-code", "postalCode", "Postal code", draft.values.postalCode, {
      autocomplete: "postal-code",
    }),
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
    createInputField("inline-title", "title", "Title / Occupation", draft.values.title),
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

function createSelectField(id, name, label, value, options = []) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-row";
  const labelEl = document.createElement("label");
  labelEl.className = "form-label";
  labelEl.setAttribute("for", id);
  labelEl.textContent = label;
  const select = document.createElement("select");
  select.className = "input select";
  select.id = id;
  select.name = name;
  options.forEach((option) => {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.append(optionEl);
  });
  select.value = value || options?.[0]?.value || "";
  wrapper.append(labelEl, select);
  return wrapper;
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

function updateInlineIdentityRequirements(form, values) {
  if (!(form instanceof HTMLFormElement)) return;
  const donorType = values?.donorType && ALL_DONOR_TYPES.includes(values.donorType)
    ? values.donorType
    : DONOR_TYPE.INDIVIDUAL;
  const isOrganization = ORGANIZATION_DONOR_TYPES.has(donorType);
  const firstNameInput = form.querySelector("input[name='firstName']");
  const lastNameInput = form.querySelector("input[name='lastName']");
  const organizationInput = form.querySelector("input[name='organizationName']");
  if (firstNameInput) {
    firstNameInput.required = !isOrganization;
  }
  if (lastNameInput) {
    lastNameInput.required = !isOrganization;
  }
  if (organizationInput) {
    organizationInput.required = isOrganization;
  }
}

function handleInlineInput(event, donor, nameHeading, metaElement) {
  const target = event.target;
  if (
    !target ||
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
  ) {
    return;
  }
  if (!state.detailDraft || state.detailDraft.id !== donor.id) {
    return;
  }
  if (!target.name) return;
  state.detailDraft.values[target.name] = target.value;
  if (target.name === "donorType") {
    if (event.currentTarget instanceof HTMLFormElement) {
      updateInlineIdentityRequirements(event.currentTarget, state.detailDraft.values);
    }
    nameHeading.textContent = buildDraftDisplayName(state.detailDraft.values, donor);
  }
  if (target.name === "organizationName") {
    nameHeading.textContent = buildDraftDisplayName(state.detailDraft.values, donor);
  }
  if (target.name === "firstName" || target.name === "lastName") {
    nameHeading.textContent = buildDraftDisplayName(state.detailDraft.values, donor);
  }
  if (
    target.name === "city" ||
    target.name === "state" ||
    target.name === "postalCode" ||
    target.name === "title" ||
    target.name === "company" ||
    target.name === "industry"
  ) {
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
  const donorType = ALL_DONOR_TYPES.includes(values.donorType) ? values.donorType : DONOR_TYPE.INDIVIDUAL;
  const organizationName = values.organizationName.trim();
  const isOrganization = ORGANIZATION_DONOR_TYPES.has(donorType);
  const payload = {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    donorType,
    organizationName,
    isBusiness: isOrganization,
    businessName: isOrganization ? organizationName : "",
    email: values.email.trim(),
    phone: values.phone.trim(),
    street: values.street.trim(),
    addressLine2: values.addressLine2.trim(),
    city: values.city.trim(),
    state: values.state.trim(),
    postalCode: values.postalCode.trim(),
    company: values.company.trim(),
    title: values.title.trim(),
    industry: values.industry.trim(),
    tags: values.tags.trim(),
    ask: parseNumber(values.ask),
    lastGift: values.lastGift.trim(),
    notes: values.notes.trim(),
    biography: values.biography.trim(),
    pictureUrl: values.pictureUrl.trim(),
    exclusiveDonor: values.exclusiveDonor === "yes",
    exclusiveClientId: values.exclusiveClientId || null,
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
    queueDetailStatus(donor.id, "Saved just now");
    await refreshData({ donorId: donor.id, preserveDraft: true, skipClients: true });
  } catch (error) {
    console.error("Failed to update donor", error);
  }
}

function queueDetailStatus(donorId, message, duration = 3000) {
  state.detailStatus = { donorId, message };
  if (state.detailStatusTimeout) {
    clearTimeout(state.detailStatusTimeout);
  }
  state.detailStatusTimeout = window.setTimeout(() => {
    if (state.detailStatus && state.detailStatus.donorId === donorId) {
      state.detailStatus = null;
      const statusNode = elements.detail?.querySelector("[data-status]");
      if (statusNode) {
        statusNode.textContent = "";
      }
    }
    state.detailStatusTimeout = null;
  }, duration);
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
      if (donor.exclusiveDonor && donor.exclusiveClientId === client.id) {
        chip.dataset.exclusive = "true";
        chip.textContent = `${chip.textContent} (exclusive)`;
      }
      chips.append(chip);
    });
  } else {
    const emptyChip = document.createElement("span");
    emptyChip.className = "muted";
    emptyChip.textContent = "Not assigned to any focus lists.";
    chips.append(emptyChip);
  }
  section.append(chips);

  const draftValues =
    state.detailDraft && state.detailDraft.id === donor.id ? state.detailDraft.values : null;
  const exclusiveValue =
    draftValues && typeof draftValues.exclusiveDonor === "string"
      ? draftValues.exclusiveDonor === "yes"
      : Boolean(donor.exclusiveDonor);
  const exclusiveClientId =
    draftValues && draftValues.exclusiveClientId !== undefined
      ? draftValues.exclusiveClientId || ""
      : donor.exclusiveClientId || "";

  const exclusivityGrid = document.createElement("div");
  exclusivityGrid.className = "form-grid donor-assignment__exclusive";

  const toggleWrapper = document.createElement("div");
  toggleWrapper.className = "form-row";
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "form-label";
  toggleLabel.setAttribute("for", "inline-exclusive-toggle");
  toggleLabel.textContent = "Exclusive donor";
  const toggleSelect = document.createElement("select");
  toggleSelect.className = "input select";
  toggleSelect.id = "inline-exclusive-toggle";
  toggleSelect.name = "exclusiveDonor";
  const allowOption = document.createElement("option");
  allowOption.value = "no";
  allowOption.textContent = "No — allow multiple campaigns";
  const lockOption = document.createElement("option");
  lockOption.value = "yes";
  lockOption.textContent = "Yes — lock to a single campaign";
  toggleSelect.append(allowOption, lockOption);
  toggleSelect.value = exclusiveValue ? "yes" : "no";
  toggleWrapper.append(toggleLabel, toggleSelect);

  const clientWrapper = document.createElement("div");
  clientWrapper.className = "form-row";
  const clientLabel = document.createElement("label");
  clientLabel.className = "form-label";
  clientLabel.setAttribute("for", "inline-exclusive-client");
  clientLabel.textContent = "Locked campaign";
  const clientSelect = document.createElement("select");
  clientSelect.className = "input select";
  clientSelect.id = "inline-exclusive-client";
  clientSelect.name = "exclusiveClientId";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.clients.length ? "Select a campaign" : "No campaigns available";
  placeholder.disabled = state.clients.length > 0;
  placeholder.hidden = state.clients.length > 0;
  clientSelect.append(placeholder);
  state.clients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.label || client.candidate || "Unnamed candidate";
    clientSelect.append(option);
  });
  if (exclusiveClientId && state.clients.some((client) => client.id === exclusiveClientId)) {
    clientSelect.value = exclusiveClientId;
  }
  if (!exclusiveValue) {
    clientSelect.setAttribute("disabled", "true");
  }
  clientWrapper.append(clientLabel, clientSelect);

  exclusivityGrid.append(toggleWrapper, clientWrapper);
  section.append(exclusivityGrid);

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
      if (exclusiveValue) {
        input.setAttribute("disabled", "true");
      } else {
        input.addEventListener("change", (event) => {
          void toggleAssignment(donor.id, client.id, event.target.checked);
        });
      }
      const name = document.createElement("span");
      name.textContent = client.label || client.candidate || "Unnamed candidate";
      label.append(input, name);
      options.append(label);
    });
  }
  section.append(options);

  toggleSelect.addEventListener("change", async (event) => {
    const shouldLock = event.target.value === "yes";
    if (state.detailDraft && state.detailDraft.id === donor.id) {
      state.detailDraft.values.exclusiveDonor = shouldLock ? "yes" : "no";
    }
    if (shouldLock) {
      if (!state.clients.length) {
        event.target.value = "no";
        queueDetailStatus(donor.id, "Add a campaign before locking this donor.", 4000);
        return;
      }
      let targetClient = clientSelect.value || exclusiveClientId;
      if (!targetClient) {
        const assignedClient = assigned.size ? [...assigned][0] : "";
        targetClient = assignedClient || (state.clients[0]?.id || "");
      }
      if (!targetClient) {
        event.target.value = "no";
        queueDetailStatus(donor.id, "Select a campaign to lock this donor.", 4000);
        return;
      }
      clientSelect.removeAttribute("disabled");
      clientSelect.value = targetClient;
      if (state.detailDraft && state.detailDraft.id === donor.id) {
        state.detailDraft.values.exclusiveClientId = targetClient;
      }
      await changeDonorExclusivity(donor, {
        exclusiveDonor: true,
        exclusiveClientId: targetClient,
      });
    } else {
      clientSelect.setAttribute("disabled", "true");
      if (state.detailDraft && state.detailDraft.id === donor.id) {
        state.detailDraft.values.exclusiveClientId = "";
      }
      await changeDonorExclusivity(donor, { exclusiveDonor: false, exclusiveClientId: null });
    }
  });

  clientSelect.addEventListener("change", async (event) => {
    const value = event.target.value;
    if (!value) {
      return;
    }
    if (state.detailDraft && state.detailDraft.id === donor.id) {
      state.detailDraft.values.exclusiveDonor = "yes";
      state.detailDraft.values.exclusiveClientId = value;
    }
    await changeDonorExclusivity(donor, { exclusiveDonor: true, exclusiveClientId: value });
  });

  return section;
}

async function toggleAssignment(donorId, clientId, shouldAssign) {
  try {
    const detail = state.donorDetails.get(donorId);
    const exclusiveClientId = detail?.exclusiveClientId || "";
    const isExclusive = Boolean(detail?.exclusiveDonor);
    const clientKey = String(clientId);
    if (isExclusive) {
      if (shouldAssign && exclusiveClientId && exclusiveClientId !== clientKey) {
        queueDetailStatus(donorId, "This donor is locked to another campaign.", 4000);
        return;
      }
      if (!shouldAssign && exclusiveClientId && exclusiveClientId === clientKey) {
        queueDetailStatus(donorId, "Unlock this donor before removing the assignment.", 4000);
        return;
      }
    }
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
    queueDetailStatus(donorId, "We couldn't update this assignment.", 4000);
  }
}

async function changeDonorExclusivity(donor, { exclusiveDonor, exclusiveClientId }) {
  try {
    const payload = {
      exclusiveDonor,
      exclusiveClientId: exclusiveClientId === undefined ? null : exclusiveClientId,
    };
    await fetchJson(`/api/donors/${donor.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const message = exclusiveDonor
      ? "Locked to selected campaign"
      : "Exclusive lock removed";
    queueDetailStatus(donor.id, message);
    await refreshData({ donorId: donor.id, preserveDraft: true, forceDetail: true });
  } catch (error) {
    console.error("Failed to update exclusivity", error);
    queueDetailStatus(donor.id, "We couldn't update exclusivity.", 4000);
    await refreshData({ donorId: donor.id, preserveDraft: true, forceDetail: true });
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
  const officeInput = document.createElement("input");
  officeInput.className = "input";
  officeInput.id = "inline-history-office";
  officeInput.name = "historyOffice";
  officeInput.placeholder = "Office sought";
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
    void addHistoryEntry(donor.id, yearInput, candidateInput, officeInput, amountInput);
  });

  formRow.append(yearInput, candidateInput, officeInput, amountInput, addButton);
  section.append(formRow);

  const list = document.createElement("div");
  list.className = "history-list";
  renderHistoryItems(list, state.detailDraft?.history || []);
  list.addEventListener("click", (event) => {
    const candidateTrigger = event.target.closest("[data-view-candidate]");
    if (candidateTrigger) {
      const candidateName = candidateTrigger.getAttribute("data-view-candidate");
      if (candidateName) {
        openGivingInsights({ mode: "candidate", candidate: candidateName });
      }
      return;
    }
    const saveButton = event.target.closest("[data-save-history]");
    if (saveButton) {
      const entryId = saveButton.getAttribute("data-save-history");
      const row = saveButton.closest("tr");
      if (!entryId || !row) return;
      const yearInput = row.querySelector("[data-history-year]");
      const candidateInput = row.querySelector("[data-history-candidate]");
      const officeInput = row.querySelector("[data-history-office]");
      const amountInput = row.querySelector("[data-history-amount]");
      void updateHistoryEntry(donor.id, entryId, yearInput, candidateInput, officeInput, amountInput);
      return;
    }
    const cancelButton = event.target.closest("[data-cancel-history-edit]");
    if (cancelButton) {
      state.historyEdit = null;
      renderHistoryItems(list, state.detailDraft?.history || []);
      return;
    }
    const editButton = event.target.closest("[data-edit-history]");
    if (editButton) {
      const entryId = editButton.getAttribute("data-edit-history");
      if (!entryId) return;
      const existing = (state.detailDraft?.history || []).find((item) => item.id === entryId);
      if (!existing) return;
      state.historyEdit = { donorId: donor.id, entryId };
      renderHistoryItems(list, state.detailDraft?.history || []);
      return;
    }
    const removeButton = event.target.closest("[data-remove-history]");
    if (!removeButton) return;
    const entryId = removeButton.getAttribute("data-remove-history");
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
  head.innerHTML = "<tr><th>Year</th><th>Candidate</th><th>Office sought</th><th>Amount</th><th></th></tr>";
  table.append(head);
  const body = document.createElement("tbody");
  const editingId =
    state.historyEdit && state.historyEdit.donorId === state.selectedDonorId
      ? state.historyEdit.entryId
      : null;
  history.forEach((entry) => {
    const row = document.createElement("tr");
    const isEditing = editingId === entry.id;

    const yearCell = document.createElement("td");
    const candidateCell = document.createElement("td");
    const officeCell = document.createElement("td");
    const amountCell = document.createElement("td");
    const actionsCell = document.createElement("td");
    actionsCell.className = "donor-history__actions";

    if (isEditing) {
      const yearInput = document.createElement("input");
      yearInput.type = "number";
      yearInput.className = "input";
      yearInput.placeholder = "2024";
      yearInput.value = entry.year != null ? String(entry.year) : "";
      yearInput.setAttribute("data-history-year", entry.id);
      yearCell.append(yearInput);

      const candidateInput = document.createElement("input");
      candidateInput.type = "text";
      candidateInput.className = "input";
      candidateInput.placeholder = "Candidate";
      candidateInput.value = entry.candidate || "";
      candidateInput.setAttribute("data-history-candidate", entry.id);
      candidateCell.append(candidateInput);

      const officeInput = document.createElement("input");
      officeInput.type = "text";
      officeInput.className = "input";
      officeInput.placeholder = "Office sought";
      officeInput.value = entry.officeSought || entry.office_sought || "";
      officeInput.setAttribute("data-history-office", entry.id);
      officeCell.append(officeInput);

      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.className = "input";
      amountInput.placeholder = "500";
      amountInput.min = "0";
      amountInput.step = "1";
      amountInput.value =
        entry.amount === null || entry.amount === undefined ? "" : String(entry.amount);
      amountInput.setAttribute("data-history-amount", entry.id);
      amountCell.append(amountInput);

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "btn btn--primary";
      saveButton.textContent = "Save";
      saveButton.setAttribute("data-save-history", entry.id);

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "btn btn--ghost";
      cancelButton.textContent = "Cancel";
      cancelButton.setAttribute("data-cancel-history-edit", entry.id);

      actionsCell.append(saveButton, cancelButton);
    } else {
      yearCell.textContent = entry.year || "—";
      if (entry.candidate) {
        const candidateButton = document.createElement("button");
        candidateButton.type = "button";
        candidateButton.className = "link-button";
        candidateButton.textContent = entry.candidate;
        candidateButton.setAttribute("data-view-candidate", entry.candidate);
        candidateCell.append(candidateButton);
      } else {
        candidateCell.textContent = "—";
      }
      const officeValue = entry.officeSought || entry.office_sought || "";
      officeCell.textContent = officeValue || "—";
      amountCell.textContent =
        entry.amount === null || entry.amount === undefined
          ? "—"
          : `$${formatCurrency(entry.amount)}`;

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "btn btn--ghost";
      editButton.textContent = "Edit";
      editButton.setAttribute("data-edit-history", entry.id);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn--ghost";
      removeButton.textContent = "Remove";
      removeButton.setAttribute("data-remove-history", entry.id);

      actionsCell.append(editButton, removeButton);
    }

    row.append(yearCell, candidateCell, officeCell, amountCell, actionsCell);
    body.append(row);
  });
  table.append(body);
  container.append(table);
}

async function addHistoryEntry(donorId, yearInput, candidateInput, officeInput, amountInput) {
  const yearValue = parseInt(yearInput.value, 10);
  const candidate = candidateInput.value.trim();
  const office = officeInput ? officeInput.value.trim() : "";
  const amountValue = parseNumber(amountInput.value);
  if (Number.isNaN(yearValue) || !candidate || amountValue === null) {
    return;
  }
  try {
    const payload = {
      year: yearValue,
      candidate,
      officeSought: office || undefined,
      amount: amountValue,
    };
    await fetchJson(`/api/donors/${donorId}/giving`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    yearInput.value = "";
    candidateInput.value = "";
    if (officeInput) officeInput.value = "";
    amountInput.value = "";
    await refreshData({ donorId, preserveDraft: true, skipClients: true, forceDetail: true });
  } catch (error) {
    console.error("Failed to add contribution", error);
  }
}

async function updateHistoryEntry(donorId, entryId, yearInput, candidateInput, officeInput, amountInput) {
  if (!entryId) return;
  const yearValue = yearInput ? parseInt(yearInput.value, 10) : NaN;
  const candidate = candidateInput ? candidateInput.value.trim() : "";
  const office = officeInput ? officeInput.value.trim() : "";
  const amountValue = amountInput ? parseNumber(amountInput.value) : null;
  if (Number.isNaN(yearValue) || !candidate || amountValue === null) {
    return;
  }
  try {
    const payload = {
      year: yearValue,
      candidate,
      officeSought: office || undefined,
      amount: amountValue,
    };
    await fetchJson(`/api/donors/${donorId}/giving/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.historyEdit = null;
    await refreshData({ donorId, preserveDraft: true, skipClients: true, forceDetail: true });
  } catch (error) {
    console.error("Failed to update contribution", error);
  }
}

async function removeHistoryEntry(donorId, entryId) {
  if (!entryId) return;
  try {
    if (state.historyEdit && state.historyEdit.entryId === entryId) {
      state.historyEdit = null;
    }
    await fetchJson(`/api/donors/${donorId}/giving/${entryId}`, { method: "DELETE" });
    await refreshData({ donorId, preserveDraft: true, skipClients: true, forceDetail: true });
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
  console.log("Deleting donor", donorId);
  try {
    await fetchJson(`/api/donors/${donorId}`, { method: "DELETE" });
    state.donorDetails.delete(donorId);
    await refreshData({ donorId: null, preserveDraft: false });
  } catch (error) {
    console.error("Failed to delete donor", error);
    alert("Failed to delete donor: " + (error.message || "Unknown error"));
  }
}

async function refreshData({
  donorId = state.selectedDonorId,
  preserveDraft = false,
  skipClients = false,
  forceDetail = false,
} = {}) {
  try {
    const donorsPromise = fetchJson("/api/manager/donors");
    const overviewPromise = skipClients ? Promise.resolve(null) : fetchJson("/api/manager/overview");
    const [donorList, overview] = await Promise.all([donorsPromise, overviewPromise]);
    if (overview && Array.isArray(overview.clients)) {
      state.clients = overview.clients.map(normalizeClient).filter(Boolean);
    }
    const clients = Array.isArray(state.clients) ? state.clients : [];
    if (Array.isArray(donorList)) {
      const normalized = sortDonors(donorList.map((donor) => normalizeDonorSummary(donor, clients)));
      state.donors = normalized;
      state.assignments = buildAssignmentMap(state.donors);
      state.availableGivingCandidates = buildGivingCandidates(state.donors);
      renderCandidateFilter();
    }
    applyFilters();
    const isActiveDonor = Boolean(donorId && state.filtered.some((item) => item.id === donorId));
    if (isActiveDonor) {
      state.selectedDonorId = donorId;
      await ensureDonorDetail(donorId, { force: forceDetail });
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
        await ensureDonorDetail(state.selectedDonorId, { force: forceDetail });
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
    await maybeRefreshGivingInsights();
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
    const candidateCompare = (a.candidate || "").localeCompare(b.candidate || "");
    if (candidateCompare !== 0) {
      return candidateCompare;
    }
    return (a.officeSought || "").localeCompare(b.officeSought || "");
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

function openGivingInsights({ mode = "search", candidate = "" } = {}) {
  const insights = state.givingInsights;
  insights.isOpen = true;
  const normalizedMode = mode === "candidate" ? "candidate" : "search";
  insights.mode = normalizedMode;
  if (normalizedMode === "candidate") {
    const trimmed = (candidate || "").trim();
    const candidateKey = trimmed.toLowerCase();
    const shouldReset = insights.candidateKey !== candidateKey;
    insights.candidate = trimmed;
    insights.candidateKey = candidateKey;
    insights.candidateError = null;
    if (trimmed) {
      void loadCandidateInsights(trimmed, { reset: shouldReset });
    } else {
      insights.candidateReport = null;
    }
  }
  renderGivingInsights();
  if (normalizedMode === "search" && !insights.searchResults && insights.lastExecutedFilters) {
    void runGivingSearch({ filters: insights.lastExecutedFilters, preserveExisting: true });
  }
}

function closeGivingInsights() {
  if (!state.givingInsights.isOpen) return;
  state.givingInsights.isOpen = false;
  renderGivingInsights();
}

function handleGivingInsightsClick(event) {
  const dismiss = event.target.closest("[data-insights-dismiss]");
  if (dismiss) {
    event.preventDefault();
    closeGivingInsights();
    return;
  }

  const tab = event.target.closest("[data-insights-tab]");
  if (tab) {
    const mode = tab.getAttribute("data-insights-tab") === "candidate" ? "candidate" : "search";
    if (state.givingInsights.mode !== mode) {
      state.givingInsights.mode = mode;
      renderGivingInsights();
      if (mode === "candidate" && state.givingInsights.candidate) {
        void loadCandidateInsights(state.givingInsights.candidate, { preserveExisting: true });
      }
      if (mode === "search" && state.givingInsights.lastExecutedFilters) {
        void runGivingSearch({ filters: state.givingInsights.lastExecutedFilters, preserveExisting: true });
      }
    }
    return;
  }

  const candidateTrigger = event.target.closest("[data-insights-candidate]");
  if (candidateTrigger) {
    event.preventDefault();
    const candidateName = candidateTrigger.getAttribute("data-insights-candidate");
    if (candidateName) {
      openGivingInsights({ mode: "candidate", candidate: candidateName });
    }
    return;
  }

  const donorTrigger = event.target.closest("[data-select-donor]");
  if (donorTrigger) {
    event.preventDefault();
    const donorId = donorTrigger.getAttribute("data-select-donor");
    if (donorId) {
      closeGivingInsights();
      void selectDonor(donorId);
    }
  }
}

function handleGivingInsightsKeydown(event) {
  if (!state.givingInsights.isOpen) return;
  if (event.key === "Escape") {
    const panel = elements.givingInsightsPanel;
    if (panel && panel.contains(event.target)) {
      event.preventDefault();
      closeGivingInsights();
    }
  }
}

function renderGivingInsights() {
  const panel = elements.givingInsightsPanel;
  const body = elements.givingInsightsBody;
  const title = elements.givingInsightsTitle;
  const subtitle = elements.givingInsightsSubtitle;
  if (!panel || !body) return;

  const insights = state.givingInsights;
  if (!insights.isOpen) {
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("insights-open");
    return;
  }

  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("insights-open");

  const mode = insights.mode === "candidate" ? "candidate" : "search";
  if (title) {
    title.textContent = mode === "candidate" ? "Candidate giving" : "Contribution search";
  }
  if (subtitle) {
    if (mode === "candidate") {
      const candidateName = insights.candidateReport?.candidate || insights.candidate;
      subtitle.textContent = candidateName
        ? `All recorded contributions for ${candidateName}.`
        : "Select a candidate from any donor's contribution history to see their supporters by year.";
    } else {
      subtitle.textContent = "Find donors by exact amounts, ranges, or the year they contributed.";
    }
  }

  panel.querySelectorAll("[data-insights-tab]").forEach((tab) => {
    const tabMode = tab.getAttribute("data-insights-tab") === "candidate" ? "candidate" : "search";
    if (tabMode === mode) {
      tab.classList.add("insights-panel__tab--active");
      tab.setAttribute("aria-selected", "true");
    } else {
      tab.classList.remove("insights-panel__tab--active");
      tab.setAttribute("aria-selected", "false");
    }
  });

  body.innerHTML = "";
  if (mode === "candidate") {
    renderCandidateInsights(body);
  } else {
    renderSearchInsights(body);
  }
}

function renderCandidateInsights(container) {
  const insights = state.givingInsights;
  const report = insights.candidateReport;
  const candidateName = report?.candidate || insights.candidate;

  if (insights.candidateLoading && !report) {
    container.append(
      createInsightsMessage(
        candidateName ? `Loading contributions for ${candidateName}…` : "Loading candidate contributions…",
        "info",
      ),
    );
    return;
  }

  if (insights.candidateError) {
    container.append(createInsightsMessage(insights.candidateError, "error"));
    return;
  }

  if (!report || !Array.isArray(report.donors) || report.donors.length === 0) {
    const message = candidateName
      ? `No contributions recorded yet for ${candidateName}.`
      : "Select a candidate from a donor's contribution history to see everyone who has contributed.";
    container.append(createInsightsMessage(message, "muted"));
    return;
  }

  if (insights.candidateLoading) {
    container.append(createInsightsMessage("Refreshing candidate contributions…", "info"));
  }

  container.append(createInsightsSummary(report.totals));
  container.append(createYearBreakdown(report.years));
  container.append(createDonorInsightsList(report.donors, { includeCandidate: false }));
}

function renderSearchInsights(container) {
  const insights = state.givingInsights;
  container.append(createGivingSearchForm());

  if (insights.searchLoading && !insights.searchResults) {
    container.append(createInsightsMessage("Searching contributions…", "info"));
    return;
  }

  if (insights.searchError) {
    container.append(createInsightsMessage(insights.searchError, "error"));
  }

  const results = insights.searchResults;
  if (!results) {
    container.append(
      createInsightsMessage(
        "Enter an exact amount, a range, or a year and choose Search to find matching contributions.",
        "muted",
      ),
    );
    return;
  }

  if (insights.searchLoading) {
    container.append(createInsightsMessage("Refreshing search results…", "info"));
  }

  container.append(createInsightsSummary(results.totals));
  container.append(createYearBreakdown(results.years));
  container.append(createDonorInsightsList(results.donors, { includeCandidate: true }));
}

function createGivingSearchForm() {
  const { searchFilters, searchLoading } = state.givingInsights;
  const form = document.createElement("form");
  form.id = "giving-insights-search";
  form.className = "insights-search";

  const description = document.createElement("p");
  description.className = "muted insights-search__description";
  description.textContent =
    "Use an exact amount to ignore the range fields, or provide a minimum and/or maximum amount along with an optional year.";
  form.append(description);

  const grid = document.createElement("div");
  grid.className = "insights-search__grid";
  grid.append(
    createSearchField("Exact amount", "amount", searchFilters.amount, { step: "any", min: "0", placeholder: "250" }),
    createSearchField(
      "Minimum amount",
      "minAmount",
      searchFilters.amount ? "" : searchFilters.minAmount,
      { step: "any", min: "0", placeholder: "100" },
    ),
    createSearchField(
      "Maximum amount",
      "maxAmount",
      searchFilters.amount ? "" : searchFilters.maxAmount,
      { step: "any", min: "0", placeholder: "1000" },
    ),
    createSearchField("Year", "year", searchFilters.year, { inputType: "number", min: "1900", max: "2100", placeholder: "2024" }),
  );
  form.append(grid);

  const actions = document.createElement("div");
  actions.className = "insights-search__actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn--primary";
  submit.textContent = searchLoading ? "Searching…" : "Search";
  submit.disabled = Boolean(searchLoading);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn--ghost";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    state.givingInsights.searchFilters = { amount: "", minAmount: "", maxAmount: "", year: "" };
    state.givingInsights.searchResults = null;
    state.givingInsights.lastExecutedFilters = null;
    state.givingInsights.searchError = null;
    renderGivingInsights();
  });
  actions.append(submit, clear);
  form.append(actions);

  return form;
}

function createSearchField(labelText, name, value, options = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "insights-search__field";
  wrapper.setAttribute("for", `insights-${name}`);

  const label = document.createElement("span");
  label.className = "insights-search__label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.className = "input";
  input.id = `insights-${name}`;
  input.name = name;
  input.type = options.inputType || "number";
  if (options.min !== undefined) input.min = options.min;
  if (options.max !== undefined) input.max = options.max;
  if (options.step !== undefined) input.step = options.step;
  if (options.placeholder) input.placeholder = options.placeholder;
  input.value = value != null ? value : "";

  wrapper.append(label, input);
  return wrapper;
}

function createInsightsSummary(totals = {}) {
  const summary = document.createElement("dl");
  summary.className = "insights-summary";

  const items = [
    {
      label: "Total raised",
      value:
        totals && Number.isFinite(Number(totals.totalAmount))
          ? `$${formatCurrency(totals.totalAmount)}`
          : "$0",
    },
    {
      label: "Donors",
      value: `${totals?.donorCount || 0} ${pluralize(totals?.donorCount || 0, "donor")}`,
    },
    {
      label: "Entries",
      value: `${totals?.contributionCount || 0} ${pluralize(totals?.contributionCount || 0, "entry", "entries")}`,
    },
  ];

  items.forEach((item) => {
    const dt = document.createElement("dt");
    dt.textContent = item.label;
    const dd = document.createElement("dd");
    dd.textContent = item.value;
    summary.append(dt, dd);
  });

  return summary;
}

function createYearBreakdown(years = []) {
  const section = document.createElement("section");
  section.className = "insights-panel__section";
  const heading = document.createElement("h3");
  heading.textContent = "By year";
  section.append(heading);

  if (!Array.isArray(years) || !years.length) {
    section.append(createInsightsMessage("No yearly breakdown available.", "muted"));
    return section;
  }

  const table = document.createElement("table");
  table.className = "insights-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Year</th><th>Donors</th><th>Entries</th><th>Total raised</th></tr>";
  table.append(head);

  const body = document.createElement("tbody");
  years.forEach((year) => {
    const row = document.createElement("tr");
    const yearCell = document.createElement("td");
    yearCell.textContent = formatYearLabel(year.year);
    const donorsCell = document.createElement("td");
    donorsCell.textContent = `${year.donorCount || 0}`;
    const entriesCell = document.createElement("td");
    entriesCell.textContent = `${year.contributionCount || 0}`;
    const amountCell = document.createElement("td");
    amountCell.textContent =
      year.totalAmount != null ? `$${formatCurrency(year.totalAmount)}` : "$0";
    row.append(yearCell, donorsCell, entriesCell, amountCell);
    body.append(row);
  });
  table.append(body);
  section.append(table);
  return section;
}

function createDonorInsightsList(donors = [], { includeCandidate = false } = {}) {
  const section = document.createElement("section");
  section.className = "insights-panel__section";
  const heading = document.createElement("h3");
  heading.textContent = includeCandidate ? "Matching donors" : "Donor contributions";
  section.append(heading);

  if (!Array.isArray(donors) || !donors.length) {
    section.append(createInsightsMessage("No donor contributions match these filters.", "muted"));
    return section;
  }

  const list = document.createElement("div");
  list.className = "insights-donor-list";

  donors.forEach((donor) => {
    const card = document.createElement("article");
    card.className = "insights-donor";

    const header = document.createElement("header");
    header.className = "insights-donor__header";
    const title = document.createElement("div");
    title.className = "insights-donor__title";
    const name = document.createElement("h4");
    name.textContent = donor.donorName || "Unnamed donor";
    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${donor.totalAmount ? `$${formatCurrency(donor.totalAmount)}` : "$0"} total · ${
      donor.contributionCount || 0
    } ${pluralize(donor.contributionCount || 0, "entry", "entries")}`;
    title.append(name, meta);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn btn--ghost insights-donor__open";
    openButton.textContent = "Open donor";
    if (donor.donorId) {
      openButton.setAttribute("data-select-donor", donor.donorId);
    } else {
      openButton.disabled = true;
    }

    header.append(title, openButton);
    card.append(header);

    const contributions = document.createElement("ul");
    contributions.className = "insights-donor__contributions";
    donor.contributions.forEach((contribution) => {
      const item = document.createElement("li");
      item.className = "insights-donor__contribution";
      const details = document.createElement("div");
      details.className = "insights-donor__contribution-details";
      const year = document.createElement("span");
      year.className = "insights-donor__contribution-year";
      year.textContent = formatYearLabel(contribution.year);
      details.append(year);
      if (includeCandidate && contribution.candidate) {
        const candidateButton = document.createElement("button");
        candidateButton.type = "button";
        candidateButton.className = "link-button";
        candidateButton.textContent = contribution.candidate;
        candidateButton.setAttribute("data-insights-candidate", contribution.candidate);
        details.append(candidateButton);
      }
      if (contribution.officeSought) {
        const office = document.createElement("span");
        office.className = "insights-donor__contribution-office muted";
        office.textContent = contribution.officeSought;
        details.append(office);
      }

      const amount = document.createElement("span");
      amount.className = "insights-donor__contribution-amount";
      amount.textContent =
        contribution.amount != null ? `$${formatCurrency(contribution.amount)}` : "$0";
      item.append(details, amount);
      contributions.append(item);
    });

    card.append(contributions);
    list.append(card);
  });

  section.append(list);
  return section;
}

function createInsightsMessage(text, variant = "muted") {
  const paragraph = document.createElement("p");
  paragraph.className = "insights-panel__message";
  if (variant === "error") {
    paragraph.classList.add("insights-panel__message--error");
  } else if (variant === "info") {
    paragraph.classList.add("insights-panel__message--info");
  } else {
    paragraph.classList.add("muted");
  }
  paragraph.textContent = text;
  return paragraph;
}

function formatYearLabel(year) {
  if (year === null || year === undefined || Number.isNaN(Number(year))) {
    return "Unspecified";
  }
  return String(year);
}

function pluralize(value, singular, plural) {
  const number = Number(value) || 0;
  if (number === 1) return singular;
  return plural || `${singular}s`;
}

function parseSearchAmountValue(value) {
  if (value === null || value === undefined) {
    return { text: "", value: null };
  }
  const cleaned = String(value).replace(/[^0-9.+-]/g, "").trim();
  if (!cleaned) {
    return { text: "", value: null };
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { text: "", value: null };
  }
  return { text: String(numeric), value: numeric };
}

function parseSearchYearValue(value) {
  if (value === null || value === undefined) {
    return { text: "", value: null };
  }
  const cleaned = String(value).replace(/[^0-9]/g, "").trim();
  if (!cleaned) {
    return { text: "", value: null };
  }
  const numeric = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { text: "", value: null };
  }
  return { text: String(numeric), value: numeric };
}

function normalizeSearchFilters(filters = {}) {
  const amount = Number.isFinite(filters.amount) && filters.amount >= 0 ? Number(filters.amount) : null;
  let minAmount = Number.isFinite(filters.minAmount) && filters.minAmount >= 0 ? Number(filters.minAmount) : null;
  let maxAmount = Number.isFinite(filters.maxAmount) && filters.maxAmount >= 0 ? Number(filters.maxAmount) : null;
  const year = Number.isFinite(filters.year) && filters.year > 0 ? Math.trunc(filters.year) : null;

  if (amount !== null) {
    minAmount = null;
    maxAmount = null;
  }

  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    const temp = minAmount;
    minAmount = maxAmount;
    maxAmount = temp;
  }

  return { amount, minAmount, maxAmount, year };
}

async function loadCandidateInsights(candidate, { reset = false, preserveExisting = false } = {}) {
  const insights = state.givingInsights;
  const trimmed = (candidate || "").trim();
  if (!trimmed) {
    insights.candidate = "";
    insights.candidateKey = "";
    insights.candidateReport = null;
    insights.candidateError = "Select a candidate from a donor record to view their contributions.";
    insights.candidateLoading = false;
    renderGivingInsights();
    return;
  }

  const candidateKey = trimmed.toLowerCase();
  insights.candidate = trimmed;
  insights.candidateKey = candidateKey;
  insights.candidateError = null;
  insights.candidateLoading = true;
  if (reset) {
    insights.candidateReport = null;
  }
  renderGivingInsights();

  try {
    const encoded = encodeURIComponent(trimmed);
    const result = await fetchJson(`/api/giving/candidates/${encoded}/summary`);
    if (!result) {
      insights.candidateReport = null;
    } else {
      insights.candidateReport = {
        candidate: result.candidate || trimmed,
        totals: result.totals || { totalAmount: 0, donorCount: 0, contributionCount: 0 },
        years: Array.isArray(result.years) ? result.years : [],
        donors: Array.isArray(result.donors) ? result.donors : [],
      };
      insights.candidate = insights.candidateReport.candidate || trimmed;
      insights.candidateKey = insights.candidate.toLowerCase();
    }
  } catch (error) {
    console.error("Failed to load candidate insights", error);
    if (!preserveExisting) {
      insights.candidateReport = null;
    }
    insights.candidateError = "Unable to load contributions for this candidate right now.";
  } finally {
    insights.candidateLoading = false;
    renderGivingInsights();
  }
}

async function runGivingSearch({ filters, preserveExisting = false } = {}) {
  const insights = state.givingInsights;
  const normalized = normalizeSearchFilters(filters || getSearchFiltersFromState());

  if (
    normalized.amount === null &&
    normalized.minAmount === null &&
    normalized.maxAmount === null &&
    normalized.year === null
  ) {
    return;
  }

  insights.searchLoading = true;
  insights.searchError = null;
  if (!preserveExisting) {
    insights.searchResults = null;
  }
  renderGivingInsights();

  try {
    const params = new URLSearchParams();
    if (normalized.year !== null) {
      params.set("year", String(normalized.year));
    }
    if (normalized.amount !== null) {
      params.set("amount", String(normalized.amount));
    } else {
      if (normalized.minAmount !== null) {
        params.set("minAmount", String(normalized.minAmount));
      }
      if (normalized.maxAmount !== null) {
        params.set("maxAmount", String(normalized.maxAmount));
      }
    }
    const query = params.toString();
    const url = query ? `/api/giving/search?${query}` : "/api/giving/search";
    const response = await fetchJson(url);
    if (response) {
      insights.searchResults = {
        totals: response.totals || { totalAmount: 0, donorCount: 0, contributionCount: 0 },
        years: Array.isArray(response.years) ? response.years : [],
        donors: Array.isArray(response.donors) ? response.donors : [],
        filters: response.filters || {},
      };
      insights.lastExecutedFilters = {
        amount: normalized.amount,
        minAmount: normalized.amount !== null ? null : normalized.minAmount,
        maxAmount: normalized.amount !== null ? null : normalized.maxAmount,
        year: normalized.year,
      };
    } else {
      insights.searchResults = null;
    }
  } catch (error) {
    console.error("Failed to search contributions", error);
    insights.searchError = "Unable to run the contribution search right now.";
  } finally {
    insights.searchLoading = false;
    renderGivingInsights();
  }
}

function getSearchFiltersFromState() {
  const { amount, minAmount, maxAmount, year } = state.givingInsights.searchFilters;
  const exact = parseSearchAmountValue(amount);
  const min = parseSearchAmountValue(minAmount);
  const max = parseSearchAmountValue(maxAmount);
  const yearValue = parseSearchYearValue(year);

  const filters = {
    amount: exact.value,
    minAmount: exact.value !== null ? null : min.value,
    maxAmount: exact.value !== null ? null : max.value,
    year: yearValue.value,
  };

  return normalizeSearchFilters(filters);
}

function handleGivingSearchSubmit(form) {
  const data = new FormData(form);
  const amount = parseSearchAmountValue(data.get("amount"));
  const minAmount = parseSearchAmountValue(data.get("minAmount"));
  const maxAmount = parseSearchAmountValue(data.get("maxAmount"));
  const year = parseSearchYearValue(data.get("year"));

  state.givingInsights.searchFilters = {
    amount: amount.text,
    minAmount: amount.value !== null ? "" : minAmount.text,
    maxAmount: amount.value !== null ? "" : maxAmount.text,
    year: year.text,
  };

  state.givingInsights.searchError = null;

  const filters = normalizeSearchFilters({
    amount: amount.value,
    minAmount: amount.value !== null ? null : minAmount.value,
    maxAmount: amount.value !== null ? null : maxAmount.value,
    year: year.value,
  });

  if (filters.amount === null && filters.minAmount === null && filters.maxAmount === null && filters.year === null) {
    state.givingInsights.searchResults = null;
    state.givingInsights.lastExecutedFilters = null;
    state.givingInsights.searchError = "Enter an amount or year to search.";
    renderGivingInsights();
    return;
  }

  void runGivingSearch({ filters });
}

async function maybeRefreshGivingInsights() {
  const insights = state.givingInsights;
  if (!insights.isOpen) return;
  if (insights.mode === "candidate" && insights.candidate) {
    await loadCandidateInsights(insights.candidate, { preserveExisting: true });
    return;
  }
  if (insights.mode === "search" && insights.lastExecutedFilters) {
    await runGivingSearch({ filters: insights.lastExecutedFilters, preserveExisting: true });
  }
}
