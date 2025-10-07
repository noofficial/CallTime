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
