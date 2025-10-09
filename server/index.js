const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const app = express()
app.use(cors())
app.use(express.json())

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')))

// Database can be in either server/ or data/ directory - let's check both
const serverDbPath = path.join(__dirname, 'campaign.db')
const dataDbPath = path.join(__dirname, '..', 'data', 'campaign.db')

const candidateDatabases = [
    { path: dataDbPath, label: 'data directory' },
    { path: serverDbPath, label: 'server directory' }
]

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
const enhanceSchema = () => {
    try {
        // Add new tables for enhanced functionality
        db.exec(`
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

            -- Donor assignments (which clients can see which donors)
            CREATE TABLE IF NOT EXISTS donor_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                donor_id INTEGER NOT NULL,
                assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                assigned_by TEXT,
                priority_level INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
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
        console.log('Enhanced schema applied successfully')
    } catch (error) {
        console.error('Schema enhancement error:', error.message)
    }
}

// Apply enhanced schema
enhanceSchema()

// ==================== MANAGER API ENDPOINTS ====================

// Get manager dashboard overview
app.get('/api/manager/overview', (req, res) => {
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
            clients,
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
app.get('/api/manager/donors', (req, res) => {
    try {
        const donors = db.prepare(`
            SELECT d.*,
                   GROUP_CONCAT(c.name) as assigned_clients,
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
app.post('/api/manager/assign-donor', (req, res) => {
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
app.delete('/api/manager/assign-donor/:clientId/:donorId', (req, res) => {
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
app.post('/api/manager/bulk-assign', (req, res) => {
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

// ==================== CLIENT API ENDPOINTS ====================

// Get client's assigned donors
app.get('/api/client/:clientId/donors', (req, res) => {
    const { clientId } = req.params

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
app.get('/api/client/:clientId/donor/:donorId', (req, res) => {
    const { clientId, donorId } = req.params

    try {
        // Get donor basic info
        const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(donorId)
        if (!donor) {
            return res.status(404).json({ error: 'Donor not found' })
        }

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
        res.status(500).json({ error: error.message })
    }
})

// Record call outcome
app.post('/api/client/:clientId/call-outcome', (req, res) => {
    const { clientId } = req.params
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
app.post('/api/client/:clientId/donor/:donorId/research', (req, res) => {
    const { clientId, donorId } = req.params
    const { category, content } = req.body

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
app.post('/api/client/:clientId/donor/:donorId/notes', (req, res) => {
    const { clientId, donorId } = req.params
    const { noteType, noteContent, isPrivate = true } = req.body

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

// Start call session
app.post('/api/client/:clientId/start-session', (req, res) => {
    const { clientId } = req.params

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
app.put('/api/client/:clientId/end-session/:sessionId', (req, res) => {
    const { clientId, sessionId } = req.params
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
app.get('/api/clients', (req, res) => {
    try {
        const clients = db.prepare(`
            SELECT c.*, 
                   COUNT(DISTINCT da.donor_id) as assigned_donors
            FROM clients c
            LEFT JOIN donor_assignments da ON c.id = da.client_id AND da.is_active = 1
            GROUP BY c.id
            ORDER BY c.name
        `).all()
        res.json(clients)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Create client
app.post('/api/clients', (req, res) => {
    const { name, sheet_url } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name required' })

    try {
        const stmt = db.prepare(`
            INSERT INTO clients(name, sheet_url)
            VALUES (?, ?)
        `)
        const result = stmt.run(name, sheet_url)
        res.json({ id: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.delete('/api/clients/:clientId', (req, res) => {
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
app.get('/api/clients/:clientId/donors-legacy', (req, res) => {
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
app.post('/api/clients/:clientId/donors', (req, res) => {
    const c = req.params.clientId
    const d = req.body || {}
    if (!d.name) return res.status(400).json({ error: 'name required' })

    try {
        const donorStmt = db.prepare(`
            INSERT INTO donors(name,phone,email,city,employer,occupation,bio,photo_url,tags,suggested_ask,last_gift_note)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `)
        const donorResult = donorStmt.run(
            d.name, d.phone, d.email, d.city, d.employer, d.occupation, 
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

app.delete('/api/donors/:donorId', (req, res) => {
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

// Get giving history
app.get('/api/donors/:donorId/giving', (req, res) => {
    const stmt = db.prepare('SELECT * FROM giving_history WHERE donor_id = ? ORDER BY year DESC, created_at DESC')
    res.json(stmt.all(req.params.donorId))
})

// Add giving history
app.post('/api/donors/:donorId/giving', (req, res) => {
    const { year, candidate, amount } = req.body || {}
    if (!year || !candidate || amount == null) return res.status(400).json({ error: 'year, candidate, amount required' })

    try {
        const stmt = db.prepare(`
            INSERT INTO giving_history(donor_id, year, candidate, amount)
            VALUES (?,?,?,?)
        `)
        const result = stmt.run(req.params.donorId, year, candidate, amount)
        res.json({ id: result.lastInsertRowid })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Legacy interactions endpoint (now uses call_outcomes)
app.get('/api/donors/:donorId/interactions', (req, res) => {
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
app.post('/api/donors/:donorId/interactions', (req, res) => {
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
app.listen(port, () => {
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