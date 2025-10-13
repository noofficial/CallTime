const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const multer = require('multer')
const xlsx = require('xlsx')
const Database = require('better-sqlite3')

const app = express()
app.use(cors())
app.use(express.json())

// Prevent cached API responses from serving stale donor data
app.use((req, res, next) => {
    if (req.path && req.path.startsWith('/api/')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
        res.set('Pragma', 'no-cache')
        res.set('Expires', '0')
        res.set('Surrogate-Control', 'no-store')
    }
    next()
})

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')))

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
})

const BULK_UPLOAD_ACTOR = 'bulk-import'

const normalizeColumnName = (value) => {
    if (value === undefined || value === null) return ''
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const DONOR_COLUMN_MAP = new Map([
    ['name', 'name'],
    ['fullname', 'name'],
    ['donorname', 'name'],
    ['firstname', 'first_name'],
    ['givenname', 'first_name'],
    ['preferredname', 'first_name'],
    ['lastname', 'last_name'],
    ['surname', 'last_name'],
    ['last', 'last_name'],
    ['phone', 'phone'],
    ['phonenumber', 'phone'],
    ['phone1', 'phone'],
    ['mobile', 'phone'],
    ['cell', 'phone'],
    ['email', 'email'],
    ['emailaddress', 'email'],
    ['street', 'street_address'],
    ['address', 'street_address'],
    ['address1', 'street_address'],
    ['addressline1', 'street_address'],
    ['addressline2', 'address_line2'],
    ['address2', 'address_line2'],
    ['line2', 'address_line2'],
    ['fulladdress', 'full_address'],
    ['completeaddress', 'full_address'],
    ['mailingaddress', 'full_address'],
    ['fullmailingaddress', 'full_address'],
    ['mailingaddressline', 'full_address'],
    ['addressfull', 'full_address'],
    ['city', 'city'],
    ['town', 'city'],
    ['citystatezip', 'city_state_postal'],
    ['citystatezipcode', 'city_state_postal'],
    ['citystatepostalcode', 'city_state_postal'],
    ['citystatepostal', 'city_state_postal'],
    ['citystate', 'city_state_postal'],
    ['state', 'state'],
    ['province', 'state'],
    ['region', 'state'],
    ['zipcode', 'postal_code'],
    ['zip', 'postal_code'],
    ['postalcode', 'postal_code'],
    ['postal', 'postal_code'],
    ['employer', 'employer'],
    ['company', 'employer'],
    ['organization', 'employer'],
    ['workplace', 'employer'],
    ['occupation', 'job_title'],
    ['profession', 'job_title'],
    ['industry', 'occupation'],
    ['sector', 'occupation'],
    ['title', 'job_title'],
    ['jobtitle', 'job_title'],
    ['position', 'job_title'],
    ['bio', 'bio'],
    ['biography', 'bio'],
    ['notes', 'notes'],
    ['tags', 'tags'],
    ['tag', 'tags'],
    ['ask', 'suggested_ask'],
    ['askamount', 'suggested_ask'],
    ['suggestedask', 'suggested_ask'],
    ['targetask', 'suggested_ask'],
    ['capacity', 'suggested_ask'],
    ['lastgift', 'last_gift_note'],
    ['lastgiftnote', 'last_gift_note'],
    ['photourl', 'photo_url'],
    ['pictureurl', 'photo_url'],
    ['imageurl', 'photo_url'],
    ['avatar', 'photo_url'],
    ['clientid', 'client_id'],
    ['client', 'client_id'],
    ['clientname', 'client_label'],
    ['campaign', 'client_label'],
    ['candidate', 'client_label'],
    ['id', 'id'],
    ['donorid', 'id'],
    ['recordid', 'id'],
])

const CONTRIBUTION_PREFIXES = [
    'contribution',
    'giving',
    'donation',
    'gift',
    'contributionhistory',
    'givinghistory',
    'donationhistory',
    'gifthistory',
    'history',
]
const CONTRIBUTION_FIELD_PATTERN = new RegExp(
    `^(?:${CONTRIBUTION_PREFIXES.join('|')})(\\d*)(year|candidate|amount|office|officesought)$`
)

const identifyContributionField = (normalizedKey) => {
    if (!normalizedKey) return null

    const match = normalizedKey.match(CONTRIBUTION_FIELD_PATTERN)
    if (!match) return null

    const [, slotDigits, rawField] = match
    const field = rawField === 'officesought' ? 'office' : rawField
    const slot = slotDigits || 'default'
    return { slot, field }
}

const cleanString = (value) => {
    if (value === undefined || value === null) return null
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed === '' ? null : trimmed
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : null
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false'
    }
    const converted = String(value).trim()
    return converted === '' ? null : converted
}

const hasValue = (value) => {
    if (value === undefined || value === null) return false
    if (typeof value === 'string') {
        return value.trim() !== ''
    }
    if (typeof value === 'number') {
        return Number.isFinite(value)
    }
    if (typeof value === 'boolean') {
        return true
    }
    return String(value).trim() !== ''
}

const parseInteger = (value) => {
    if (value === undefined || value === null) return null
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null
        const int = Math.trunc(value)
        return int > 0 ? int : null
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return null
        if (!/^\d+$/.test(trimmed)) return null
        const int = parseInt(trimmed, 10)
        return int > 0 ? int : null
    }
    return null
}

