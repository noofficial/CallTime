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
        return { clients: [], donors: {} };
      }
      const parsed = JSON.parse(raw);
      return {
        clients: Array.isArray(parsed.clients) ? parsed.clients : [],
        donors: typeof parsed.donors === "object" && parsed.donors !== null ? parsed.donors : {},
      };
    } catch (error) {
      console.error("Failed to parse database", error);
      return { clients: [], donors: {} };
    }
  }

  persist() {
    this.storage.setItem(DATABASE_KEY, JSON.stringify(this.data));
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
    if (!this.data.donors[record.id]) {
      this.data.donors[record.id] = [];
    }
    this.persist();
    return this.getClient(record.id);
  }

  removeClient(clientId) {
    this.data.clients = this.data.clients.filter((client) => client.id !== clientId);
    if (this.data.donors[clientId]) {
      delete this.data.donors[clientId];
    }
    this.persist();
  }

  getDonors(clientId) {
    const donors = this.data.donors[clientId] || [];
    return donors.map((donor) => this.cloneDonor(donor));
  }

  replaceDonors(clientId, donors) {
    this.ensureClientDonorArray(clientId);
    this.data.donors[clientId] = donors.map((donor) => this.normalizeDonor(donor));
    this.persist();
    return this.getDonors(clientId);
  }

  createDonor(clientId, initial = {}) {
    this.ensureClientDonorArray(clientId);
    const donor = this.normalizeDonor({ ...initial, id: initial.id || this.createDonorId(initial) });
    this.data.donors[clientId].push(donor);
    this.persist();
    return this.cloneDonor(donor);
  }

  updateDonor(clientId, donorId, updates) {
    this.ensureClientDonorArray(clientId);
    const donors = this.data.donors[clientId];
    const index = donors.findIndex((donor) => donor.id === donorId);
    if (index === -1) {
      throw new Error("Donor not found");
    }
    donors[index] = this.normalizeDonor({ ...donors[index], ...updates, id: donorId });
    this.persist();
    return this.cloneDonor(donors[index]);
  }

  deleteDonor(clientId, donorId) {
    this.ensureClientDonorArray(clientId);
    this.data.donors[clientId] = this.data.donors[clientId].filter((donor) => donor.id !== donorId);
    this.persist();
  }

  addContribution(clientId, donorId, entry) {
    this.ensureClientDonorArray(clientId);
    const donors = this.data.donors[clientId];
    const donor = donors.find((item) => item.id === donorId);
    if (!donor) {
      throw new Error("Donor not found");
    }
    const contribution = this.normalizeContribution({ ...entry, id: entry.id || this.createContributionId(entry) });
    donor.history.push(contribution);
    donor.history.sort((a, b) => {
      if (a.year === b.year) {
        return a.candidate.localeCompare(b.candidate);
      }
      return b.year - a.year;
    });
    this.persist();
    return contribution;
  }

  removeContribution(clientId, donorId, contributionId) {
    this.ensureClientDonorArray(clientId);
    const donors = this.data.donors[clientId];
    const donor = donors.find((item) => item.id === donorId);
    if (!donor) {
      throw new Error("Donor not found");
    }
    donor.history = donor.history.filter((item) => item.id !== contributionId);
    this.persist();
  }

  ensureClientDonorArray(clientId) {
    if (!this.data.donors[clientId]) {
      this.data.donors[clientId] = [];
    }
  }

  createDonorId(initial = {}) {
    const base = [initial.firstName, initial.lastName, initial.email]
      .filter(Boolean)
      .join("-");
    return CallTimeDatabase.createId(base || `donor-${Date.now()}`);
  }

  createContributionId(entry = {}) {
    const base = [entry.year, entry.candidate, entry.amount]
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
      email: (source.email || source.Email || "").trim(),
      biography: biography.trim(),
      pictureUrl: pictureUrl.trim(),
      donorNotes: (source.donorNotes || source.notes || source.Notes || "").trim(),
      ask,
      city: (source.city || source.City || source["Mailing City"] || "").trim(),
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
    if (!candidate && Number.isNaN(yearValue) && (amount === null || Number.isNaN(amount))) {
      return null;
    }
    const year = Number.isNaN(yearValue) ? new Date().getFullYear() : yearValue;
    return {
      id: source.id || this.createContributionId({ year, candidate, amount }),
      year,
      candidate,
      amount,
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
