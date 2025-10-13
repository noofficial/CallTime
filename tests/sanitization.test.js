import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function installDom(html) {
  const dom = new JSDOM(html, { url: "http://localhost" });
  const { window } = dom;
  window.__CALLTIME_TESTING__ = true;
  const storage = createStorage();
  const sessionStorage = createStorage();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: sessionStorage,
  });
  const previous = new Map();
  const assignments = {
    window,
    document: window.document,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    localStorage: storage,
    sessionStorage,
    fetch: async () => ({ ok: true, json: async () => [] }),
    alert: () => {},
  };
  Object.entries(assignments).forEach(([key, value]) => {
    previous.set(key, global[key]);
    global[key] = value;
  });
  window.fetch = global.fetch;
  window.alert = global.alert;

  return {
    dom,
    restore: () => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete global[key];
        } else {
          global[key] = value;
        }
      }
      dom.window.close();
    },
  };
}

const clientHtml = `<!DOCTYPE html>
<body>
  <div id="client-title"></div>
  <select id="client-selector"></select>
  <select id="queue-filter"></select>
  <button id="start-session"></button>
  <div id="call-queue"></div>
  <div id="client-stats"></div>
  <div id="donor-card" class="hidden"></div>
  <h2 id="donor-name"></h2>
  <div id="donor-info"></div>
  <div id="call-history"></div>
  <button id="close-donor"></button>
  <select id="call-status"></select>
  <input id="ask-amount" />
  <input id="committed-amount" />
  <textarea id="call-notes"></textarea>
  <input id="followup-date" />
  <button id="save-outcome"></button>
  <div id="outcome-status"></div>
  <button id="client-logout"></button>
  <div id="client-login-screen"></div>
  <form id="client-login-form"></form>
  <select id="client-login-selector"></select>
  <input id="client-login-password" />
  <div id="client-login-status"></div>
  <div id="client-password-reset-screen"></div>
  <form id="client-password-reset-form"></form>
  <input id="client-new-password" />
  <input id="client-confirm-password" />
  <div id="client-password-reset-status"></div>
  <button id="client-password-reset-cancel"></button>
  <div id="client-password-reset-description"></div>
</body>`;

const managerHtml = `<!DOCTYPE html>
<body>
  <div id="manager-donors"></div>
</body>`;

test("client renders donor markup without executing scripts", async () => {
  const { dom, restore } = installDom(clientHtml);
  try {
    const moduleUrl = new URL("../public/client.js", import.meta.url);
    moduleUrl.searchParams.set("test", Date.now().toString());
    const clientModule = await import(moduleUrl.href);
    const { state, renderQueue, renderDonorDetails } = clientModule.__TESTING__;

    state.filteredDonors = [
      {
        id: 1,
        name: "<script>alert(1)</script>",
        phone: "<script>phone()</script>",
        capacity: 2500,
        last_call_status: "Not Contacted",
      },
    ];

    renderQueue();

    const queue = dom.window.document.getElementById("call-queue");
    assert.equal(queue.querySelector("script"), null);
    assert.ok(queue.textContent.includes("<script>alert(1)</script>"));

    const detailsPayload = {
      id: 1,
      name: "<script>detail()</script>",
      phone: "<script>detail-phone()</script>",
      email: "danger@example.com",
      company: "<script>company()</script>",
      job_title: "<script>title()</script>",
      street_address: "123 <script>Street</script>",
      address_line2: "Suite <script>2</script>",
      city: "<script>City</script>",
      state: "<script>State</script>",
      postal_code: "<script>00000</script>",
      industry: "<script>Industry</script>",
      capacity: 4000,
      last_gift: "<script>Gift</script>",
      tags: ["<script>tag</script>"],
      research: [
        {
          research_category: "<script>Research</script>",
          research_content: "<script>Content</script>",
          updated_at: "2024-05-01",
        },
      ],
      notes: [
        {
          note_type: "<script>Note</script>",
          note_content: "<script>Body</script>",
          created_at: "2024-05-02",
        },
      ],
      callHistory: [
        {
          status: "<script>Status</script>",
          call_date: "2024-05-03",
          outcome_notes: "<script>History</script>",
          pledge_amount: 123,
          contribution_amount: 321,
          follow_up_date: "2024-05-10",
        },
      ],
    };

    renderDonorDetails(detailsPayload);

    const donorInfo = dom.window.document.getElementById("donor-info");
    assert.equal(donorInfo.querySelector("script"), null);
    const donorName = dom.window.document.getElementById("donor-name");
    assert.ok(donorName.textContent.includes("<script>detail()</script>"));
    assert.ok(donorInfo.textContent.includes("<script>company()</script>"));

    const callHistory = dom.window.document.getElementById("call-history");
    assert.equal(callHistory.querySelector("script"), null);
    assert.ok(callHistory.textContent.includes("<script>History</script>"));
  } finally {
    restore();
  }
});

test("manager donor list escapes script content", async () => {
  const { dom, restore } = installDom(managerHtml);
  try {
    const moduleUrl = new URL("../public/manager.js", import.meta.url);
    moduleUrl.searchParams.set("test", Date.now().toString());
    const managerModule = await import(moduleUrl.href);
    const { state, renderDonors } = managerModule.__TESTING__;

    state.filteredDonors = [
      {
        id: 42,
        name: "<script>alert(2)</script>",
        company: "<script>Employer</script>",
        street_address: "<script>Street</script>",
        city: "<script>Town</script>",
        state: "<script>Region</script>",
        postal_code: "<script>Zip</script>",
        capacity: 5000,
        assigned_clients: "<script>Client</script>",
        tags: ["<script>tag</script>", "Alpha"],
      },
    ];

    renderDonors();

    const donorList = dom.window.document.getElementById("manager-donors");
    assert.equal(donorList.querySelector("script"), null);
    assert.ok(donorList.textContent.includes("<script>alert(2)</script>"));
  } finally {
    restore();
  }
});