const parseSuggestedAsk = (value) => {
    if (value === undefined || value === null) return null
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Number(value) : null
    }
    if (typeof value === 'string') {
        const cleaned = value.replace(/[^0-9.+-]/g, '').trim()
        if (!cleaned) return null
        const parsed = Number(cleaned)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

const parseCurrency = (value) => {
    if (value === undefined || value === null) return null
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Number(value) : null
    }
    if (typeof value === 'string') {
        const cleaned = value
            .replace(/\$/g, '')
            .replace(/,/g, '')
            .replace(/\(/g, '-')
            .replace(/\)/g, '')
            .replace(/[^0-9.+-]/g, '')
            .trim()
        if (!cleaned) return null
        const parsed = Number(cleaned)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

const parseNonNegativeNumber = (value) => {
    const parsed = parseCurrency(value)
    if (parsed === null) return null
    return parsed >= 0 ? parsed : null
}

const parseCityStatePostal = (value) => {
    const cleaned = cleanString(value)
    if (!cleaned) return null

    const match = cleaned.match(/^(?<city>.+?)[,\s]+(?<state>[A-Za-z]{2})(?:\s+(?<postal>\d{5}(?:-\d{4})?))?$/)
    if (!match || !match.groups) return null

    const city = cleanString(match.groups.city)
    const state = cleanString(match.groups.state)
    const postal = cleanString(match.groups.postal)

    return {
        city: city || null,
        state: state || null,
        postal_code: postal || null,
    }
}

const parseAddressFromSingleCell = (value) => {
    if (value === undefined || value === null) return {}
    const raw = typeof value === 'string' ? value : String(value)
    const normalized = raw.replace(/\r/g, '\n').trim()
    if (!normalized) return {}

    let remainder = normalized
    let city = null
    let state = null
    let postal_code = null

    const tailMatch = remainder.match(/(?:^|[\n,])\s*(?<city>[A-Za-z0-9.'\- ]+?)\s*,?\s*(?<state>[A-Za-z]{2})(?:\s+(?<postal>\d{5}(?:-\d{4})?))?\s*$/)
    if (tailMatch && tailMatch.groups) {
        city = cleanString(tailMatch.groups.city) || null
        state = cleanString(tailMatch.groups.state) || null
        postal_code = cleanString(tailMatch.groups.postal) || null
        const matchedText = tailMatch[0]
        const trimmedMatch = matchedText.replace(/^[,\s\n]+/, '')
        const index = remainder.lastIndexOf(trimmedMatch)
        if (index !== -1) {
            remainder = remainder.slice(0, index)
        } else {
            remainder = remainder.replace(matchedText, '')
        }
        remainder = remainder.trim().replace(/[,\s]+$/, '').trim()
    }

    const segments = remainder
        .split(/\n+/)
        .map((segment) => segment.trim())
        .filter(Boolean)

    let street_address = null
    let address_line2 = null

    if (segments.length) {
        street_address = segments.shift() || null
        if (segments.length) {
            address_line2 = segments.join(', ') || null
        }
    }

    if (!street_address && remainder) {
        const parts = remainder
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        if (parts.length) {
            street_address = parts.shift() || null
            if (parts.length) {
                const rest = parts.join(', ')
                if (rest) {
                    address_line2 = address_line2 ? `${address_line2}, ${rest}` : rest
                }
            }
        }
    }

    if (!street_address && remainder) {
        street_address = remainder
    }

    return {
        street_address: cleanString(street_address),
        address_line2: cleanString(address_line2),
        city: city,
        state: state,
        postal_code: postal_code,
    }
}

const deriveAddressFields = (row) => {
    const originalStreet = row.street_address
    const originalLine2 = row.address_line2

    let street_address = cleanString(originalStreet)
    let address_line2 = cleanString(originalLine2)
    let city = cleanString(row.city)
    let state = cleanString(row.state)
    let postal_code = cleanString(row.postal_code)

    const applyParsed = (parsed) => {
        if (!parsed || typeof parsed !== 'object') return
        if (parsed.street_address && (!street_address || street_address === cleanString(originalStreet))) {
            street_address = parsed.street_address
        } else if (!street_address && parsed.street_address) {
            street_address = parsed.street_address
        }
        if (!address_line2 && parsed.address_line2) {
            address_line2 = parsed.address_line2
        }
        if (!city && parsed.city) {
            city = parsed.city
        }
        if (!state && parsed.state) {
            state = parsed.state
        }
        if (!postal_code && parsed.postal_code) {
            postal_code = parsed.postal_code
        }
    }

    const combinedCityStatePostal = parseCityStatePostal(row.city_state_postal)
    if (combinedCityStatePostal) {
        if (!city && combinedCityStatePostal.city) {
            city = combinedCityStatePostal.city
        }
        if (!state && combinedCityStatePostal.state) {
            state = combinedCityStatePostal.state
        }
        if (!postal_code && combinedCityStatePostal.postal_code) {
            postal_code = combinedCityStatePostal.postal_code
        }
    }

    const fullAddressSources = []
    if (hasValue(row.full_address)) {
        fullAddressSources.push(row.full_address)
    }
    if (hasValue(row.street_address)) {
        fullAddressSources.push(row.street_address)
    }

    fullAddressSources.forEach((value) => {
        const parsed = parseAddressFromSingleCell(value)
        applyParsed(parsed)
    })

    if (!city || !state || !postal_code) {
        const parsedLine2 = parseCityStatePostal(address_line2)
        if (parsedLine2) {
            if (!city && parsedLine2.city) {
                city = parsedLine2.city
            }
            if (!state && parsedLine2.state) {
                state = parsedLine2.state
            }
            if (!postal_code && parsedLine2.postal_code) {
                postal_code = parsedLine2.postal_code
            }
            const originalLine2Normalized = cleanString(originalLine2)
            if (originalLine2Normalized) {
                const compactOriginal = originalLine2Normalized.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                const compactParsed = [parsedLine2.city, parsedLine2.state, parsedLine2.postal_code]
                    .filter(Boolean)
                    .join(' ')
                const normalizedParsed = cleanString(compactParsed)
                const compactParsedNormalized = normalizedParsed
                    ? normalizedParsed.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                    : ''
                if (compactParsedNormalized && compactOriginal === compactParsedNormalized) {
                    address_line2 = null
                }
            }
        }
    }

    return { street_address, address_line2, city, state, postal_code }
}

const transformContributionRows = (rows = []) => {
    const entries = []
    const errors = []

    rows.forEach((row, index) => {
        if (!row || typeof row !== 'object') return

        const year = parseInteger(row.year)
        const candidate = cleanString(row.candidate)
        const amount = parseCurrency(row.amount)
        const officeSought = cleanString(row.office ?? row.office_sought ?? row.officeSought)

        if (year === null && !candidate && amount === null) {
            return
        }

        if (year === null || !candidate || amount === null) {
            const missing = []
            if (year === null) missing.push('year')
            if (!candidate) missing.push('candidate')
            if (amount === null) missing.push('amount')
            errors.push(`Contribution ${index + 1}: missing ${missing.join(', ')}`)
            return
        }

        entries.push({ year, candidate, amount, officeSought })
    })

    return { entries, errors }
}

const buildClientLookup = (clients) => {
    const lookup = new Map()
    clients.forEach((client) => {
        if (!client || typeof client !== 'object') return
        const candidates = [client.name, client.candidate]
        candidates.forEach((label) => {
            const normalized = normalizeColumnName(label)
            if (normalized) {
                lookup.set(normalized, client.id)
            }
        })
    })
    return lookup
}

const resolveClientIdFromInputs = (rawId, label, fallback, lookup) => {
    const directId = parseInteger(rawId)
    if (directId) return directId

    if (typeof rawId === 'string' && rawId.trim()) {
        const normalized = normalizeColumnName(rawId)
        const lookedUp = lookup.get(normalized)
        if (lookedUp) return lookedUp
    }

    if (label) {
        const normalized = normalizeColumnName(label)
        const lookedUp = lookup.get(normalized)
        if (lookedUp) return lookedUp
    }

    const fallbackId = parseInteger(fallback)
    if (fallbackId) return fallbackId

    return null
}

const transformDonorRow = (row, fallbackClientId, clientLookup) => {
    const donorId = parseInteger(row.id)
    let firstName = cleanString(row.first_name)
    let lastName = cleanString(row.last_name)
    let name = cleanString(row.name)

    if (!name) {
        const combined = [firstName, lastName].filter(Boolean).join(' ').trim()
        name = combined || null
    }

    if (!name) {
        return { error: 'Missing donor name' }
    }

    if (!firstName && !lastName && name) {
        const parts = name.split(/\s+/).filter(Boolean)
        if (parts.length === 1) {
            firstName = parts[0]
        } else if (parts.length > 1) {
            firstName = parts.shift()
            lastName = parts.join(' ') || null
        }
    }

    const explicitClientProvided = hasValue(row.client_id) || hasValue(row.client_label)
    const resolvedClientId = resolveClientIdFromInputs(
        row.client_id,
        row.client_label,
        fallbackClientId,
        clientLookup
    )

    if (!resolvedClientId && explicitClientProvided) {
        return { error: 'Unknown client assignment' }
    }

    const address = deriveAddressFields(row)

    const donor = {
        client_id: resolvedClientId ?? null,
        name,
        first_name: firstName,
        last_name: lastName,
        phone: cleanString(row.phone),
        email: cleanString(row.email),
        street_address: address.street_address,
        address_line2: address.address_line2,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        employer: cleanString(row.employer),
        occupation: cleanString(row.occupation),
        job_title: cleanString(row.job_title),
        tags: cleanString(row.tags),
        suggested_ask: parseSuggestedAsk(row.suggested_ask),
        last_gift_note: cleanString(row.last_gift_note),
        notes: cleanString(row.notes),
        bio: cleanString(row.bio),
        photo_url: cleanString(row.photo_url),
    }

    return { donor, donorId, clientId: resolvedClientId ?? null }
}

const SESSION_DURATION_MS = 1000 * 60 * 60 * 8 // 8 hours
const sessions = new Map()

const safeCompare = (input, secret) => {
    if (typeof input !== 'string' || typeof secret !== 'string') return false
    const inputBuffer = Buffer.from(input)
    const secretBuffer = Buffer.from(secret)
    if (inputBuffer.length !== secretBuffer.length) return false
    return crypto.timingSafeEqual(inputBuffer, secretBuffer)
}

const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString('hex')
    const derived = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex')
    return `${salt}:${derived}`
}

const verifyPassword = (password, stored) => {
    if (!password || !stored || typeof stored !== 'string') return false
    const parts = stored.split(':')
    if (parts.length !== 2) {
        return safeCompare(password, stored)
    }

    const [salt, expected] = parts
    try {
        const derived = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex')
        const derivedBuffer = Buffer.from(derived, 'hex')
        const expectedBuffer = Buffer.from(expected, 'hex')
        if (derivedBuffer.length !== expectedBuffer.length) {
            return false
        }
        return crypto.timingSafeEqual(derivedBuffer, expectedBuffer)
    } catch (error) {
        return false
    }
}

const createSession = (session) => {
    const token = crypto.randomBytes(24).toString('hex')
    const expires = Date.now() + SESSION_DURATION_MS
    sessions.set(token, { ...session, expires })
    return { token, expires }
}

const getSessionFromToken = (token) => {
    if (!token) return null
    const session = sessions.get(token)
    if (!session) return null
    if (session.expires <= Date.now()) {
        sessions.delete(token)
        return null
    }
    return session
}

const destroySession = (token) => {
    if (token) {
        sessions.delete(token)
    }
}

const extractBearerToken = (req) => {
    const header = req.headers['authorization']
    if (!header || typeof header !== 'string') return null
    const [scheme, value] = header.split(' ')
    if (scheme !== 'Bearer' || !value) return null
    return value.trim()
}

class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
        super(message)
        this.name = 'UnauthorizedError'
    }
}

const DEFAULT_MANAGER_PASSWORD = '10231972Fn*'
const managerPasswordHash = process.env.MANAGER_PASSWORD_HASH || null
const managerPassword = managerPasswordHash
    ? null
    : process.env.MANAGER_PASSWORD ?? DEFAULT_MANAGER_PASSWORD

if (!managerPasswordHash && process.env.MANAGER_PASSWORD == null) {
    console.log('Using built-in manager password. Set MANAGER_PASSWORD or MANAGER_PASSWORD_HASH to override the default.')
}

const verifyManagerPassword = (password) => {
    if (managerPasswordHash) {
        return verifyPassword(password, managerPasswordHash)
    }
    if (managerPassword) {
        return safeCompare(password, managerPassword)
    }
    return false
}

const authenticateManager = (req, res, next) => {
    try {
        const token = extractBearerToken(req)
        const session = getSessionFromToken(token)
        if (!session || session.role !== 'manager') {
            throw new UnauthorizedError()
        }
        req.session = session
        req.sessionToken = token
        next()
    } catch (error) {
        const status = error instanceof UnauthorizedError ? 401 : 500
        res.status(status).json({ error: 'Unauthorized' })
    }
}

const authenticateClient = (req, res, next) => {
    try {
        const token = extractBearerToken(req)
        const session = getSessionFromToken(token)
        if (!session) {
            throw new UnauthorizedError()
        }

        if (session.role === 'client') {
            req.session = session
            req.sessionToken = token
            req.authenticatedClientId = session.clientId
            req.isManagerSession = Boolean(session.impersonatedByManager)
            return next()
        }

        if (session.role === 'manager') {
            req.session = session
            req.sessionToken = token
            req.authenticatedClientId = req.params.clientId
            req.isManagerSession = true
            return next()
        }

        throw new UnauthorizedError()
    } catch (error) {
        const status = error instanceof UnauthorizedError ? 401 : 500
        res.status(status).json({ error: 'Unauthorized' })
    }
}

const DEFAULT_CLIENT_PORTAL_PASSWORD = process.env.DEFAULT_CLIENT_PORTAL_PASSWORD || 'password'

const sanitizeClientRecord = (client) => {
    if (!client || typeof client !== 'object') return client
    const { portal_password, portal_password_needs_reset, ...rest } = client
    return rest
}

const sanitizeClientCollection = (clients) => {
    return Array.isArray(clients) ? clients.map(sanitizeClientRecord) : clients
}

const clientMatchesSession = (sessionClientId, requestedClientId) => {
    if (sessionClientId == null || requestedClientId == null) return false
    return String(sessionClientId) === String(requestedClientId)
}

// Database can be in either server/ or data/ directory - let's check both
const serverDbPath = path.join(__dirname, 'campaign.db')
const dataDbPath = path.join(__dirname, '..', 'data', 'campaign.db')

const candidateDatabases = []

if (process.env.CALLTIME_DB_PATH) {
    candidateDatabases.push({
        path: process.env.CALLTIME_DB_PATH,
        label: 'CALLTIME_DB_PATH override'
    })
}

candidateDatabases.push(
    { path: dataDbPath, label: 'data directory' },
    { path: serverDbPath, label: 'server directory' }
)

let db
let dbPath

const openDatabase = () => {
    let fallback = null

    for (const candidate of candidateDatabases) {
        if (!fs.existsSync(candidate.path)) {
            continue
        }

        try {
            const connection = new Database(candidate.path)
            const hasClientsTable = connection.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'clients'
            `).get()
            const hasDonorsTable = connection.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'donors'
            `).get()

            if (hasClientsTable && hasDonorsTable) {
                console.log(`Using database from ${candidate.label}:`, candidate.path)
                return { connection, path: candidate.path }
            }

            if (!fallback) {
                console.warn(`Database at ${candidate.path} is missing expected tables. Marking as fallback.`)
                fallback = { connection, path: candidate.path, label: candidate.label }
            } else {
                connection.close()
            }
        } catch (error) {
            console.error(`Failed to open database at ${candidate.path}:`, error.message)
        }
    }

    if (fallback) {
        console.warn(`Falling back to database from ${fallback.label}: ${fallback.path}`)
        return { connection: fallback.connection, path: fallback.path }
    }

    return null
}

const selectedDatabase = openDatabase()

if (!selectedDatabase) {
    console.error('No campaign.db found in server/ or data/ directories')
    console.log('Checked paths:', candidateDatabases.map(db => db.path))
    process.exit(1)
}

db = selectedDatabase.connection
dbPath = selectedDatabase.path

try {
    db.pragma('foreign_keys = ON')
} catch (error) {
    console.warn('Failed to enable foreign key enforcement:', error.message)
}

try {
    db.pragma('journal_mode = WAL')
    console.log('Connected to database successfully')
} catch (error) {
    console.warn('Connected to database but failed to enable WAL mode:', error.message)
}

// Enhanced schema for improved call time management
const DONORS_TABLE_COLUMNS_SQL = `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    email TEXT,
    street_address TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    employer TEXT,
    occupation TEXT,
    job_title TEXT,
    tags TEXT,
    suggested_ask REAL,
    last_gift_note TEXT,
    notes TEXT,
    bio TEXT,
    photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
`

const GIVING_HISTORY_TABLE_COLUMNS_SQL = `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    candidate TEXT NOT NULL,
    office_sought TEXT,
    amount REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
`

const DONOR_ASSIGNMENTS_TABLE_COLUMNS_SQL = `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    donor_id INTEGER NOT NULL,
    assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    assigned_by TEXT,
    priority_level INTEGER DEFAULT 1,
    custom_ask_amount REAL,
    is_active BOOLEAN DEFAULT 1,
    assignment_notes TEXT,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE,
    UNIQUE(client_id, donor_id)
`

const DONORS_COLUMN_ORDER = [
    'id',
    'client_id',
    'name',
    'first_name',
    'last_name',
    'phone',
    'email',
    'street_address',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'employer',
    'occupation',
    'job_title',
    'tags',
    'suggested_ask',
    'last_gift_note',
    'notes',
    'bio',
    'photo_url',
    'created_at',
]

const GIVING_HISTORY_COLUMN_ORDER = [
    'id',
    'donor_id',
    'year',
    'candidate',
    'office_sought',
    'amount',
    'created_at',
]

const DONOR_ASSIGNMENTS_COLUMN_ORDER = [
    'id',
    'client_id',
    'donor_id',
    'assigned_date',
    'assigned_by',
    'priority_level',
    'custom_ask_amount',
    'is_active',
    'assignment_notes',
]

const schemaEntryExists = (name, type = 'table') => {
    try {
        const stmt = db.prepare(
            'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1'
        )
        return Boolean(stmt.get(type, name))
    } catch (error) {
        console.warn(`Failed to inspect schema for ${type} ${name}:`, error.message)
        return false
    }
}

const createDonorsTableStructure = () => {
    db.exec(`CREATE TABLE IF NOT EXISTS donors (${DONORS_TABLE_COLUMNS_SQL})`)
    db.exec('CREATE INDEX IF NOT EXISTS idx_donors_client ON donors(client_id)')
}

const rebuildDonorsTableFromSource = (sourceTable) => {
    const info = db.prepare(`PRAGMA table_info(${sourceTable})`).all()
    const availableColumns = info.map((column) => column.name)
    const transferableColumns = DONORS_COLUMN_ORDER.filter((column) =>
        availableColumns.includes(column)
    )

    db.exec('DROP TABLE IF EXISTS donors_new')
    db.exec(`CREATE TABLE donors_new (${DONORS_TABLE_COLUMNS_SQL})`)

    if (transferableColumns.length) {
        const columnList = transferableColumns.join(', ')
        db.exec(
            `INSERT INTO donors_new (${columnList}) SELECT ${columnList} FROM ${sourceTable}`
        )
    }

    if (sourceTable !== 'donors') {
        db.exec('DROP TABLE IF EXISTS donors')
    }

    db.exec(`DROP TABLE ${sourceTable}`)
    db.exec('ALTER TABLE donors_new RENAME TO donors')
    db.exec('CREATE INDEX IF NOT EXISTS idx_donors_client ON donors(client_id)')
    db.exec(
        `UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM donors), 0) WHERE name = 'donors'`
    )
}

const disableForeignKeysForMigration = () => {
    let wasEnabled = 0
    try {
        wasEnabled = db.pragma('foreign_keys', { simple: true })
    } catch (error) {
        console.warn('Unable to read foreign key pragma before donor migration:', error.message)
        return 0
    }

    if (wasEnabled) {
        try {
            db.pragma('foreign_keys = OFF')
        } catch (error) {
            console.warn('Unable to disable foreign keys before donor migration:', error.message)
            return 0
        }
    }

    return wasEnabled
}

const ensureDonorsLegacyView = () => {
    try {
        if (schemaEntryExists('donors_legacy', 'table')) {
            return
        }

        db.exec('DROP VIEW IF EXISTS donors_legacy')
        db.exec('CREATE VIEW donors_legacy AS SELECT * FROM donors')
    } catch (error) {
        console.warn('Unable to ensure donors_legacy compatibility view:', error.message)
    }
}

const rebuildLegacyGivingHistory = () => {
    let foreignKeysInitiallyEnabled = 0

    try {
        if (!schemaEntryExists('giving_history', 'table')) {
            return
        }

        const foreignKeys = db.prepare('PRAGMA foreign_key_list(giving_history)').all()
        const referencesLegacy = foreignKeys.some((fk) => fk.table === 'donors_legacy')

        if (!referencesLegacy) {
            return
        }

        foreignKeysInitiallyEnabled = disableForeignKeysForMigration()

        const info = db.prepare('PRAGMA table_info(giving_history)').all()
        const availableColumns = info.map((column) => column.name)
        const transferableColumns = GIVING_HISTORY_COLUMN_ORDER.filter((column) =>
            availableColumns.includes(column)
        )

        db.exec('DROP TABLE IF EXISTS giving_history_new')
        db.exec(`CREATE TABLE giving_history_new (${GIVING_HISTORY_TABLE_COLUMNS_SQL})`)

        if (transferableColumns.length) {
            const columnList = transferableColumns.join(', ')
            db.exec(
                `INSERT INTO giving_history_new (${columnList}) SELECT ${columnList} FROM giving_history`
            )
        }

        db.exec('DROP TABLE giving_history')
        db.exec('ALTER TABLE giving_history_new RENAME TO giving_history')

        db.exec('CREATE INDEX IF NOT EXISTS idx_giving_history_donor ON giving_history(donor_id)')
        db.exec(
            'CREATE INDEX IF NOT EXISTS idx_giving_history_candidate_year ON giving_history(candidate, year)'
        )
        db.exec('CREATE INDEX IF NOT EXISTS idx_giving_history_year ON giving_history(year)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_giving_history_amount ON giving_history(amount)')

        console.log('Updated giving_history table to reference donors directly.')
    } catch (error) {
        console.error('Failed to rebuild giving_history table:', error.message)
    } finally {
        if (foreignKeysInitiallyEnabled) {
            try {
                db.pragma('foreign_keys = ON')
            } catch (error) {
                console.warn('Unable to re-enable foreign keys after giving_history rebuild:', error.message)
            }
        }
    }
}

const rebuildLegacyDonorAssignments = () => {
    let foreignKeysInitiallyEnabled = 0

    try {
        if (!schemaEntryExists('donor_assignments', 'table')) {
            return
        }

        const foreignKeys = db.prepare('PRAGMA foreign_key_list(donor_assignments)').all()
        const referencesLegacy = foreignKeys.some((fk) => fk.table === 'donors_legacy')

        if (!referencesLegacy) {
            return
        }

        foreignKeysInitiallyEnabled = disableForeignKeysForMigration()

        const info = db.prepare('PRAGMA table_info(donor_assignments)').all()
        const availableColumns = info.map((column) => column.name)
        const transferableColumns = DONOR_ASSIGNMENTS_COLUMN_ORDER.filter((column) =>
            availableColumns.includes(column)
        )

        db.exec('DROP TABLE IF EXISTS donor_assignments_new')
        db.exec(`CREATE TABLE donor_assignments_new (${DONOR_ASSIGNMENTS_TABLE_COLUMNS_SQL})`)

        if (transferableColumns.length) {
            const columnList = transferableColumns.join(', ')
            db.exec(
                `INSERT INTO donor_assignments_new (${columnList}) SELECT ${columnList} FROM donor_assignments`
            )
        }

        db.exec('DROP TABLE donor_assignments')
        db.exec('ALTER TABLE donor_assignments_new RENAME TO donor_assignments')
        db.exec('CREATE INDEX IF NOT EXISTS idx_donor_assignments_client ON donor_assignments(client_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_donor_assignments_donor ON donor_assignments(donor_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_donor_assignments_active ON donor_assignments(is_active)')

        console.log('Updated donor_assignments table to reference donors directly.')
    } catch (error) {
        console.error('Failed to rebuild donor_assignments table:', error.message)
    } finally {
        if (foreignKeysInitiallyEnabled) {
            try {
                db.pragma('foreign_keys = ON')
            } catch (error) {
                console.warn(
                    'Unable to re-enable foreign keys after donor_assignments rebuild:',
                    error.message
                )
            }
        }
    }
}

const migrateDonorsTable = () => {
    let foreignKeysInitiallyEnabled = 0

    try {
        const donorsExists = schemaEntryExists('donors', 'table')
        const legacyExists = schemaEntryExists('donors_legacy', 'table')

        if (!donorsExists && !legacyExists) {
            createDonorsTableStructure()
            console.log('Created donors table because it was missing.')
        } else if (!donorsExists && legacyExists) {
            foreignKeysInitiallyEnabled = disableForeignKeysForMigration()

            const migrateFromLegacy = db.transaction(() => {
                rebuildDonorsTableFromSource('donors_legacy')
            })

            migrateFromLegacy()
            console.log('Rebuilt donors table from donors_legacy backup.')
        } else {
            const info = db.prepare(`PRAGMA table_info(donors)`).all()
            if (!info.length) {
                createDonorsTableStructure()
                console.log('Recreated donors table because schema inspection failed.')
            } else {
                const clientIdColumn = info.find((column) => column.name === 'client_id')
                const clientIdIsRequired = clientIdColumn && clientIdColumn.notnull !== 0

                if (clientIdIsRequired) {
                    foreignKeysInitiallyEnabled = disableForeignKeysForMigration()

                    const migrate = db.transaction(() => {
                        rebuildDonorsTableFromSource('donors')
                    })

                    migrate()

                    console.log('Updated donors table to allow unassigned donors.')
                }
            }
        }

        rebuildLegacyGivingHistory()
        rebuildLegacyDonorAssignments()
    } catch (error) {
        console.error('Failed to update donors table schema:', error.message)
    } finally {
        if (foreignKeysInitiallyEnabled) {
            try {
                db.pragma('foreign_keys = ON')
            } catch (error) {
                console.warn('Unable to re-enable foreign keys after donor migration:', error.message)
            }
        }

        ensureDonorsLegacyView()
    }
}

const ensureColumn = (table, column, definition) => {
    try {
        const existing = db.prepare(`PRAGMA table_info(${table})`).all()
        const hasColumn = existing.some((info) => info.name === column)
        if (!hasColumn) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
            console.log(`Added ${column} column to ${table}`)
        }
    } catch (error) {
        console.error(`Failed to ensure column ${table}.${column}:`, error.message)
    }
}

