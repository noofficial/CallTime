const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const ensureIntegrationDatabase = require('../../tests/helpers/integration-db')

ensureIntegrationDatabase()

const { app, ensureClientHasDonor, ClientDonorAccessError, db } = require('../index.js')

let server
let baseUrl

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

test('manager can create client with custom portal password', async () => {
    const token = await getManagerToken()

    const defaultResponse = await fetch(`${baseUrl}/api/clients`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Default Password Client', portalPassword: '', requirePasswordReset: true })
    })
    assert.equal(defaultResponse.status, 200)
    const defaultBody = await defaultResponse.json()
    const defaultRecord = db
        .prepare('SELECT portal_password, portal_password_needs_reset FROM clients WHERE id = ?')
        .get(defaultBody.id)
    assert.ok(defaultRecord.portal_password)
    assert.equal(defaultRecord.portal_password_needs_reset, 1)

    const customPassword = 'SecurePass1!'
    const customResponse = await fetch(`${baseUrl}/api/clients`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: 'Custom Password Client',
            portalPassword: customPassword,
            requirePasswordReset: false
        })
    })
    assert.equal(customResponse.status, 200)
    const customBody = await customResponse.json()
    const customRecord = db
        .prepare('SELECT portal_password, portal_password_needs_reset FROM clients WHERE id = ?')
        .get(customBody.id)

    assert.ok(customRecord.portal_password)
    assert.equal(customRecord.portal_password_needs_reset, 0)
    assert.notEqual(customRecord.portal_password, defaultRecord.portal_password)
    assert.notEqual(customRecord.portal_password, customPassword)
})

test('manager can update client portal password without reverting to default', async () => {
    const token = await getManagerToken()

    const createResponse = await fetch(`${baseUrl}/api/clients`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Updatable Client', portalPassword: '', requirePasswordReset: true })
    })
    assert.equal(createResponse.status, 200)
    const createBody = await createResponse.json()

    const originalRecord = db
        .prepare('SELECT portal_password, portal_password_needs_reset FROM clients WHERE id = ?')
        .get(createBody.id)
    assert.ok(originalRecord.portal_password)

    const updateResponse = await fetch(`${baseUrl}/api/clients/${createBody.id}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: 'Updatable Client',
            portalPassword: 'UpdatedPass2#',
            requirePasswordReset: true
        })
    })
    assert.equal(updateResponse.status, 200)
    const updateBody = await updateResponse.json()
    assert.ok(updateBody.success)

    const updatedRecord = db
        .prepare('SELECT portal_password, portal_password_needs_reset FROM clients WHERE id = ?')
        .get(createBody.id)

    assert.ok(updatedRecord.portal_password)
    assert.notEqual(updatedRecord.portal_password, originalRecord.portal_password)
    assert.equal(updatedRecord.portal_password_needs_reset, 1)
})
