const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const app = express()
app.use(cors())
app.use(express.json())

// serve your existing frontend
app.use(express.static(path.join(__dirname, '..', 'public')))

// open or create the SQLite DB file
const dbPath = path.join(__dirname, '..', 'data', 'campaign.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// create tables if needed (from schema.sql) + ensure fallback
const schemaPath = path.join(__dirname, '..', 'data', 'schema.sql')
try {
  const exists = fs.existsSync(schemaPath)
  console.log('Schema at:', schemaPath, 'exists?', exists)
  if (exists) {
    const sql = fs.readFileSync(schemaPath, 'utf8')
    db.exec(sql)
    console.log('Schema applied from schema.sql')
  }
} catch (e) {
  console.warn('Could not apply schema.sql:', e.message)
}

// Ensure tables exist even if schema.sql wasn’t found/readable
db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sheet_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS donors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  city TEXT,
  employer TEXT,
  occupation TEXT,
  bio TEXT,
  photo_url TEXT,
  tags TEXT,
  suggested_ask REAL,
  last_gift_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS giving_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  candidate TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  voicemail_date DATE,
  followup_date DATE,
  pledge_amount REAL,
  contribution_amount REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_donors_client ON donors(client_id);
CREATE INDEX IF NOT EXISTS idx_giving_donor ON giving_history(donor_id);
CREATE INDEX IF NOT EXISTS idx_interact_donor ON interactions(donor_id);
`)
console.log('Schema ensured via inline SQL')


/* ---- Minimal API endpoints ---- */

// Clients
app.get('/api/clients', (req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY name').all())
})
app.post('/api/clients', (req, res) => {
  const { name } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  const info = db.prepare('INSERT INTO clients(name) VALUES (?)').run(name)
  res.json({ id: info.lastInsertRowid })
})

// Donors
app.get('/api/clients/:clientId/donors', (req, res) => {
  const stmt = db.prepare('SELECT * FROM donors WHERE client_id = ? ORDER BY created_at DESC')
  res.json(stmt.all(req.params.clientId))
})
app.post('/api/clients/:clientId/donors', (req, res) => {
  const c = req.params.clientId
  const d = req.body || {}
  if (!d.name) return res.status(400).json({ error: 'name required' })
  const info = db.prepare(`
    INSERT INTO donors(client_id,name,phone,email,city,employer,occupation,bio,photo_url,tags,suggested_ask,last_gift_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(c, d.name, d.phone, d.email, d.city, d.employer, d.occupation, d.bio, d.photo_url, d.tags, d.suggested_ask, d.last_gift_note)
  res.json({ id: info.lastInsertRowid })
})

// Giving history
app.get('/api/donors/:donorId/giving', (req, res) => {
  const stmt = db.prepare('SELECT * FROM giving_history WHERE donor_id = ? ORDER BY year DESC, created_at DESC')
  res.json(stmt.all(req.params.donorId))
})
app.post('/api/donors/:donorId/giving', (req, res) => {
  const { year, candidate, amount } = req.body || {}
  if (!year || !candidate || amount == null) return res.status(400).json({ error: 'year, candidate, amount required' })
  const info = db.prepare(`
    INSERT INTO giving_history(donor_id, year, candidate, amount)
    VALUES (?,?,?,?)
  `).run(req.params.donorId, year, candidate, amount)
  res.json({ id: info.lastInsertRowid })
})

// Interactions (call outcomes)
app.get('/api/donors/:donorId/interactions', (req, res) => {
  const stmt = db.prepare('SELECT * FROM interactions WHERE donor_id = ? ORDER BY created_at DESC')
  res.json(stmt.all(req.params.donorId))
})
app.post('/api/donors/:donorId/interactions', (req, res) => {
  const d = req.body || {}
  if (!d.status) return res.status(400).json({ error: 'status required' })
  const info = db.prepare(`
    INSERT INTO interactions(donor_id, status, notes, voicemail_date, followup_date, pledge_amount, contribution_amount)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.params.donorId, d.status, d.notes, d.voicemail_date, d.followup_date, d.pledge_amount, d.contribution_amount)
  res.json({ id: info.lastInsertRowid })
})

// fallback to index.html
// fallback to index.html for any unmatched route
app.use((_, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})


const port = 3000
app.listen(port, () => console.log(`CallTime Desk running at http://localhost:${port}`))