const enhanceSchema = () => {
    try {
        // Add new tables for enhanced functionality
        db.exec(`
            CREATE TABLE IF NOT EXISTS donors (
${DONORS_TABLE_COLUMNS_SQL}
            );
            CREATE INDEX IF NOT EXISTS idx_donors_client ON donors(client_id);

            -- Client-specific donor research (isolated per client)
            CREATE TABLE IF NOT EXISTS client_donor_research (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                donor_id INTEGER NOT NULL,
                research_category TEXT NOT NULL,
                research_content TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
                FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE,
                UNIQUE(client_id, donor_id, research_category)
            );

            -- Enhanced call outcomes with better categorization
            CREATE TABLE IF NOT EXISTS call_outcomes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                donor_id INTEGER NOT NULL,
                call_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT NOT NULL,
                outcome_notes TEXT,
                follow_up_date DATE,
                pledge_amount REAL,
                contribution_amount REAL,
                next_action TEXT,
                call_duration INTEGER, -- seconds
                call_quality INTEGER CHECK(call_quality >= 1 AND call_quality <= 5),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
                FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
            );

            -- Client-specific donor notes (completely isolated)
            CREATE TABLE IF NOT EXISTS client_donor_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                donor_id INTEGER NOT NULL,
                note_type TEXT NOT NULL DEFAULT 'general',
                note_content TEXT NOT NULL,
                is_private BOOLEAN DEFAULT true,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
                FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
            );

            -- Giving history for contribution tracking
            CREATE TABLE IF NOT EXISTS giving_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                donor_id INTEGER NOT NULL,
                year INTEGER NOT NULL,
                candidate TEXT NOT NULL,
                office_sought TEXT,
                amount REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_giving_history_donor ON giving_history(donor_id);
            CREATE INDEX IF NOT EXISTS idx_giving_history_candidate_year ON giving_history(candidate, year);
            CREATE INDEX IF NOT EXISTS idx_giving_history_year ON giving_history(year);
            CREATE INDEX IF NOT EXISTS idx_giving_history_amount ON giving_history(amount);

            -- Donor assignments (which clients can see which donors)
            CREATE TABLE IF NOT EXISTS donor_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                donor_id INTEGER NOT NULL,
                assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                assigned_by TEXT,
                priority_level INTEGER DEFAULT 1,
                custom_ask_amount REAL,
                is_active BOOLEAN DEFAULT true,
                assignment_notes TEXT,
                FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
                FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE,
                UNIQUE(client_id, donor_id)
            );

            -- Call sessions for tracking productivity
            CREATE TABLE IF NOT EXISTS call_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                session_start DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_end DATETIME,
                calls_attempted INTEGER DEFAULT 0,
                calls_completed INTEGER DEFAULT 0,
                total_pledged REAL DEFAULT 0,
                session_notes TEXT,
                FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
            );

            -- Create indexes for better performance
            CREATE INDEX IF NOT EXISTS idx_client_donor_research ON client_donor_research(client_id, donor_id);
            CREATE INDEX IF NOT EXISTS idx_call_outcomes_client ON call_outcomes(client_id);
            CREATE INDEX IF NOT EXISTS idx_call_outcomes_donor ON call_outcomes(donor_id);
            CREATE INDEX IF NOT EXISTS idx_client_donor_notes ON client_donor_notes(client_id, donor_id);
            CREATE INDEX IF NOT EXISTS idx_donor_assignments_client ON donor_assignments(client_id);
            CREATE INDEX IF NOT EXISTS idx_donor_assignments_donor ON donor_assignments(donor_id);
            CREATE INDEX IF NOT EXISTS idx_call_sessions_client ON call_sessions(client_id);
        `)
        migrateDonorsTable()
        ensureColumn('donors', 'first_name', 'first_name TEXT')
        ensureColumn('donors', 'last_name', 'last_name TEXT')
        ensureColumn('donors', 'job_title', 'job_title TEXT')
        ensureColumn('donors', 'street_address', 'street_address TEXT')
        ensureColumn('donors', 'address_line2', 'address_line2 TEXT')
        ensureColumn('donors', 'state', 'state TEXT')
        ensureColumn('donors', 'postal_code', 'postal_code TEXT')
        ensureColumn('donors', 'notes', 'notes TEXT')
        ensureColumn('clients', 'candidate', 'candidate TEXT')
        ensureColumn('clients', 'office', 'office TEXT')
        ensureColumn('clients', 'manager_name', 'manager_name TEXT')
        ensureColumn('clients', 'contact_email', 'contact_email TEXT')
        ensureColumn('clients', 'contact_phone', 'contact_phone TEXT')
        ensureColumn('clients', 'launch_date', 'launch_date TEXT')
        ensureColumn('clients', 'fundraising_goal', 'fundraising_goal REAL')
        ensureColumn('clients', 'notes', 'notes TEXT')
        ensureColumn('clients', 'portal_password', 'portal_password TEXT')
        ensureColumn('clients', 'portal_password_needs_reset', 'portal_password_needs_reset INTEGER DEFAULT 0')
        ensureColumn('giving_history', 'office_sought', 'office_sought TEXT')
        ensureColumn('donor_assignments', 'priority_level', 'priority_level INTEGER DEFAULT 1')
        ensureColumn('donor_assignments', 'is_active', 'is_active BOOLEAN DEFAULT 1')
        ensureColumn('donor_assignments', 'assigned_by', 'assigned_by TEXT')
        ensureColumn('donor_assignments', 'assignment_notes', 'assignment_notes TEXT')
        ensureColumn('donor_assignments', 'custom_ask_amount', 'custom_ask_amount REAL')
        ensureColumn('client_donor_notes', 'note_type', "note_type TEXT NOT NULL DEFAULT 'general'")
        ensureColumn('client_donor_notes', 'note_content', 'note_content TEXT')
        ensureColumn('client_donor_notes', 'is_private', 'is_private BOOLEAN DEFAULT 1')
        ensureColumn('client_donor_notes', 'is_important', 'is_important BOOLEAN DEFAULT 0')
        ensureColumn('client_donor_notes', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP')
        ensureColumn('client_donor_notes', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP')
        console.log('Enhanced schema applied successfully')
    } catch (error) {
        console.error('Schema enhancement error:', error.message)
    }
}

// Apply enhanced schema
enhanceSchema()

const initializeClientPortalPasswords = () => {
    try {
        const clientsMissingPassword = db.prepare(`
            SELECT id FROM clients
            WHERE portal_password IS NULL OR TRIM(portal_password) = ''
        `).all()

        if (clientsMissingPassword.length) {
            const updateStmt = db.prepare(`
                UPDATE clients
                SET portal_password = ?, portal_password_needs_reset = 1
                WHERE id = ?
            `)
            const applyDefaults = db.transaction((rows) => {
                rows.forEach((row) => {
                    updateStmt.run(hashPassword(DEFAULT_CLIENT_PORTAL_PASSWORD), row.id)
                })
            })
            applyDefaults(clientsMissingPassword)
            console.log(`Initialized temporary portal passwords for ${clientsMissingPassword.length} client(s).`)
        }

        const resetFlagUpdate = db.prepare(`
            UPDATE clients
            SET portal_password_needs_reset = 1
            WHERE portal_password IS NOT NULL
              AND (portal_password_needs_reset IS NULL OR portal_password_needs_reset NOT IN (0, 1))
        `).run()

        if (resetFlagUpdate.changes) {
            console.log(`Marked ${resetFlagUpdate.changes} client(s) to reset their portal password.`)
        }
    } catch (error) {
        console.error('Failed to initialize client portal passwords:', error.message)
    }
}

initializeClientPortalPasswords()

app.post('/api/auth/manager-login', (req, res) => {
    const password = req.body?.password
    if (typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: 'Password required' })
    }

    if (!verifyManagerPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' })
    }

    const session = createSession({ role: 'manager' })
    res.json({ token: session.token, expiresAt: session.expires })
})

