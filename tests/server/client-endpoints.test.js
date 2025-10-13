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

async function getClientToken(baseUrl, clientId = 1, password = 'seed') {
  const response = await fetch(`${baseUrl}/api/auth/client-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, password }),
  });
  assert.equal(response.status, 200, 'client login should succeed');
  const data = await response.json();
  assert.ok(data.token, 'login response should include token');
  return data.token;
}

function authHeaders(token) {
  return {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

test('call outcome trims status and normalizes optional fields', { concurrency: false }, async (t) => {
  db.exec('DELETE FROM call_outcomes');

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getClientToken(baseUrl);

  const response = await fetch(`${baseUrl}/api/client/1/call-outcome`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      donorId: 101,
      status: '  Completed  ',
      outcomeNotes: '   ',
      followUpDate: '   ',
      pledgeAmount: '',
      contributionAmount: 250,
      nextAction: '   ',
      callDuration: 120,
      callQuality: ' ',
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.outcomeId, 'response should include outcomeId');

  const record = db
    .prepare('SELECT status, outcome_notes, follow_up_date, pledge_amount, contribution_amount, next_action, call_duration, call_quality FROM call_outcomes WHERE id = ?')
    .get(payload.outcomeId);

  assert.equal(record.status, 'Completed');
  assert.equal(record.outcome_notes, null);
  assert.equal(record.follow_up_date, null);
  assert.equal(record.pledge_amount, null);
  assert.equal(record.contribution_amount, 250);
  assert.equal(record.next_action, null);
  assert.equal(record.call_duration, 120);
  assert.equal(record.call_quality, null);
});


test('call outcome requires a non-empty status', { concurrency: false }, async (t) => {
  db.exec('DELETE FROM call_outcomes');

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getClientToken(baseUrl);

  const response = await fetch(`${baseUrl}/api/client/1/call-outcome`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ donorId: 101, status: '   ' }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, 'status required');
});


test('research endpoint trims category and normalizes content', { concurrency: false }, async (t) => {
  db.exec('DELETE FROM client_donor_research');

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getClientToken(baseUrl);

  const response = await fetch(`${baseUrl}/api/client/1/donor/101/research`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ category: '  Background  ', content: '   ' }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.researchId, 'response should include researchId');

  const record = db
    .prepare('SELECT research_category, research_content FROM client_donor_research WHERE id = ?')
    .get(payload.researchId);

  assert.equal(record.research_category, 'Background');
  assert.equal(record.research_content, null);
});


test('research endpoint requires a category', { concurrency: false }, async (t) => {
  db.exec('DELETE FROM client_donor_research');

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getClientToken(baseUrl);

  const response = await fetch(`${baseUrl}/api/client/1/donor/101/research`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ category: '   ', content: 'Ignored' }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, 'category required');
});


test('notes endpoint trims type and normalizes content', { concurrency: false }, async (t) => {
  db.exec('DELETE FROM client_donor_notes');

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getClientToken(baseUrl);

  const response = await fetch(`${baseUrl}/api/client/1/donor/101/notes`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ noteType: '  general  ', noteContent: '   ', isPrivate: false }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.noteId, 'response should include noteId');

  const record = db
    .prepare('SELECT note_type, note_content, is_private FROM client_donor_notes WHERE id = ?')
    .get(payload.noteId);

  assert.equal(record.note_type, 'general');
  assert.equal(record.note_content, null);
  assert.equal(record.is_private, 0);
});


test('notes endpoint requires a noteType', { concurrency: false }, async (t) => {
  db.exec('DELETE FROM client_donor_notes');

  const server = await createServer();
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await getClientToken(baseUrl);

  const response = await fetch(`${baseUrl}/api/client/1/donor/101/notes`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ noteType: '   ', noteContent: 'Ignored' }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, 'noteType required');
});
