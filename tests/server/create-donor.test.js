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

test('creating a donor stores the record and assignments', { concurrency: false }, async (t) => {
  db.exec(`
    DELETE FROM donor_assignments WHERE donor_id IN (
      SELECT id FROM donors WHERE email = 'alice@example.test'
    );
    DELETE FROM donors WHERE email = 'alice@example.test';
  `);

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getManagerToken(baseUrl);
  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const payload = {
    firstName: 'Alice',
    lastName: 'Example',
    donorType: 'individual',
    assignedClientIds: [1],
    email: 'alice@example.test',
  };

  const response = await fetch(`${baseUrl}/api/donors`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201, 'donor creation should succeed');
  const donor = await response.json();
  assert.ok(donor.id, 'response should include donor id');
  assert.equal(donor.name, 'Alice Example');
  assert.equal(donor.first_name, 'Alice');
  assert.equal(donor.last_name, 'Example');
  assert.equal(donor.donor_type, 'individual');
  assert.equal(donor.is_business, 0);
  assert.equal(donor.assigned_client_ids, '1');

  const record = db
    .prepare(
      'SELECT name, first_name, last_name, is_business, business_name, donor_type, email FROM donors WHERE id = ?'
    )
    .get(donor.id);
  assert.deepEqual(record, {
    name: 'Alice Example',
    first_name: 'Alice',
    last_name: 'Example',
    is_business: 0,
    business_name: null,
    donor_type: 'individual',
    email: 'alice@example.test',
  });

  const assignments = db
    .prepare('SELECT client_id, donor_id, is_active FROM donor_assignments WHERE donor_id = ? ORDER BY client_id')
    .all(donor.id);
  assert.deepEqual(assignments, [{ client_id: 1, donor_id: donor.id, is_active: 1 }]);

  t.after(() => {
    db.exec(`
      DELETE FROM donor_assignments WHERE donor_id = ${donor.id};
      DELETE FROM donors WHERE id = ${donor.id};
    `);
  });
});
