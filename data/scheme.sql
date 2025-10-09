-- Enhanced Campaign Call Time Database Schema
-- This extends the existing schema with new tables for improved functionality

-- Client-specific donor research (completely isolated per client)
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

-- Enhanced call outcomes with better categorization and tracking
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
    ask_amount REAL,
    response_quality TEXT, -- 'positive', 'neutral', 'negative'
    contact_method TEXT DEFAULT 'phone', -- 'phone', 'email', 'text', 'in-person'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE
);

-- Client-specific donor notes (completely isolated between clients)
CREATE TABLE IF NOT EXISTS client_donor_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    donor_id INTEGER NOT NULL,
    note_type TEXT NOT NULL DEFAULT 'general',
    note_content TEXT NOT NULL,
    is_private BOOLEAN DEFAULT true,
    is_important BOOLEAN DEFAULT false,
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
    priority_level INTEGER DEFAULT 1, -- 1=low, 2=medium, 3=high
    custom_ask_amount REAL, -- client-specific ask amount override
    is_active BOOLEAN DEFAULT true,
    assignment_notes TEXT,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE,
    UNIQUE(client_id, donor_id)
);

-- Call sessions for tracking call time productivity
CREATE TABLE IF NOT EXISTS call_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    session_start DATETIME DEFAULT CURRENT_TIMESTAMP,
    session_end DATETIME,
    calls_attempted INTEGER DEFAULT 0,
    calls_completed INTEGER DEFAULT 0,
    calls_successful INTEGER DEFAULT 0, -- positive outcomes
    total_pledged REAL DEFAULT 0,
    total_contributed REAL DEFAULT 0,
    session_notes TEXT,
    session_goal TEXT,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Enhanced client profiles with additional settings
ALTER TABLE clients ADD COLUMN IF NOT EXISTS candidate TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS office TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS call_goal_daily INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS fundraising_goal REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Enhanced donor profiles with additional research fields
ALTER TABLE donors ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT DEFAULT 'phone';
ALTER TABLE donors ADD COLUMN IF NOT EXISTS best_call_times TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS spouse_name TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS interests TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS political_affiliation TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS capacity_rating INTEGER CHECK(capacity_rating >= 1 AND capacity_rating <= 5);
ALTER TABLE donors ADD COLUMN IF NOT EXISTS last_contact_date DATE;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS source TEXT; -- how they were acquired

-- Create comprehensive indexes for performance
CREATE INDEX IF NOT EXISTS idx_client_donor_research_lookup ON client_donor_research(client_id, donor_id);
CREATE INDEX IF NOT EXISTS idx_call_outcomes_client_donor ON call_outcomes(client_id, donor_id);
CREATE INDEX IF NOT EXISTS idx_call_outcomes_date ON call_outcomes(call_date);
CREATE INDEX IF NOT EXISTS idx_call_outcomes_status ON call_outcomes(status);
CREATE INDEX IF NOT EXISTS idx_call_outcomes_follow_up ON call_outcomes(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_client_donor_notes_lookup ON client_donor_notes(client_id, donor_id);
CREATE INDEX IF NOT EXISTS idx_donor_assignments_client ON donor_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_donor_assignments_donor ON donor_assignments(donor_id);
CREATE INDEX IF NOT EXISTS idx_donor_assignments_active ON donor_assignments(is_active);
CREATE INDEX IF NOT EXISTS idx_call_sessions_client ON call_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_date ON call_sessions(session_start);

-- Views for common queries
CREATE VIEW IF NOT EXISTS client_donor_summary AS
SELECT 
    c.id as client_id,
    c.name as client_name,
    d.id as donor_id,
    d.name as donor_name,
    da.priority_level,
    da.custom_ask_amount,
    da.assigned_date,
    COALESCE(co.status, 'Not Contacted') as last_status,
    co.call_date as last_call_date,
    co.follow_up_date,
    COUNT(co2.id) as total_calls,
    COALESCE(SUM(co2.pledge_amount), 0) as total_pledged,
    COALESCE(SUM(co2.contribution_amount), 0) as total_contributed
FROM clients c
JOIN donor_assignments da ON c.id = da.client_id
JOIN donors d ON da.donor_id = d.id
LEFT JOIN call_outcomes co ON d.id = co.donor_id AND co.client_id = c.id
    AND co.id = (
        SELECT id FROM call_outcomes co3 
        WHERE co3.donor_id = d.id AND co3.client_id = c.id 
        ORDER BY call_date DESC LIMIT 1
    )
LEFT JOIN call_outcomes co2 ON d.id = co2.donor_id AND co2.client_id = c.id
WHERE da.is_active = 1
GROUP BY c.id, d.id, da.priority_level, da.custom_ask_amount, da.assigned_date, 
         co.status, co.call_date, co.follow_up_date;

CREATE VIEW IF NOT EXISTS manager_dashboard_stats AS
SELECT 
    c.id as client_id,
    c.name as client_name,
    c.candidate,
    c.office,
    COUNT(DISTINCT da.donor_id) as assigned_donors,
    COUNT(DISTINCT CASE WHEN co.status NOT IN ('Not Contacted') THEN co.donor_id END) as contacted_donors,
    COUNT(DISTINCT co.id) as total_calls,
    COALESCE(SUM(co.pledge_amount), 0) as total_pledged,
    COALESCE(SUM(co.contribution_amount), 0) as total_raised,
    AVG(CASE WHEN co.call_quality IS NOT NULL THEN co.call_quality END) as avg_call_quality,
    COUNT(DISTINCT CASE WHEN co.status IN ('Committed - Amount TBD', 'Committed - Specific Amount', 'Contributed') 
                       THEN co.donor_id END) as committed_donors
FROM clients c
LEFT JOIN donor_assignments da ON c.id = da.client_id AND da.is_active = 1
LEFT JOIN call_outcomes co ON c.id = co.client_id
WHERE c.is_active = 1
GROUP BY c.id, c.name, c.candidate, c.office;