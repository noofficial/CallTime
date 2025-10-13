const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const ensureIntegrationDatabase = require('../helpers/integration-db');

ensureIntegrationDatabase();
const { app, db } = require('../../server/index.js');

async function createServer() {
  const server = app.listen(0);
  await once(server, 'listening');
  return server;
}

async function getManagerToken(baseUrl, password = 'test-manager-password') {
  const response = await fetch(`${baseUrl}/api/auth/manager-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(response.status, 200, 'manager login should succeed');
  const data = await response.json();
  assert.ok(data.token, 'login response should include token');
  return data.token;
}

test('exclusive donors are assigned to the locked client', { concurrency: false }, async (t) => {
  db.exec(`
    UPDATE donors SET exclusive_donor = 0, exclusive_client_id = NULL WHERE id = 102;
    DELETE FROM donor_assignments WHERE donor_id = 102;
  `);

  const server = await createServer();
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getManagerToken(baseUrl);
  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(`${baseUrl}/api/donors/102`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ exclusiveDonor: true, exclusiveClientId: 1 }),
  });
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.exclusive_donor, 1);
  assert.equal(detail.exclusive_client_id, 1);
  assert.equal(detail.assigned_client_ids, '1');

  const assignments = db
    .prepare('SELECT client_id, is_active FROM donor_assignments WHERE donor_id = ? ORDER BY client_id')
    .all(102)
    .map(({ client_id, is_active }) => ({ client_id, is_active }));
  assert.deepEqual(assignments, [{ client_id: 1, is_active: 1 }]);
});

test('exclusive donors can move to a new client while deactivating others', { concurrency: false }, async (t) => {
  db.exec(`
    UPDATE donors SET exclusive_donor = 0, exclusive_client_id = NULL WHERE id = 101;
    UPDATE donor_assignments SET is_active = 1 WHERE donor_id = 101 AND client_id = 1;
    DELETE FROM donor_assignments WHERE donor_id = 101 AND client_id != 1;
  `);
  db.prepare(
    'INSERT OR IGNORE INTO clients (id, name, candidate, portal_password, portal_password_needs_reset) VALUES (?, ?, ?, ?, ?)'
  ).run(2, 'Client Two', 'Candidate Two', 'seed', 1);

  const server = await createServer();
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getManagerToken(baseUrl);
  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(`${baseUrl}/api/donors/101`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ exclusiveDonor: true, exclusiveClientId: 2 }),
  });
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.exclusive_donor, 1);
  assert.equal(detail.exclusive_client_id, 2);
  assert.equal(detail.assigned_client_ids, '2');

  const assignments = db
    .prepare('SELECT client_id, is_active FROM donor_assignments WHERE donor_id = ? ORDER BY client_id')
    .all(101)
    .map(({ client_id, is_active }) => ({ client_id, is_active }));
  assert.deepEqual(assignments, [
    { client_id: 1, is_active: 0 },
    { client_id: 2, is_active: 1 },
  ]);
});