app.post('/api/auth/client-login', (req, res) => {
    const clientId = req.body?.clientId
    const password = req.body?.password

    if (!clientId) {
        return res.status(400).json({ error: 'clientId required' })
    }

    if (typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: 'Password required' })
    }

    try {
        const client = db.prepare('SELECT id, name, candidate, portal_password, portal_password_needs_reset FROM clients WHERE id = ?').get(clientId)
        if (!client || !client.portal_password) {
            return res.status(401).json({ error: 'Invalid credentials' })
        }

        const usedManagerPassword = verifyManagerPassword(password)
        const hasValidClientPassword = verifyPassword(password, client.portal_password)

        if (!hasValidClientPassword && !usedManagerPassword) {
            return res.status(401).json({ error: 'Invalid credentials' })
        }

        const session = createSession({
            role: 'client',
            clientId: client.id,
            impersonatedByManager: usedManagerPassword,
        })
        const { portal_password, ...clientPayload } = client
        const mustResetPassword = !usedManagerPassword && Boolean(client.portal_password_needs_reset)
        res.json({ token: session.token, expiresAt: session.expires, client: clientPayload, mustResetPassword })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/api/auth/logout', (req, res) => {
    const token = extractBearerToken(req)
    destroySession(token)
    res.json({ success: true })
})

