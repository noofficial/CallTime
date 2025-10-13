const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

function ensureIntegrationDatabase() {
  if (global.__CALLTIME_TEST_DB__) {
    process.env.NODE_ENV = 'test';
    process.env.CALLTIME_DB_PATH = global.__CALLTIME_TEST_DB__.dbPath;
    if (!process.env.MANAGER_PASSWORD) {
      process.env.MANAGER_PASSWORD = 'test-manager-password';
    }
    return global.__CALLTIME_TEST_DB__;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calltime-test-'));
  const dbPath = path.join(tmpDir, 'campaign.db');
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      candidate TEXT,
      office TEXT,
      manager_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      launch_date TEXT,
      fundraising_goal REAL,
      notes TEXT,
      portal_password TEXT,
      portal_password_needs_reset INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      name TEXT,
      exclusive_donor INTEGER DEFAULT 0,
      exclusive_client_id INTEGER,
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
      photo_url TEXT
    );
    CREATE TABLE IF NOT EXISTS donor_assignments (
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
      call_duration INTEGER,
      call_quality INTEGER
    );
  `);

  db.exec(`
    INSERT OR IGNORE INTO clients (id, name, candidate, portal_password, portal_password_needs_reset)
    VALUES (1, 'Client One', 'Candidate One', 'seed', 1);
    INSERT OR IGNORE INTO donors (id, client_id, name, exclusive_donor, exclusive_client_id) VALUES
      (101, 1, 'Assigned Donor', 0, NULL),
      (102, NULL, 'Unassigned Donor', 0, NULL),
      (103, 1, 'Inactive Assignment', 0, NULL);
    INSERT OR IGNORE INTO donor_assignments (id, client_id, donor_id, is_active) VALUES
      (1, 1, 101, 1),
      (2, 1, 103, 0);
  `);

  db.close();

  process.env.NODE_ENV = 'test';
  process.env.CALLTIME_DB_PATH = dbPath;
  if (!process.env.MANAGER_PASSWORD) {
    process.env.MANAGER_PASSWORD = 'test-manager-password';
  }

  const context = { dbPath, tmpDir };
  global.__CALLTIME_TEST_DB__ = context;
  return context;
}

module.exports = ensureIntegrationDatabase;
