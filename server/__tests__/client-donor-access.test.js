const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const Database = require('better-sqlite3')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calltime-test-'))
const dbPath = path.join(tmpDir, 'campaign.db')

const bootstrapDb = new Database(dbPath)
bootstrapDb.exec(`
    CREATE TABLE clients (
        id INTEGER PRIMARY KEY,
        name TEXT,
        candidate TEXT,
        portal_password TEXT,
        portal_password_needs_reset INTEGER
    );
    INSERT INTO clients (id, name, candidate) VALUES (1, 'Client One', 'Candidate One');
    CREATE TABLE donors (
        id INTEGER PRIMARY KEY,
        client_id INTEGER,
        name TEXT,
        exclusive_donor INTEGER DEFAULT 0,
        exclusive_client_id INTEGER
    );
    INSERT INTO donors (id, client_id, name) VALUES
        (101, 1, 'Assigned Donor'),
        (102, NULL, 'Unassigned Donor'),
        (103, 1, 'Inactive Assignment');
    CREATE TABLE donor_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        donor_id INTEGER NOT NULL,
        assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        assigned_by TEXT,
        priority_level INTEGER DEFAULT 1,
        custom_ask_amount REAL,
        is_active BOOLEAN DEFAULT 1,
        assignment_notes TEXT
    );
    INSERT INTO donor_assignments (client_id, donor_id, is_active) VALUES (1, 101, 1);
    INSERT INTO donor_assignments (client_id, donor_id, is_active) VALUES (1, 103, 0);
`)
bootstrapDb.close()

process.env.NODE_ENV = 'test'
process.env.CALLTIME_DB_PATH = dbPath

const { app, ensureClientHasDonor, ClientDonorAccessError } = require('../index.js')

let server
let baseUrl

const getManagerToken = async () => {
    const response = await fetch(`${baseUrl}/api/auth/manager-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '10231972Fn*' })
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(body.token)
    return body.token
}

test.before(async () => {
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
})

test.after(() => {
    if (!server) return
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
    })
})

test('ensureClientHasDonor returns donor when assignment is active', () => {
    const donor = ensureClientHasDonor(1, 101)
    assert.equal(donor.id, 101)
})

test('ensureClientHasDonor throws 403 when donor is not assigned', () => {
    assert.throws(
        () => ensureClientHasDonor(1, 102),
        (error) => {
            assert.ok(error instanceof ClientDonorAccessError)
            assert.equal(error.status, 403)
            return true
        }
    )
})

test('ensureClientHasDonor throws 404 when donor is missing', () => {
    assert.throws(
        () => ensureClientHasDonor(1, 999),
        (error) => {
            assert.ok(error instanceof ClientDonorAccessError)
            assert.equal(error.status, 404)
            return true
        }
    )
})

test('GET donor returns donor data when authorized', async () => {
    const token = await getManagerToken()
    const response = await fetch(`${baseUrl}/api/client/1/donor/101`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.id, 101)
    assert.equal(body.name, 'Assigned Donor')
})

test('GET donor returns 403 when donor is not assigned', async () => {
    const token = await getManagerToken()
    const response = await fetch(`${baseUrl}/api/client/1/donor/102`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.equal(body.error, 'Donor not assigned to client')
})

test('POST call outcome succeeds for assigned donor', async () => {
    const token = await getManagerToken()
    const response = await fetch(`${baseUrl}/api/client/1/call-outcome`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ donorId: 101, status: 'Contacted' })
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.success, true)
})

test('POST call outcome returns 403 for unassigned donor', async () => {
    const token = await getManagerToken()
    const response = await fetch(`${baseUrl}/api/client/1/call-outcome`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ donorId: 102, status: 'Attempted' })
    })
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.equal(body.error, 'Donor not assigned to client')
})

test('POST donor research returns 403 when donor is not assigned', async () => {
    const token = await getManagerToken()
    const response = await fetch(`${baseUrl}/api/client/1/donor/102/research`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ category: 'Background', content: 'Notes' })
    })
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.equal(body.error, 'Donor not assigned to client')
})
