const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const ensureIntegrationDatabase = require('../../tests/helpers/integration-db')

ensureIntegrationDatabase()

const { app, db } = require('../index.js')

let server
let baseUrl

const AGGREGATION_CLIENT_ID = 9001
const DONOR_IDS = [9101, 9102]

const seedAggregationData = () => {
    db.prepare(
        `INSERT INTO clients (id, name, portal_password, portal_password_needs_reset)
         VALUES (?, ?, 'seed', 1)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name`
    ).run(AGGREGATION_CLIENT_ID, 'Aggregation Client')

    db.prepare('DELETE FROM donor_assignments WHERE client_id = ?').run(AGGREGATION_CLIENT_ID)
    db.prepare('DELETE FROM call_outcomes WHERE client_id = ?').run(AGGREGATION_CLIENT_ID)

    const upsertDonor = db.prepare(`
        INSERT INTO donors (id, client_id, name, exclusive_donor, exclusive_client_id)
        VALUES (?, ?, ?, 0, NULL)
        ON CONFLICT(id) DO UPDATE SET
            client_id = excluded.client_id,
            name = excluded.name,
            exclusive_donor = excluded.exclusive_donor,
            exclusive_client_id = excluded.exclusive_client_id
    `)

    upsertDonor.run(DONOR_IDS[0], AGGREGATION_CLIENT_ID, 'Aggregation Donor A')
    upsertDonor.run(DONOR_IDS[1], AGGREGATION_CLIENT_ID, 'Aggregation Donor B')

    const insertAssignment = db.prepare(`
        INSERT INTO donor_assignments (client_id, donor_id, is_active)
        VALUES (?, ?, 1)
    `)

    for (const donorId of DONOR_IDS) {
        insertAssignment.run(AGGREGATION_CLIENT_ID, donorId)
    }

    const insertOutcome = db.prepare(`
        INSERT INTO call_outcomes (client_id, donor_id, status, pledge_amount, contribution_amount)
        VALUES (?, ?, ?, ?, ?)
    `)

    insertOutcome.run(AGGREGATION_CLIENT_ID, DONOR_IDS[0], 'Pledged', 100, 60)
    insertOutcome.run(AGGREGATION_CLIENT_ID, DONOR_IDS[0], 'Follow-Up', 75, 40)
    insertOutcome.run(AGGREGATION_CLIENT_ID, DONOR_IDS[1], 'Contribution', 125, 90)
}

const getManagerToken = async () => {
    const response = await fetch(`${baseUrl}/api/auth/manager-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-manager-password' })
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

test.beforeEach(() => {
    seedAggregationData()
})

test.after(() => {
    if (!server) return
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
    })
})

const getExpectedTotals = () => {
    return db
        .prepare(
            `SELECT COUNT(*) AS total_calls,
                    COALESCE(SUM(pledge_amount), 0) AS total_pledged,
                    COALESCE(SUM(contribution_amount), 0) AS total_raised
             FROM call_outcomes
             WHERE client_id = ?`
        )
        .get(AGGREGATION_CLIENT_ID)
}

test('manager overview aggregates call outcomes per client before joining assignments', async () => {
    const expectedTotals = getExpectedTotals()
    const token = await getManagerToken()

    const response = await fetch(`${baseUrl}/api/manager/overview`, {
        headers: { Authorization: `Bearer ${token}` }
    })

    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(Array.isArray(body.clients))

    const aggregationClient = body.clients.find((client) => client.id === AGGREGATION_CLIENT_ID)
    assert.ok(aggregationClient, 'expected aggregation client to be returned in overview')

    assert.equal(aggregationClient.assigned_donors, DONOR_IDS.length)
    assert.equal(aggregationClient.total_calls, expectedTotals.total_calls)
    assert.equal(aggregationClient.total_pledged, expectedTotals.total_pledged)
    assert.equal(aggregationClient.total_raised, expectedTotals.total_raised)
})
