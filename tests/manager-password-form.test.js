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

test("manager client form sends portal password payload", async () => {
  const managerHtml = `<!DOCTYPE html>
  <body>
    <div id="manager-login-screen"></div>
    <form id="manager-login-form"></form>
    <input id="manager-login-password" />
    <div id="manager-login-status"></div>
    <div id="manager-clients"></div>
    <select id="client-selector"></select>
    <button id="edit-client"></button>
    <div id="manager-donors"></div>
    <input id="manager-donor-search" />
    <select id="assignment-client"></select>
    <div id="assignment-unassigned"></div>
    <div id="assignment-assigned"></div>
    <span id="assignment-available-label"></span>
    <span id="assignment-assigned-label"></span>
    <button id="create-client"></button>
    <div id="client-modal"></div>
    <h2 id="client-modal-title"></h2>
    <p id="client-modal-description"></p>
    <form id="client-create-form">
      <input id="client-form-name" />
      <input id="client-form-candidate" />
      <input id="client-form-office" />
      <input id="client-form-manager" />
      <input id="client-form-email" />
      <input id="client-form-phone" />
      <input id="client-form-launch" />
      <input id="client-form-goal" />
      <textarea id="client-form-notes"></textarea>
      <input id="client-form-password" />
      <input id="client-form-require-password-reset" type="checkbox" />
      <button id="client-form-submit" type="submit"></button>
      <button id="client-form-cancel" type="button"></button>
    </form>
    <span id="client-form-status"></span>
    <button id="client-reset-password"></button>
    <button id="manager-logout"></button>
    <form id="bulk-upload-form"></form>
    <select id="bulk-upload-client"></select>
    <div id="bulk-upload-dropzone" tabindex="0"></div>
    <input id="bulk-upload-input" />
    <span id="bulk-upload-filename"></span>
    <div id="bulk-upload-status"></div>
    <button id="bulk-upload-submit"></button>
    <button id="bulk-upload-clear"></button>
  </body>`;

  const dom = new JSDOM(managerHtml, { url: "http://localhost" });
  const { window } = dom;

  const localStorage = createStorage();
  const sessionStorage = createStorage();

  const previousGlobals = new Map();
  const assignments = {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    localStorage,
    sessionStorage,
    alert: () => {},
  };

  for (const [key, value] of Object.entries(assignments)) {
    previousGlobals.set(key, global[key]);
    global[key] = value;
  }

  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: sessionStorage });

  const requests = [];
  const fetchStub = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).startsWith("/api/clients")) {
      return { ok: true, status: 200, json: async () => ({ id: 501 }) };
    }
    if (String(url).includes("/api/manager/overview")) {
      return { ok: true, status: 200, json: async () => ({ clients: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  previousGlobals.set("fetch", global.fetch);
  global.fetch = fetchStub;
  window.fetch = fetchStub;

  try {
    const moduleUrl = new URL("../public/manager.js", import.meta.url);
    moduleUrl.searchParams.set("test", Date.now().toString());
    const managerModule = await import(moduleUrl.href);
    const { elements, state, handleClientFormSubmit } = managerModule.__TESTING__;

    localStorage.setItem("calltime.managerToken", "test-token");
    elements.clientForm.reportValidity = () => true;
    elements.clientFormName.value = "Portal Client";
    elements.clientFormPassword.value = "SecretPass9";
    elements.clientFormRequirePasswordReset.checked = true;
    state.clientFormMode = "create";

    await handleClientFormSubmit();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const clientRequest = requests.find((entry) => String(entry.url).startsWith("/api/clients"));
    assert.ok(clientRequest, "expected client creation request");
    const payload = JSON.parse(clientRequest.options.body);
    assert.equal(payload.portalPassword, "SecretPass9");
    assert.equal(payload.requirePasswordReset, true);
  } finally {
    dom.window.close();
    for (const [key, value] of previousGlobals.entries()) {
      if (value === undefined) {
        delete global[key];
      } else {
        global[key] = value;
      }
    }
  }
});
