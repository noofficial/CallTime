export const DATABASE_KEY = "calltime:database:v1";

export class CallTimeDatabase {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this.data = this.load();
  }

  load() {
    try {
      const raw = this.storage.getItem(DATABASE_KEY);
      if (!raw) {
        return { clients: [], donors: [], clientDonors: {} };
      }
      const parsed = JSON.parse(raw);
      const clients = Array.isArray(parsed.clients) ? parsed.clients : [];
      const clientDonors =
        typeof parsed.clientDonors === "object" && parsed.clientDonors !== null ? { ...parsed.clientDonors } : {};

      if (Array.isArray(parsed.donors)) {
        return {
          clients,
          donors: parsed.donors.map((donor) => this.normalizeDonor(donor)),
          clientDonors: this.normalizeClientDonorMap(clientDonors),
        };
      }

      if (parsed.donors && typeof parsed.donors === "object") {
        return this.migrateLegacyDonorShape(clients, parsed.donors);
      }

      return { clients, donors: [], clientDonors: this.normalizeClientDonorMap(clientDonors) };
    } catch (error) {
      console.error("Failed to parse database", error);
      return { clients: [], donors: [], clientDonors: {} };
    }
  }

  normalizeClientDonorMap(map = {}) {
    const result = {};
    Object.keys(map).forEach((clientId) => {
      const list = Array.isArray(map[clientId]) ? map[clientId] : [];
      result[clientId] = Array.from(new Set(list.filter((value) => typeof value === "string")));
    });
    return result;
  }

  migrateLegacyDonorShape(clients, legacyDonors) {
    const donorMap = new Map();
    const clientDonors = {};
    Object.entries(legacyDonors || {}).forEach(([clientId, donorList]) => {
      const normalizedList = Array.isArray(donorList) ? donorList : [];
      clientDonors[clientId] = [];
      normalizedList.forEach((raw) => {
        const donor = this.normalizeDonor(raw);
        const existing = donorMap.get(donor.id);
        if (existing) {
          donorMap.set(donor.id, this.mergeDonor(existing, donor));
        } else {
          donorMap.set(donor.id, donor);
        }
        clientDonors[clientId].push(donor.id);
      });
      clientDonors[clientId] = Array.from(new Set(clientDonors[clientId]));
    });
    return {
      clients,
      donors: Array.from(donorMap.values()),
      clientDonors,
    };
  }

  mergeDonor(existing, incoming) {
    const merged = { ...existing };
    Object.keys(incoming).forEach((key) => {
      if (incoming[key] === undefined || incoming[key] === null || incoming[key] === "") return;
      if (key === "history" && Array.isArray(incoming.history)) {
        const historyMap = new Map();
        (Array.isArray(existing.history) ? existing.history : []).forEach((entry) => {
          historyMap.set(entry.id, { ...entry });
        });
        incoming.history.forEach((entry) => {
          historyMap.set(entry.id, { ...entry });
        });
        merged.history = Array.from(historyMap.values()).sort((a, b) => {
          if ((a.year || 0) === (b.year || 0)) {
            return (a.candidate || "").localeCompare(b.candidate || "");
          }
          return (b.year || 0) - (a.year || 0);
        });
      } else {
        merged[key] = incoming[key];
      }
    });
    return merged;
  }

  persist() {
    this.storage.setItem(
      DATABASE_KEY,
      JSON.stringify({
        clients: this.data.clients,
        donors: this.data.donors,
        clientDonors: this.data.clientDonors,
      }),
    );
  }

  reload() {
    this.data = this.load();
    return this.getClients();
  }

  getClients() {
    return this.data.clients.map((client) => ({ ...client }));
  }

  getClient(clientId) {
    return this.data.clients.find((client) => client.id === clientId) || null;
  }

  upsertClient(record) {
    if (!record || !record.id) {
      throw new Error("Client records must include an id");
    }
    const index = this.data.clients.findIndex((client) => client.id === record.id);
    if (index === -1) {
      this.data.clients.push({ ...record });
    } else {
      this.data.clients[index] = { ...this.data.clients[index], ...record };
    }
    this.ensureClientDonorArray(record.id);
    this.persist();
    return this.getClient(record.id);
  }

  removeClient(clientId) {
    this.data.clients = this.data.clients.filter((client) => client.id !== clientId);
    if (this.data.clientDonors[clientId]) {
      delete this.data.clientDonors[clientId];
    }
    this.persist();
  }

  getDonors(clientId) {
    if (!clientId) {
      return this.getAllDonors();
    }
    const donorIds = this.data.clientDonors[clientId] || [];
    const donors = donorIds
      .map((id) => this.data.donors.find((donor) => donor.id === id))
      .filter(Boolean)
      .map((donor) => this.cloneDonor(donor));
    return donors;
  }

  getAllDonors() {
    return this.data.donors.map((donor) => this.cloneDonor(donor));
  }

  getClientDonorIds(clientId) {
    return Array.from(new Set(this.data.clientDonors[clientId] || []));
  }

  getClientsForDonor(donorId) {
    return Object.entries(this.data.clientDonors)
      .filter(([, donors]) => Array.isArray(donors) && donors.includes(donorId))
      .map(([id]) => id);
  }

  getAssignments() {
    return JSON.parse(JSON.stringify(this.data.clientDonors));
  }

  replaceDonors(clientId, donors) {
    if (!clientId) {
      throw new Error("Client id is required to replace donors");
    }
    const normalized = donors.map((donor) => this.normalizeDonor(donor));
    const donorIds = [];
    normalized.forEach((donor) => {
      donorIds.push(donor.id);
      this.upsertDonorRecord(donor);
    });
    this.setClientDonorIds(clientId, donorIds);
    this.persist();
    return this.getDonors(clientId);
  }

  createDonor(initial = {}, clientIds = []) {
    const donor = this.normalizeDonor({ ...initial, id: initial.id || this.createDonorId(initial) });
    this.upsertDonorRecord(donor);
    this.setDonorClients(donor.id, clientIds);
    this.persist();
    return this.cloneDonor(donor);
  }

  updateDonor(donorId, updates = {}) {
    const index = this.data.donors.findIndex((donor) => donor.id === donorId);
    if (index === -1) {
      throw new Error("Donor not found");
    }
    const updated = this.normalizeDonor({ ...this.data.donors[index], ...updates, id: donorId });
    this.data.donors[index] = updated;
    this.persist();
    return this.cloneDonor(updated);
  }

  deleteDonor(donorId) {
    this.data.donors = this.data.donors.filter((donor) => donor.id !== donorId);
    Object.keys(this.data.clientDonors).forEach((clientId) => {
      this.data.clientDonors[clientId] = (this.data.clientDonors[clientId] || []).filter((id) => id !== donorId);
    });
    this.persist();
  }

  addContribution(donorId, entry) {
    const donor = this.data.donors.find((item) => item.id === donorId);
    if (!donor) {
      throw new Error("Donor not found");
    }
    if (!Array.isArray(donor.history)) {
      donor.history = [];
    }
    const contribution = this.normalizeContribution({ ...entry, id: entry.id || this.createContributionId(entry) });
    donor.history.push(contribution);
    donor.history.sort((a, b) => {
      if (a.year === b.year) {
        const candidateCompare = (a.candidate || "").localeCompare(b.candidate || "");
        if (candidateCompare !== 0) {
          return candidateCompare;
        }
        return (a.officeSought || "").localeCompare(b.officeSought || "");
      }
      return (b.year || 0) - (a.year || 0);
    });
    this.persist();
    return contribution;
  }

  removeContribution(donorId, contributionId) {
    const donor = this.data.donors.find((item) => item.id === donorId);
    if (!donor) {
      throw new Error("Donor not found");
    }
    donor.history = (donor.history || []).filter((item) => item.id !== contributionId);
    this.persist();
  }

  setClientDonorIds(clientId, donorIds = []) {
    if (!clientId) return;
    this.ensureClientDonorArray(clientId);
    const unique = Array.from(new Set(donorIds.filter((id) => typeof id === "string")));
    this.data.clientDonors[clientId] = unique;
    this.persist();
  }

  setDonorClients(donorId, clientIds = []) {
    const valid = new Set(
      clientIds
        .filter((id) => typeof id === "string")
        .filter((id) => this.data.clients.some((client) => client.id === id)),
    );
    this.data.clients.forEach((client) => {
      const assignments = this.data.clientDonors[client.id] || [];
      const hasDonor = assignments.includes(donorId);
      if (valid.has(client.id)) {
        this.ensureClientDonorArray(client.id);
        if (!hasDonor) {
          this.data.clientDonors[client.id].push(donorId);
        }
      } else if (hasDonor) {
        this.data.clientDonors[client.id] = assignments.filter((id) => id !== donorId);
      }
    });
    this.persist();
  }

  upsertDonorRecord(donor) {
    const index = this.data.donors.findIndex((item) => item.id === donor.id);
    if (index === -1) {
      this.data.donors.push(donor);
    } else {
      this.data.donors[index] = this.mergeDonor(this.data.donors[index], donor);
    }
  }

  ensureClientDonorArray(clientId) {
    if (!clientId) return;
    if (!this.data.clientDonors[clientId]) {
      this.data.clientDonors[clientId] = [];
    }
  }

  createDonorId(initial = {}) {
    const base = [initial.firstName, initial.lastName, initial.email]
      .filter(Boolean)
      .join("-");
    return CallTimeDatabase.createId(base || `donor-${Date.now()}`);
  }

  createContributionId(entry = {}) {
    const base = [entry.year, entry.candidate, entry.officeSought, entry.amount]
      .filter(Boolean)
      .join("-");
    return CallTimeDatabase.createId(base || `contribution-${Date.now()}`);
  }

  normalizeDonor(raw) {
    const source = typeof raw === "object" && raw !== null ? raw : {};
    const firstName = source.firstName || source.FirstName || source["First Name"] || "";
    const lastName = source.lastName || source.LastName || source["Last Name"] || "";
    const company = source.company || source.Company || source.employer || source.Employer || "";
    const industry = source.industry || source.Industry || source.Sector || "";
    const biography = source.biography || source.Biography || source.bio || source.Bio || "";
    const pictureUrl = source.pictureUrl || source.photo || source.Picture || source.Photo || "";
    const ask = this.parseNumber(source.ask ?? source.Ask ?? source["Ask Amount"]);
    const history = Array.isArray(source.history)
      ? source.history.map((item) => this.normalizeContribution(item)).filter(Boolean)
      : [];
    history.sort((a, b) => {
      if (a.year === b.year) {
        return a.candidate.localeCompare(b.candidate);
      }
      return (b.year || 0) - (a.year || 0);
    });

    const donor = {
      id: source.id || this.createDonorId(source),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      company: company.trim(),
      industry: industry.trim(),
      phone: (source.phone || source.Phone || "").trim(),
      alternatePhone:
        (
          source.alternatePhone ||
          source.alternate_phone ||
          source.phone2 ||
          source.secondaryPhone ||
          source.secondary_phone ||
          ""
        ).trim(),
      email: (source.email || source.Email || "").trim(),
      biography: biography.trim(),
      pictureUrl: pictureUrl.trim(),
      donorNotes: (source.donorNotes || source.notes || source.Notes || "").trim(),
      ask,
      street: (
        source.street ||
        source.Street ||
        source.address ||
        source.Address ||
        source["Mailing Street"] ||
        source["Address 1"] ||
        ""
      ).trim(),
      addressLine2: (
        source.addressLine2 ||
        source.AddressLine2 ||
        source.address2 ||
        source.Address2 ||
        source["Mailing Address Line 2"] ||
        ""
      ).trim(),
      city: (source.city || source.City || source["Mailing City"] || "").trim(),
      state: (source.state || source.State || source["Mailing State"] || "").trim(),
      postalCode: (
        source.postalCode ||
        source.PostalCode ||
        source.zip ||
        source.Zip ||
        source["ZIP"] ||
        source["Zip Code"] ||
        source["Postal Code"] ||
        ""
      ).trim(),
      tags: (source.tags || source.Tags || source.Priority || "").trim(),
      lastGift: (source.lastGift || source["Last Gift"] || source["Giving History"] || "").trim(),
      history,
    };

    donor.name = this.buildDisplayName(donor, source.name || source.Name || source["Full Name"]);
    donor.employer = donor.company;
    donor.notes = donor.donorNotes;
    return donor;
  }

  normalizeContribution(raw) {
    if (!raw) return null;
    const source = typeof raw === "object" ? raw : {};
    const yearValue = Number(source.year ?? source.Year ?? source["Election Year"]);
    const candidate = (source.candidate || source.Candidate || "").trim();
    const amount = this.parseNumber(source.amount ?? source.Amount ?? source["Contribution"]);
    const office =
      (source.office ||
        source.Office ||
        source.officeSought ||
        source.office_sought ||
        source["Office Sought"] ||
        "")
        .toString()
        .trim();
    if (!candidate && Number.isNaN(yearValue) && (amount === null || Number.isNaN(amount))) {
      return null;
    }
    const year = Number.isNaN(yearValue) ? new Date().getFullYear() : yearValue;
    return {
      id: source.id || this.createContributionId({ year, candidate, amount }),
      year,
      candidate,
      amount,
      officeSought: office,
    };
  }

  parseNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(String(value).replace(/[^0-9.]/g, ""));
    return Number.isNaN(numeric) ? null : numeric;
  }

  buildDisplayName(donor, fallback) {
    const base = `${donor.firstName} ${donor.lastName}`.trim();
    const fromFallback = fallback ? String(fallback).trim() : "";
    return base || fromFallback || donor.email || "New Donor";
  }

  cloneDonor(donor) {
    return JSON.parse(JSON.stringify(donor));
  }

  static createId(value = "") {
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
}