app.get('/api/auth/clients', (req, res) => {
    try {
        const clients = db.prepare(`
            SELECT id, name, candidate
            FROM clients
            WHERE portal_password IS NOT NULL AND portal_password <> ''
            ORDER BY COALESCE(NULLIF(name, ''), NULLIF(candidate, ''), CAST(id AS TEXT))
        `).all()
        res.json(
            clients.map((client) => ({
                id: client.id,
                name: client.name,
                candidate: client.candidate,
            }))
        )
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== MANAGER API ENDPOINTS ====================

// Get manager dashboard overview
app.get('/api/manager/overview', authenticateManager, (req, res) => {
    try {
        const clients = db.prepare(`
            SELECT c.*, 
                   COUNT(DISTINCT da.donor_id) as assigned_donors,
                   COUNT(DISTINCT co.id) as total_calls,
                   COALESCE(SUM(co.pledge_amount), 0) as total_pledged,
                   COALESCE(SUM(co.contribution_amount), 0) as total_raised
            FROM clients c
            LEFT JOIN donor_assignments da ON c.id = da.client_id AND da.is_active = 1
            LEFT JOIN call_outcomes co ON c.id = co.client_id
            GROUP BY c.id
            ORDER BY c.name
        `).all()

        const totalDonors = db.prepare('SELECT COUNT(*) as count FROM donors').get()
        const unassignedDonors = db.prepare(`
            SELECT COUNT(*) as count FROM donors d
            WHERE d.id NOT IN (SELECT DISTINCT donor_id FROM donor_assignments WHERE is_active = 1)
        `).get()

        res.json({
            clients: sanitizeClientCollection(clients),
            statistics: {
                totalDonors: totalDonors.count,
                unassignedDonors: unassignedDonors.count,
                activeClients: clients.length
            }
        })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Get all donors for assignment interface
app.get('/api/manager/donors', authenticateManager, (req, res) => {
    try {
        const donors = db.prepare(`
            SELECT d.*,
                   GROUP_CONCAT(c.name) as assigned_clients,
                   GROUP_CONCAT(c.id) as assigned_client_ids,
                   COUNT(da.client_id) as assignment_count
            FROM donors d
            LEFT JOIN donor_assignments da ON d.id = da.donor_id AND da.is_active = 1
            LEFT JOIN clients c ON da.client_id = c.id
            GROUP BY d.id
            ORDER BY d.name
        `).all()

        res.json(donors)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Assign donor to client
app.post('/api/manager/assign-donor', authenticateManager, (req, res) => {
    const { clientId, donorId, priority = 1 } = req.body

    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO donor_assignments (client_id, donor_id, priority_level, assigned_by)
            VALUES (?, ?, ?, ?)
        `)
        const result = stmt.run(clientId, donorId, priority, 'manager')

        res.json({ success: true, assignmentId: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Remove donor assignment
app.delete('/api/manager/assign-donor/:clientId/:donorId', authenticateManager, (req, res) => {
    const { clientId, donorId } = req.params

    try {
        const stmt = db.prepare(`
            UPDATE donor_assignments 
            SET is_active = 0 
            WHERE client_id = ? AND donor_id = ?
        `)
        stmt.run(clientId, donorId)

        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Bulk assign donors to client
app.post('/api/manager/bulk-assign', authenticateManager, (req, res) => {
    const { clientId, donorIds, priority = 1 } = req.body

    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO donor_assignments (client_id, donor_id, priority_level, assigned_by)
            VALUES (?, ?, ?, ?)
        `)

        const transaction = db.transaction(() => {
            donorIds.forEach(donorId => {
                stmt.run(clientId, donorId, priority, 'manager')
            })
        })

        transaction()
        res.json({ success: true, assigned: donorIds.length })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/api/manager/donors/upload', authenticateManager, upload.single('file'), (req, res) => {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
        return res.status(400).json({ error: 'Upload a CSV or Excel file to import donors.' })
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
        const [firstSheetName] = workbook.SheetNames
        if (!firstSheetName) {
            return res.status(400).json({ error: 'The uploaded file does not contain any worksheets.' })
        }

        const sheet = workbook.Sheets[firstSheetName]
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false })
        if (!rows.length) {
            return res.status(400).json({ error: 'The uploaded file does not include any donor rows.' })
        }

        const fallbackClientId = parseInteger(req.body && req.body.clientId)
        const clients = db.prepare('SELECT id, name, candidate FROM clients').all()
        const clientLookup = buildClientLookup(clients)

        const unknownColumns = new Set()
        const parsedRows = rows.map((row, index) => {
            const normalizedRow = {}
            const contributionMap = new Map()
            Object.entries(row).forEach(([key, value]) => {
                if (!key) return
                const normalizedKey = normalizeColumnName(key)
                if (!normalizedKey) return

                const contributionField = identifyContributionField(normalizedKey)
                if (contributionField) {
                    const existing = contributionMap.get(contributionField.slot) || {}
                    existing[contributionField.field] = value
                    contributionMap.set(contributionField.slot, existing)
                    return
                }

                const mappedColumn = DONOR_COLUMN_MAP.get(normalizedKey)
                if (!mappedColumn) {
                    unknownColumns.add(key)
                    return
                }
                normalizedRow[mappedColumn] = value
            })

            const contributions = Array.from(contributionMap.entries())
                .sort((a, b) => {
                    const rank = (slot) => {
                        if (slot === 'default') return 0
                        const numeric = Number(slot)
                        return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER
                    }
                    return rank(a[0]) - rank(b[0])
                })
                .map(([, entry]) => entry)

            return { rowNumber: index + 2, values: normalizedRow, contributions }
        })

        const summary = {
            totalRows: rows.length,
            inserted: 0,
            updated: 0,
            skipped: 0,
            ignoredColumns: Array.from(unknownColumns).sort(),
            errorDetails: [],
            assigned: 0,
            unassigned: 0,
            contributionsAdded: 0,
            contributionsSkipped: 0,
            contributionErrors: 0,
        }

        const insertStmt = db.prepare(`
            INSERT INTO donors (
                client_id, name, first_name, last_name, phone, email,
                street_address, address_line2, city, state, postal_code,
                employer, occupation, job_title, tags, suggested_ask, last_gift_note,
                notes, bio, photo_url
            ) VALUES (
                @client_id, @name, @first_name, @last_name, @phone, @email,
                @street_address, @address_line2, @city, @state, @postal_code,
                @employer, @occupation, @job_title, @tags, @suggested_ask, @last_gift_note,
                @notes, @bio, @photo_url
            )
        `)

        const updateStmt = db.prepare(`
            UPDATE donors
            SET client_id = COALESCE(@client_id, client_id),
                name = @name,
                first_name = COALESCE(@first_name, first_name),
                last_name = COALESCE(@last_name, last_name),
                phone = COALESCE(@phone, phone),
                email = COALESCE(@email, email),
                street_address = COALESCE(@street_address, street_address),
                address_line2 = COALESCE(@address_line2, address_line2),
                city = COALESCE(@city, city),
                state = COALESCE(@state, state),
                postal_code = COALESCE(@postal_code, postal_code),
                employer = COALESCE(@employer, employer),
                occupation = COALESCE(@occupation, occupation),
                job_title = COALESCE(@job_title, job_title),
                tags = COALESCE(@tags, tags),
                suggested_ask = COALESCE(@suggested_ask, suggested_ask),
                last_gift_note = COALESCE(@last_gift_note, last_gift_note),
                notes = COALESCE(@notes, notes),
                bio = COALESCE(@bio, bio),
                photo_url = COALESCE(@photo_url, photo_url)
            WHERE id = @id
        `)

        const getDonorById = db.prepare('SELECT id FROM donors WHERE id = ?')
        const assignStmt = db.prepare(`
            INSERT INTO donor_assignments (client_id, donor_id, assigned_by, is_active)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(client_id, donor_id)
            DO UPDATE SET
                is_active = 1,
                assigned_by = excluded.assigned_by,
                assigned_date = CURRENT_TIMESTAMP
        `)

        const findContributionStmt = db.prepare(`
            SELECT id FROM giving_history
            WHERE donor_id = ? AND year = ? AND candidate = ? AND amount = ?
              AND COALESCE(office_sought, '') = COALESCE(?, '')
            LIMIT 1
        `)

        const insertContributionStmt = db.prepare(`
            INSERT INTO giving_history (donor_id, year, candidate, office_sought, amount)
            VALUES (?, ?, ?, ?, ?)
        `)

        const applyRows = db.transaction((entries) => {
            entries.forEach(({ rowNumber, values, contributions }) => {
                const transformed = transformDonorRow(values, fallbackClientId, clientLookup)
                if (!transformed || transformed.error) {
                    summary.skipped += 1
                    summary.errorDetails.push(`Row ${rowNumber}: ${transformed?.error || 'Unable to parse donor record.'}`)
                    return
                }

                const { donor, donorId, clientId } = transformed
                const contributionResult = transformContributionRows(contributions)
                contributionResult.errors.forEach((error) => {
                    summary.contributionErrors += 1
                    summary.errorDetails.push(`Row ${rowNumber}: ${error}`)
                })
                let finalDonorId = donorId

                try {
                    if (donorId) {
                        const existing = getDonorById.get(donorId)
                        if (existing) {
                            updateStmt.run({ ...donor, id: donorId })
                            finalDonorId = donorId
                            summary.updated += 1
                        } else {
                            const result = insertStmt.run(donor)
                            finalDonorId = result.lastInsertRowid
                            summary.inserted += 1
                        }
                    } else {
                        const result = insertStmt.run(donor)
                        finalDonorId = result.lastInsertRowid
                        summary.inserted += 1
                    }

                    if (clientId) {
                        assignStmt.run(clientId, finalDonorId, BULK_UPLOAD_ACTOR)
                        summary.assigned += 1
                    } else {
                        summary.unassigned += 1
                    }

                    const seenContributions = new Set()
                    contributionResult.entries.forEach((entry) => {
                        const officeKey = entry.officeSought ? entry.officeSought.toLowerCase() : ''
                        const key = `${entry.year}|${entry.candidate.toLowerCase()}|${entry.amount}|${officeKey}`
                        if (seenContributions.has(key)) {
                            summary.contributionsSkipped += 1
                            return
                        }
                        seenContributions.add(key)

                        const existingContribution = findContributionStmt.get(
                            finalDonorId,
                            entry.year,
                            entry.candidate,
                            entry.amount,
                            entry.officeSought || null
                        )
                        if (existingContribution) {
                            summary.contributionsSkipped += 1
                            return
                        }

                        insertContributionStmt.run(
                            finalDonorId,
                            entry.year,
                            entry.candidate,
                            entry.officeSought || null,
                            entry.amount
                        )
                        summary.contributionsAdded += 1
                    })
                } catch (error) {
                    summary.skipped += 1
                    summary.errorDetails.push(`Row ${rowNumber}: ${error.message}`)
                }
            })
        })

        applyRows(parsedRows)

        res.json({
            success: true,
                summary: {
                    totalRows: summary.totalRows,
                    inserted: summary.inserted,
                    updated: summary.updated,
                    skipped: summary.skipped,
                    assigned: summary.assigned,
                    unassigned: summary.unassigned,
                    contributionsAdded: summary.contributionsAdded,
                    contributionsSkipped: summary.contributionsSkipped,
                    contributionErrors: summary.contributionErrors,
                    ignoredColumns: summary.ignoredColumns,
                    errorCount: summary.errorDetails.length,
                    errors: summary.errorDetails.slice(0, 20),
                },
            })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

class ClientDonorAccessError extends Error {
    constructor(status, message) {
        super(message)
        this.name = 'ClientDonorAccessError'
        this.status = status
    }
}

const findActiveClientDonorStmt = db.prepare(`
    SELECT d.*
    FROM donor_assignments da
    JOIN donors d ON d.id = da.donor_id
    WHERE da.client_id = ? AND da.donor_id = ? AND da.is_active = 1
    LIMIT 1
`)

const findDonorByIdStmt = db.prepare('SELECT id FROM donors WHERE id = ? LIMIT 1')

const ensureClientHasDonor = (clientId, donorId) => {
    const donor = findActiveClientDonorStmt.get(clientId, donorId)
    if (donor) {
        return donor
    }

    const donorExists = findDonorByIdStmt.get(donorId)
    if (!donorExists) {
        throw new ClientDonorAccessError(404, 'Donor not found')
    }

    throw new ClientDonorAccessError(403, 'Donor not assigned to client')
}

// ==================== CLIENT API ENDPOINTS ====================

// Get client's assigned donors
app.get('/api/client/:clientId/donors', authenticateClient, (req, res) => {
    const { clientId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }

    try {
        const donors = db.prepare(`
            SELECT d.*, da.priority_level, da.assigned_date,
                   COALESCE(co.status, 'Not Contacted') as last_call_status,
                   co.call_date as last_call_date,
                   co.follow_up_date,
                   COUNT(co2.id) as total_calls
            FROM donors d
            JOIN donor_assignments da ON d.id = da.donor_id
            LEFT JOIN call_outcomes co ON d.id = co.donor_id AND co.client_id = da.client_id
            LEFT JOIN call_outcomes co2 ON d.id = co2.donor_id AND co2.client_id = da.client_id
            WHERE da.client_id = ? AND da.is_active = 1
            AND (co.id IS NULL OR co.id = (
                SELECT id FROM call_outcomes co3 
                WHERE co3.donor_id = d.id AND co3.client_id = da.client_id 
                ORDER BY call_date DESC LIMIT 1
            ))
            GROUP BY d.id, da.priority_level, da.assigned_date, co.status, co.call_date, co.follow_up_date
            ORDER BY da.priority_level DESC, da.assigned_date ASC
        `).all(clientId)

        res.json(donors)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Get client-specific donor details with research and notes
app.get('/api/client/:clientId/donor/:donorId', authenticateClient, (req, res) => {
    const { clientId, donorId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }

    try {
        const donor = ensureClientHasDonor(clientId, donorId)

        // Get client-specific research
        const research = db.prepare(`
            SELECT research_category, research_content, updated_at
            FROM client_donor_research
            WHERE client_id = ? AND donor_id = ?
        `).all(clientId, donorId)

        // Get client-specific notes
        const notes = db.prepare(`
            SELECT note_type, note_content, created_at, updated_at
            FROM client_donor_notes 
            WHERE client_id = ? AND donor_id = ?
            ORDER BY created_at DESC
        `).all(clientId, donorId)

        // Get call history for this client-donor pair
        const callHistory = db.prepare(`
            SELECT * FROM call_outcomes 
            WHERE client_id = ? AND donor_id = ?
            ORDER BY call_date DESC
        `).all(clientId, donorId)

        // Get giving history
        const givingHistory = db.prepare(`
            SELECT * FROM giving_history 
            WHERE donor_id = ?
            ORDER BY year DESC
        `).all(donorId)

        res.json({
            ...donor,
            research,
            notes,
            callHistory,
            givingHistory
        })
    } catch (error) {
        if (error instanceof ClientDonorAccessError) {
            return res.status(error.status).json({ error: error.message })
        }
        res.status(500).json({ error: error.message })
    }
})

// Record call outcome
app.post('/api/client/:clientId/call-outcome', authenticateClient, (req, res) => {
    const { clientId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }
    const {
        donorId,
        status,
        outcomeNotes,
        followUpDate,
        pledgeAmount,
        contributionAmount,
        nextAction,
        callDuration,
        callQuality
    } = req.body

    try {
        ensureClientHasDonor(clientId, donorId)
    } catch (error) {
        if (error instanceof ClientDonorAccessError) {
            return res.status(error.status).json({ error: error.message })
        }
        return res.status(500).json({ error: error.message })
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO call_outcomes (
                client_id, donor_id, status, outcome_notes, follow_up_date,
                pledge_amount, contribution_amount, next_action, call_duration, call_quality
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const result = stmt.run(
            clientId, donorId, status, outcomeNotes, followUpDate,
            pledgeAmount, contributionAmount, nextAction, callDuration, callQuality
        )

        res.json({ success: true, outcomeId: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Add/update client-specific donor research
app.post('/api/client/:clientId/donor/:donorId/research', authenticateClient, (req, res) => {
    const { clientId, donorId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }
    const { category, content } = req.body

    try {
        ensureClientHasDonor(clientId, donorId)
    } catch (error) {
        if (error instanceof ClientDonorAccessError) {
            return res.status(error.status).json({ error: error.message })
        }
        return res.status(500).json({ error: error.message })
    }

    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO client_donor_research
            (client_id, donor_id, research_category, research_content, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)

        const result = stmt.run(clientId, donorId, category, content)
        res.json({ success: true, researchId: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Add client-specific donor note
app.post('/api/client/:clientId/donor/:donorId/notes', authenticateClient, (req, res) => {
    const { clientId, donorId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }
    const { noteType, noteContent, isPrivate = true } = req.body

    try {
        ensureClientHasDonor(clientId, donorId)
    } catch (error) {
        if (error instanceof ClientDonorAccessError) {
            return res.status(error.status).json({ error: error.message })
        }
        return res.status(500).json({ error: error.message })
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO client_donor_notes (client_id, donor_id, note_type, note_content, is_private)
            VALUES (?, ?, ?, ?, ?)
        `)

        const result = stmt.run(clientId, donorId, noteType, noteContent, isPrivate)
        res.json({ success: true, noteId: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/api/client/:clientId/password', authenticateClient, (req, res) => {
    const { clientId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }

    const { newPassword, currentPassword, requireChange = false } = req.body || {}

    if (typeof newPassword !== 'string' || newPassword.trim().length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters.' })
    }

    try {
        const existing = db.prepare('SELECT portal_password FROM clients WHERE id = ?').get(clientId)
        if (!existing) {
            return res.status(404).json({ error: 'Client not found' })
        }

        if (!req.isManagerSession) {
            if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, existing.portal_password)) {
                return res.status(401).json({ error: 'Current password is incorrect.' })
            }
        }

        const updated = db.prepare(`
            UPDATE clients
            SET portal_password = ?, portal_password_needs_reset = ?
            WHERE id = ?
        `)

        updated.run(
            hashPassword(newPassword.trim()),
            requireChange ? 1 : 0,
            clientId
        )

        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Start call session
app.post('/api/client/:clientId/start-session', authenticateClient, (req, res) => {
    const { clientId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO call_sessions (client_id, session_start)
            VALUES (?, CURRENT_TIMESTAMP)
        `)

        const result = stmt.run(clientId)
        res.json({ success: true, sessionId: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// End call session
app.put('/api/client/:clientId/end-session/:sessionId', authenticateClient, (req, res) => {
    const { clientId, sessionId } = req.params

    if (!clientMatchesSession(req.authenticatedClientId, clientId)) {
        return res.status(403).json({ error: 'Forbidden' })
    }
    const { callsAttempted, callsCompleted, totalPledged, sessionNotes } = req.body

    try {
        const stmt = db.prepare(`
            UPDATE call_sessions 
            SET session_end = CURRENT_TIMESTAMP, calls_attempted = ?, 
                calls_completed = ?, total_pledged = ?, session_notes = ?
            WHERE id = ? AND client_id = ?
        `)

        stmt.run(callsAttempted, callsCompleted, totalPledged, sessionNotes, sessionId, clientId)
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== EXISTING ENDPOINTS (Enhanced) ====================

// Get clients
app.get('/api/clients', authenticateManager, (req, res) => {
    try {
        const clients = db.prepare(`
            SELECT c.*, 
                   COUNT(DISTINCT da.donor_id) as assigned_donors
            FROM clients c
            LEFT JOIN donor_assignments da ON c.id = da.client_id AND da.is_active = 1
            GROUP BY c.id
            ORDER BY c.name
        `).all()
        res.json(sanitizeClientCollection(clients))
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

const sanitizeClientField = (value) => {
    if (value === null || value === undefined) return null
    const trimmed = String(value).trim()
    return trimmed ? trimmed : null
}

const resolveFundraisingGoal = (input) => {
    if (input === null || input === undefined || input === '') {
        return { value: null, error: null }
    }
    const numericGoal = Number(input)
    if (Number.isNaN(numericGoal)) {
        return { value: null, error: 'fundraisingGoal must be numeric' }
    }
    return { value: numericGoal, error: null }
}

// Create client
app.post('/api/clients', authenticateManager, (req, res) => {
    const payload = req.body || {}

    const name = sanitizeClientField(payload.name)
    if (!name) return res.status(400).json({ error: 'name required' })

    const candidate = sanitizeClientField(payload.candidate)
    const office = sanitizeClientField(payload.office)
    const managerName = sanitizeClientField(payload.managerName ?? payload.manager_name)
    const contactEmail = sanitizeClientField(payload.contactEmail ?? payload.contact_email)
    const contactPhone = sanitizeClientField(payload.contactPhone ?? payload.contact_phone)
    const launchDate = sanitizeClientField(payload.launchDate ?? payload.launch_date)
    const notes = sanitizeClientField(payload.notes)
    const portalPasswordHash = hashPassword(DEFAULT_CLIENT_PORTAL_PASSWORD)

    const goalInput = payload.fundraisingGoal ?? payload.fundraising_goal
    const { value: fundraisingGoal, error: goalError } = resolveFundraisingGoal(goalInput)
    if (goalError) {
        return res.status(400).json({ error: goalError })
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO clients(
                name,
                candidate,
                office,
                manager_name,
                contact_email,
                contact_phone,
                launch_date,
                fundraising_goal,
                notes,
                portal_password,
                portal_password_needs_reset
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `)
        const result = stmt.run(
            name,
            candidate,
            office,
            managerName,
            contactEmail,
            contactPhone,
            launchDate,
            fundraisingGoal,
            notes,
            portalPasswordHash
        )
        res.json({ id: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Update client
app.put('/api/clients/:clientId', authenticateManager, (req, res) => {
    const clientId = req.params.clientId
    const payload = req.body || {}

    const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
    if (!existing) {
        return res.status(404).json({ error: 'Client not found' })
    }

    const name = sanitizeClientField(payload.name)
    if (!name) {
        return res.status(400).json({ error: 'name required' })
    }

    const candidate = sanitizeClientField(payload.candidate)
    const office = sanitizeClientField(payload.office)
    const managerName = sanitizeClientField(payload.managerName ?? payload.manager_name)
    const contactEmail = sanitizeClientField(payload.contactEmail ?? payload.contact_email)
    const contactPhone = sanitizeClientField(payload.contactPhone ?? payload.contact_phone)
    const launchDate = sanitizeClientField(payload.launchDate ?? payload.launch_date)
    const notes = sanitizeClientField(payload.notes)
    const portalPasswordInput = typeof payload.portalPassword === 'string' ? payload.portalPassword.trim() : ''
    const resetPortalPassword = payload.resetPortalPassword === true
    const shouldUpdatePortalPassword = resetPortalPassword || Boolean(portalPasswordInput)
    let portalPasswordHash = null
    let portalPasswordNeedsReset = null

    if (shouldUpdatePortalPassword) {
        if (resetPortalPassword || !portalPasswordInput) {
            portalPasswordHash = hashPassword(DEFAULT_CLIENT_PORTAL_PASSWORD)
            portalPasswordNeedsReset = 1
        } else {
            portalPasswordHash = hashPassword(portalPasswordInput)
            portalPasswordNeedsReset = payload.requirePasswordReset === true ? 1 : 0
        }
    }

    const goalInput = payload.fundraisingGoal ?? payload.fundraising_goal
    const { value: fundraisingGoal, error: goalError } = resolveFundraisingGoal(goalInput)
    if (goalError) {
        return res.status(400).json({ error: goalError })
    }

    try {
        const sql = `
            UPDATE clients
            SET name = ?,
                candidate = ?,
                office = ?,
                manager_name = ?,
                contact_email = ?,
                contact_phone = ?,
                launch_date = ?,
                fundraising_goal = ?,
                notes = ?${shouldUpdatePortalPassword ? ', portal_password = ?, portal_password_needs_reset = ?' : ''}
            WHERE id = ?
        `

        const params = [
            name,
            candidate,
            office,
            managerName,
            contactEmail,
            contactPhone,
            launchDate,
            fundraisingGoal,
            notes,
        ]

        if (shouldUpdatePortalPassword) {
            params.push(portalPasswordHash, portalPasswordNeedsReset)
        }

        params.push(clientId)

        const stmt = db.prepare(sql)
        stmt.run(...params)

        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.delete('/api/clients/:clientId', authenticateManager, (req, res) => {
    const clientId = req.params.clientId

    try {
        const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
        if (!existing) {
            return res.status(404).json({ error: 'Client not found' })
        }

        const removeClient = db.transaction((id) => {
            db.prepare('DELETE FROM donor_assignments WHERE client_id = ?').run(id)
            db.prepare('DELETE FROM client_donor_research WHERE client_id = ?').run(id)
            db.prepare('DELETE FROM client_donor_notes WHERE client_id = ?').run(id)
            db.prepare('DELETE FROM call_outcomes WHERE client_id = ?').run(id)
            db.prepare('DELETE FROM call_sessions WHERE client_id = ?').run(id)
            db.prepare('DELETE FROM clients WHERE id = ?').run(id)
        })

        removeClient(clientId)
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Enhanced donors endpoint with assignment info
app.get('/api/clients/:clientId/donors-legacy', authenticateManager, (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT d.*, da.assigned_date, da.priority_level
            FROM donors d
            JOIN donor_assignments da ON d.id = da.donor_id
            WHERE da.client_id = ? AND da.is_active = 1
            ORDER BY da.priority_level DESC, d.created_at DESC
        `)
        res.json(stmt.all(req.params.clientId))
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Create donor
app.post('/api/clients/:clientId/donors', authenticateManager, (req, res) => {
    const c = req.params.clientId
    const d = req.body || {}
    if (!d.name) return res.status(400).json({ error: 'name required' })

    try {
        const donorStmt = db.prepare(`
            INSERT INTO donors(
                name, phone, email, street_address, address_line2, city, state, postal_code,
                employer, occupation, job_title, bio, photo_url, tags, suggested_ask, last_gift_note
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        const street = cleanString(d.street_address ?? d.street)
        const addressLine2 = cleanString(d.address_line2 ?? d.addressLine2)
        const city = cleanString(d.city)
        const state = cleanString(d.state ?? d.region)
        const postal = cleanString(d.postal_code ?? d.postalCode)
        const donorResult = donorStmt.run(
            d.name,
            d.phone,
            d.email,
            street,
            addressLine2,
            city,
            state,
            postal,
            d.employer,
            d.occupation,
            d.job_title || d.title || null,
            d.bio, d.photo_url, d.tags, d.suggested_ask, d.last_gift_note
        )

        // Auto-assign to the client
        const assignStmt = db.prepare(`
            INSERT INTO donor_assignments (client_id, donor_id, assigned_by)
            VALUES (?, ?, ?)
        `)
        assignStmt.run(c, donorResult.lastInsertRowid, 'auto-assign')

        res.json({ id: donorResult.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.delete('/api/donors/:donorId', authenticateManager, (req, res) => {
    const donorId = req.params.donorId

    try {
        const existing = db.prepare('SELECT id FROM donors WHERE id = ?').get(donorId)
        if (!existing) {
            return res.status(404).json({ error: 'Donor not found' })
        }

        const removeDonor = db.transaction((id) => {
            db.prepare('DELETE FROM donor_assignments WHERE donor_id = ?').run(id)
            db.prepare('DELETE FROM client_donor_research WHERE donor_id = ?').run(id)
            db.prepare('DELETE FROM client_donor_notes WHERE donor_id = ?').run(id)
            db.prepare('DELETE FROM call_outcomes WHERE donor_id = ?').run(id)
            db.prepare('DELETE FROM giving_history WHERE donor_id = ?').run(id)
            db.prepare('DELETE FROM donors WHERE id = ?').run(id)
        })

        removeDonor(donorId)
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.get('/api/donors/:donorId', authenticateManager, (req, res) => {
    const donorId = req.params.donorId

    try {
        const donor = getDonorDetail(donorId)
        if (!donor) {
            return res.status(404).json({ error: 'Donor not found' })
        }

        res.json(donor)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/api/donors', authenticateManager, (req, res) => {
    const payload = req.body || {}
    const assignedClientIds = Array.isArray(payload.assignedClientIds)
        ? payload.assignedClientIds.filter((id) => id !== undefined && id !== null)
        : []

    if (!payload.firstName && !payload.lastName && !payload.name) {
        return res.status(400).json({ error: 'Donor name is required' })
    }

    if (!assignedClientIds.length) {
        return res.status(400).json({ error: 'At least one client assignment is required' })
    }

    const numericClientIds = assignedClientIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    if (!numericClientIds.length) {
        return res.status(400).json({ error: 'Assigned clients are invalid' })
    }

    const ownerClientId = numericClientIds[0]
    const name = payload.name || `${payload.firstName || ''} ${payload.lastName || ''}`.trim()

    try {
        const stmt = db.prepare(`
            INSERT INTO donors (
                client_id, name, first_name, last_name, phone, email,
                street_address, address_line2, city, state, postal_code,
                employer, occupation, job_title, tags, suggested_ask, last_gift_note,
                notes, bio, photo_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const street = cleanString(payload.street ?? payload.streetAddress)
        const addressLine2 = cleanString(payload.addressLine2)
        const city = cleanString(payload.city)
        const state = cleanString(payload.state)
        const postal = cleanString(payload.postalCode ?? payload.postal)

        const result = stmt.run(
            ownerClientId,
            name,
            payload.firstName || null,
            payload.lastName || null,
            payload.phone || null,
            payload.email || null,
            street,
            addressLine2,
            city,
            state,
            postal,
            payload.company || null,
            payload.industry || null,
            payload.title || payload.jobTitle || null,
            payload.tags || null,
            payload.ask !== undefined && payload.ask !== null && payload.ask !== '' ? Number(payload.ask) : null,
            payload.lastGift || null,
            payload.notes || null,
            payload.biography || null,
            payload.pictureUrl || null
        )

        const donorId = result.lastInsertRowid

        const assignStmt = db.prepare(`
            INSERT OR REPLACE INTO donor_assignments (client_id, donor_id, assigned_by, is_active)
            VALUES (?, ?, ?, 1)
        `)
        const assignTransaction = db.transaction((clientIds) => {
            clientIds.forEach((clientId) => {
                assignStmt.run(clientId, donorId, payload.createdBy || 'donor-editor')
            })
        })
        assignTransaction(numericClientIds)

        const historyEntries = Array.isArray(payload.history) ? payload.history : []
        if (historyEntries.length) {
            const historyStmt = db.prepare(`
                INSERT INTO giving_history (donor_id, year, candidate, office_sought, amount)
                VALUES (?, ?, ?, ?, ?)
            `)
            const historyTransaction = db.transaction((entries) => {
                entries.forEach((entry) => {
                    if (!entry) return
                    const year = Number(entry.year)
                    const candidate = entry.candidate ? String(entry.candidate) : ''
                    const officeSought = entry.officeSought || entry.office_sought || ''
                    const amount = entry.amount === null || entry.amount === undefined || entry.amount === ''
                        ? null
                        : Number(entry.amount)
                    if (!candidate || Number.isNaN(year) || amount === null || Number.isNaN(amount)) {
                        return
                    }
                    historyStmt.run(donorId, year, candidate, officeSought || null, amount)
                })
            })
            historyTransaction(historyEntries)
        }

        const donor = getDonorDetail(donorId)
        res.status(201).json(donor)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.put('/api/donors/:donorId', authenticateManager, (req, res) => {
    const donorId = req.params.donorId
    const payload = req.body || {}

    try {
        const existing = db.prepare('SELECT * FROM donors WHERE id = ?').get(donorId)
        if (!existing) {
            return res.status(404).json({ error: 'Donor not found' })
        }

        const firstName = payload.firstName ?? existing.first_name
        const lastName = payload.lastName ?? existing.last_name
        const name = payload.name || `${firstName || ''} ${lastName || ''}`.trim() || existing.name
        const suggestedAsk =
            payload.ask === null || payload.ask === undefined || payload.ask === ''
                ? null
                : Number(payload.ask)
        const jobTitle = payload.title ?? payload.jobTitle ?? existing.job_title
        const streetInput = payload.street ?? payload.streetAddress
        const addressLine2Input = payload.addressLine2
        const cityValue = payload.city === undefined ? existing.city : cleanString(payload.city)
        const stateInput = payload.state
        const postalInput = payload.postalCode ?? payload.postal
        const streetValue = streetInput === undefined ? existing.street_address : cleanString(streetInput)
        const addressLine2Value = addressLine2Input === undefined ? existing.address_line2 : cleanString(addressLine2Input)
        const stateValue = stateInput === undefined ? existing.state : cleanString(stateInput)
        const postalValue = postalInput === undefined ? existing.postal_code : cleanString(postalInput)

        const stmt = db.prepare(`
            UPDATE donors
            SET name = ?,
                first_name = ?,
                last_name = ?,
                phone = ?,
                email = ?,
                street_address = ?,
                address_line2 = ?,
                city = ?,
                state = ?,
                postal_code = ?,
                employer = ?,
                occupation = ?,
                job_title = ?,
                tags = ?,
                suggested_ask = ?,
                last_gift_note = ?,
                notes = ?,
                bio = ?,
                photo_url = ?
            WHERE id = ?
        `)

        stmt.run(
            name,
            firstName || null,
            lastName || null,
            payload.phone ?? existing.phone,
            payload.email ?? existing.email,
            streetValue,
            addressLine2Value,
            cityValue,
            stateValue,
            postalValue,
            payload.company ?? existing.employer,
            payload.industry ?? existing.occupation,
            jobTitle,
            payload.tags ?? existing.tags,
            suggestedAsk,
            payload.lastGift ?? existing.last_gift_note,
            payload.notes ?? existing.notes,
            payload.biography ?? existing.bio,
            payload.pictureUrl ?? existing.photo_url,
            donorId
        )

        const donor = getDonorDetail(donorId)
        res.json(donor)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

function getDonorDetail(donorId) {
    const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(donorId)
    if (!donor) {
        return null
    }

    let history = []
    try {
        history = db.prepare(`
            SELECT id, year, candidate, office_sought, amount, created_at
            FROM giving_history
            WHERE donor_id = ?
            ORDER BY year DESC, created_at DESC
        `).all(donorId)
    } catch (error) {
        console.warn('Failed to load giving history for donor', donorId, error.message)
        history = []
    }

    let assignmentRows = []
    try {
        assignmentRows = db.prepare(`
            SELECT c.id, c.name
            FROM donor_assignments da
            JOIN clients c ON da.client_id = c.id
            WHERE da.donor_id = ? AND da.is_active = 1
            ORDER BY c.name
        `).all(donorId)
    } catch (error) {
        console.warn('Failed to load donor assignments for donor', donorId, error.message)
        assignmentRows = []
    }

    let noteRows = []
    try {
        noteRows = db.prepare(`
            SELECT
                n.id,
                n.client_id,
                c.name AS client_name,
                c.candidate AS client_candidate,
                n.note_type,
                n.note_content,
                n.is_private,
                n.is_important,
                n.created_at,
                n.updated_at
            FROM client_donor_notes n
            LEFT JOIN clients c ON n.client_id = c.id
            WHERE n.donor_id = ?
            ORDER BY n.created_at DESC
        `).all(donorId)
    } catch (error) {
        console.warn('Failed to load client donor notes for donor', donorId, error.message)
        noteRows = []
    }

    const notesByClient = new Map()
    noteRows.forEach((row) => {
        const key = row.client_id == null ? 'unassigned' : String(row.client_id)
        if (!notesByClient.has(key)) {
            notesByClient.set(key, {
                client_id: row.client_id,
                client_name: row.client_name || row.client_candidate || 'Unknown candidate',
                client_candidate: row.client_candidate || row.client_name || 'Unknown candidate',
                notes: [],
            })
        }
        const group = notesByClient.get(key)
        group.notes.push({
            id: row.id,
            note_type: row.note_type,
            note_content: row.note_content,
            is_private: Boolean(row.is_private),
            is_important: Boolean(row.is_important),
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    })

    const clientNotes = Array.from(notesByClient.values()).sort((a, b) => {
        return (a.client_name || '').localeCompare(b.client_name || '')
    })

    const assignedClientIds = assignmentRows.map((row) => row.id).join(',')
    const assignedClientNames = assignmentRows.map((row) => row.name).join(', ')

    return {
        ...donor,
        history,
        assigned_client_ids: assignedClientIds,
        assigned_clients: assignedClientNames,
        client_notes: clientNotes,
    }
}

function buildGivingSummary(rows = []) {
    const donors = new Map()
    const years = new Map()
    let totalAmount = 0
    let contributionCount = 0

    rows.forEach((row) => {
        if (!row) return
        const donorId = row.donor_id != null ? String(row.donor_id) : null
        const donorName = row.donor_name || ''
        const amountValue = Number(row.amount)
        const amount = Number.isFinite(amountValue) ? amountValue : 0
        const yearValue = Number(row.year)
        const year = Number.isFinite(yearValue) ? yearValue : null
        const candidate = row.candidate || null
        const officeSought = row.office_sought || row.officeSought || null

        contributionCount += 1
        totalAmount += amount

        if (donorId) {
            if (!donors.has(donorId)) {
                donors.set(donorId, {
                    donorId,
                    donorName: donorName || 'Unnamed donor',
                    totalAmount: 0,
                    contributionCount: 0,
                    contributions: []
                })
            }
            const donorEntry = donors.get(donorId)
            donorEntry.totalAmount += amount
            donorEntry.contributionCount += 1
            donorEntry.contributions.push({
                id: row.id != null ? String(row.id) : null,
                year,
                amount,
                candidate,
                officeSought,
                createdAt: row.created_at || null
            })
        }

        const yearKey = year === null ? '__unspecified__' : String(year)
        if (!years.has(yearKey)) {
            years.set(yearKey, {
                year,
                donorIds: new Set(),
                contributionCount: 0,
                totalAmount: 0
            })
        }
        const yearEntry = years.get(yearKey)
        yearEntry.contributionCount += 1
        yearEntry.totalAmount += amount
        if (donorId) {
            yearEntry.donorIds.add(donorId)
        }
    })

    const donorCollection = Array.from(donors.values()).map((donor) => {
        donor.contributions.sort((a, b) => {
            const yearA = a.year === null ? -Infinity : a.year
            const yearB = b.year === null ? -Infinity : b.year
            if (yearA !== yearB) {
                return yearB - yearA
            }
            if (a.amount !== b.amount) {
                return b.amount - a.amount
            }
            const candidateA = (a.candidate || '').toLowerCase()
            const candidateB = (b.candidate || '').toLowerCase()
            if (candidateA !== candidateB) {
                return candidateA < candidateB ? -1 : 1
            }
            return 0
        })
        return donor
    })

    donorCollection.sort((a, b) => {
        if (b.totalAmount !== a.totalAmount) {
            return b.totalAmount - a.totalAmount
        }
        return (a.donorName || '').localeCompare(b.donorName || '')
    })

    const yearCollection = Array.from(years.values()).map((entry) => ({
        year: entry.year,
        donorCount: entry.donorIds.size,
        contributionCount: entry.contributionCount,
        totalAmount: entry.totalAmount
    }))

    yearCollection.sort((a, b) => {
        if (a.year === null && b.year === null) return 0
        if (a.year === null) return 1
        if (b.year === null) return -1
        return b.year - a.year
    })

    return {
        totals: {
            totalAmount,
            contributionCount,
            donorCount: donorCollection.length
        },
        donors: donorCollection,
        years: yearCollection
    }
}

app.get('/api/giving/candidates/:candidate/summary', authenticateManager, (req, res) => {
    const requested = (req.params.candidate || '').trim()
    if (!requested) {
        return res.status(400).json({ error: 'candidate parameter required' })
    }

    try {
        const contributions = db.prepare(`
            SELECT gh.id, gh.donor_id, gh.year, gh.candidate, gh.office_sought, gh.amount, gh.created_at,
                   d.name AS donor_name
            FROM giving_history gh
            JOIN donors d ON d.id = gh.donor_id
            WHERE LOWER(TRIM(gh.candidate)) = LOWER(TRIM(?))
            ORDER BY gh.year DESC, gh.created_at DESC
        `).all(requested)

        const summary = buildGivingSummary(contributions)
        const displayCandidate = contributions.find((row) => row && row.candidate)?.candidate || requested

        res.json({
            candidate: displayCandidate,
            requestedCandidate: requested,
            totals: summary.totals,
            years: summary.years,
            donors: summary.donors,
        })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.get('/api/giving/search', authenticateManager, (req, res) => {
    const year = parseInteger(req.query.year)
    const amount = parseNonNegativeNumber(req.query.amount)
    let minAmount = parseNonNegativeNumber(req.query.minAmount)
    let maxAmount = parseNonNegativeNumber(req.query.maxAmount)

    if (amount !== null) {
        minAmount = null
        maxAmount = null
    } else if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
        const temp = minAmount
        minAmount = maxAmount
        maxAmount = temp
    }

    if (year === null && amount === null && minAmount === null && maxAmount === null) {
        return res.status(400).json({ error: 'Provide at least one search filter (year or amount).' })
    }

    const filters = []
    const params = []

    if (year !== null) {
        filters.push('gh.year = ?')
        params.push(year)
    }
    if (amount !== null) {
        filters.push('gh.amount = ?')
        params.push(amount)
    } else {
        if (minAmount !== null) {
            filters.push('gh.amount >= ?')
            params.push(minAmount)
        }
        if (maxAmount !== null) {
            filters.push('gh.amount <= ?')
            params.push(maxAmount)
        }
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

    try {
        const contributions = db.prepare(`
            SELECT gh.id, gh.donor_id, gh.year, gh.candidate, gh.office_sought, gh.amount, gh.created_at,
                   d.name AS donor_name
            FROM giving_history gh
            JOIN donors d ON d.id = gh.donor_id
            ${whereClause}
            ORDER BY d.name COLLATE NOCASE, gh.year DESC, gh.created_at DESC
        `).all(...params)

        const summary = buildGivingSummary(contributions)

        res.json({
            filters: {
                year,
                amount,
                minAmount: amount !== null ? null : minAmount,
                maxAmount: amount !== null ? null : maxAmount,
            },
            totals: summary.totals,
            years: summary.years,
            donors: summary.donors,
        })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Get giving history
app.get('/api/donors/:donorId/giving', authenticateManager, (req, res) => {
    const stmt = db.prepare('SELECT * FROM giving_history WHERE donor_id = ? ORDER BY year DESC, created_at DESC')
    res.json(stmt.all(req.params.donorId))
})

// Add giving history
app.post('/api/donors/:donorId/giving', authenticateManager, (req, res) => {
    const { year, candidate, amount } = req.body || {}
    const officeSought = cleanString(req.body?.officeSought ?? req.body?.office_sought)
    const yearValue = Number.parseInt(year, 10)
    const candidateName = cleanString(candidate)
    const amountValue = Number(amount)
    if (!Number.isInteger(yearValue) || !candidateName || !Number.isFinite(amountValue)) {
        return res.status(400).json({ error: 'year, candidate, amount required' })
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO giving_history(donor_id, year, candidate, office_sought, amount)
            VALUES (?,?,?,?,?)
        `)
        const result = stmt.run(req.params.donorId, yearValue, candidateName, officeSought, amountValue)
        res.json({ id: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.patch('/api/donors/:donorId/giving/:entryId', authenticateManager, (req, res) => {
    const { donorId, entryId } = req.params
    const { year, candidate, amount } = req.body || {}
    const officeSought = cleanString(req.body?.officeSought ?? req.body?.office_sought)
    const yearValue = Number.parseInt(year, 10)
    const candidateName = cleanString(candidate)
    const amountValue = Number(amount)
    if (!Number.isInteger(yearValue) || !candidateName || !Number.isFinite(amountValue)) {
        return res.status(400).json({ error: 'year, candidate, amount required' })
    }

    try {
        const existing = db.prepare('SELECT id FROM giving_history WHERE id = ? AND donor_id = ?').get(entryId, donorId)
        if (!existing) {
            return res.status(404).json({ error: 'Contribution not found' })
        }

        const stmt = db.prepare(`
            UPDATE giving_history
            SET year = ?, candidate = ?, office_sought = ?, amount = ?
            WHERE id = ? AND donor_id = ?
        `)
        stmt.run(yearValue, candidateName, officeSought, amountValue, entryId, donorId)
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.delete('/api/donors/:donorId/giving/:entryId', authenticateManager, (req, res) => {
    const { donorId, entryId } = req.params

    try {
        const existing = db.prepare('SELECT id FROM giving_history WHERE id = ? AND donor_id = ?').get(entryId, donorId)
        if (!existing) {
            return res.status(404).json({ error: 'Contribution not found' })
        }

        db.prepare('DELETE FROM giving_history WHERE id = ?').run(entryId)
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Legacy interactions endpoint (now uses call_outcomes)
app.get('/api/donors/:donorId/interactions', authenticateManager, (req, res) => {
    const { clientId } = req.query
    let stmt, params

    try {
        if (clientId) {
            stmt = db.prepare('SELECT * FROM call_outcomes WHERE donor_id = ? AND client_id = ? ORDER BY call_date DESC')
            params = [req.params.donorId, clientId]
        } else {
            stmt = db.prepare('SELECT * FROM call_outcomes WHERE donor_id = ? ORDER BY call_date DESC')
            params = [req.params.donorId]
        }

        res.json(stmt.all(...params))
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Legacy interaction creation (maps to call_outcomes)
app.post('/api/donors/:donorId/interactions', authenticateManager, (req, res) => {
    const d = req.body || {}
    const { clientId } = req.query

    if (!d.status) return res.status(400).json({ error: 'status required' })

    try {
        const stmt = db.prepare(`
            INSERT INTO call_outcomes(donor_id, client_id, status, outcome_notes, follow_up_date, pledge_amount, contribution_amount)
            VALUES (?,?,?,?,?,?,?)
        `)
        const result = stmt.run(
            req.params.donorId, clientId, d.status, d.notes, 
            d.followup_date, d.pledge_amount, d.contribution_amount
        )
        res.json({ id: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Handle all other routes by serving the index.html file (SPA support)
// This replaces the problematic app.get('*', ...) route
app.use((req, res) => {
    const indexPath = path.join(__dirname, '..', 'public', 'index.html')
    console.log('Catch-all route triggered for:', req.url, 'looking for:', indexPath)
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath)
    } else {
        res.status(404).send(`
            <h1>File Not Found</h1>
            <p>Looking for index.html at: ${indexPath}</p>
            <p>Please ensure your index.html file is in the 'public' directory.</p>
            <p>Current server directory: ${__dirname}</p>
            <p>Static files served from: ${path.join(__dirname, '..', 'public')}</p>
        `)
    }
})

const port = process.env.PORT || 3000
let serverInstance = null

if (process.env.NODE_ENV !== 'test') {
    serverInstance = app.listen(port, () => {
        console.log(`Enhanced Campaign Call Time System running at http://localhost:${port}`)
        console.log(`Server directory: ${__dirname}`)
        console.log(`Static files served from: ${path.join(__dirname, '..', 'public')}`)
        console.log(`Database: ${dbPath}`)

        // Check if files exist
        const publicDir = path.join(__dirname, '..', 'public')
        const indexFile = path.join(publicDir, 'index.html')

        console.log('\nFile check:')
        console.log(`Public directory exists: ${fs.existsSync(publicDir)}`)
        console.log(`index.html exists: ${fs.existsSync(indexFile)}`)
        console.log(`Database file exists: ${fs.existsSync(dbPath)}`)

        if (fs.existsSync(publicDir)) {
            const files = fs.readdirSync(publicDir)
            console.log(`Files in public directory: ${files.join(', ')}`)
        }
    })
}

module.exports = {
    app,
    db,
    ensureClientHasDonor,
    ClientDonorAccessError,
    server: serverInstance
}
