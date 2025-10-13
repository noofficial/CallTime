const assert = require('assert')
const Database = require('better-sqlite3')

const db = new Database(':memory:')

db.exec(`
    CREATE TABLE donor_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        donor_id INTEGER NOT NULL,
        assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        assigned_by TEXT,
        priority_level INTEGER DEFAULT 1,
        custom_ask_amount REAL,
        is_active BOOLEAN DEFAULT 1,
        assignment_notes TEXT,
        UNIQUE(client_id, donor_id)
    );
`)

const seedAssignment = db.prepare(`
    INSERT INTO donor_assignments (
        client_id,
        donor_id,
        priority_level,
        assigned_by,
        custom_ask_amount,
        assignment_notes,
        is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
`)

seedAssignment.run(1, 42, 2, 'manager', null, null, 1)

const setCustomMetadata = db.prepare(`
    UPDATE donor_assignments
    SET custom_ask_amount = ?, assignment_notes = ?, is_active = ?
    WHERE client_id = ? AND donor_id = ?
`)

setCustomMetadata.run(1234.56, 'Keep this note', 0, 1, 42)

const assignmentUpsert = db.prepare(`
    INSERT INTO donor_assignments (client_id, donor_id, priority_level, assigned_by, is_active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(client_id, donor_id) DO UPDATE SET
        priority_level = excluded.priority_level,
        assigned_by = excluded.assigned_by,
        is_active = 1
`)

assignmentUpsert.run(1, 42, 5, 'manager')

const assignment = db.prepare(`
    SELECT priority_level, assigned_by, is_active, custom_ask_amount, assignment_notes
    FROM donor_assignments
    WHERE client_id = ? AND donor_id = ?
`).get(1, 42)

assert.ok(assignment, 'Expected assignment to exist after upsert')
assert.strictEqual(assignment.priority_level, 5, 'Priority level should update from the upsert')
assert.strictEqual(assignment.assigned_by, 'manager', 'Assigned by should update from the upsert')
assert.strictEqual(assignment.is_active, 1, 'Assignment should reactivate on upsert')
assert.strictEqual(assignment.custom_ask_amount, 1234.56, 'Custom ask amount should persist across reassignment')
assert.strictEqual(assignment.assignment_notes, 'Keep this note', 'Assignment notes should persist across reassignment')

console.log('Assignment upsert preserves custom metadata.')
