# CallTime Desk

CallTime Desk is a full call-time operations workspace that keeps campaign fundraisers
and managers aligned around a shared donor database. The application ships with a
Node/Express API, a SQLite campaign database, and dedicated browser workspaces for
managers and client fundraising teams.

## Platform overview

- **Manager dashboard** – Authenticate with a manager password to review campaign
  performance, create or edit client records, reset client portal passwords, assign
  donors to specific call queues, and upload donor lists in bulk from CSV or Excel
  files.
- **Client call portal** – Client teams sign in with campaign-specific credentials
  to see only the donors that have been assigned to them. The portal tracks call
  sessions, logs structured outcomes (status, pledges, commitments, and follow-up
  dates), and records client-specific notes or research.
- **Central donor database** – All donors live in SQLite (`campaign.db`) with rich
  profile fields, contribution history, assignment metadata, and per-client
  research. Managers can browse the complete dataset, export JSON snapshots, and
  manage campaign-specific focus lists without exposing other clients’ activity.

## Architecture

| Layer      | Details |
| ---------- | ------- |
| API server | `server/index.js` runs an Express application that serves static assets from `/public` and exposes JSON endpoints for authentication, client management, donor assignments, call outcomes, and bulk imports. |
| Database   | SQLite database stored at `data/campaign.db` (or `server/campaign.db`). The server automatically enables foreign keys and write-ahead logging, and it can augment an existing database with the enhanced tables defined in `data/scheme.sql`. |
| Front end  | Static HTML, CSS, and JavaScript in `/public`. `index.html` routes users to either `manager.html` or `client.html`, and supporting modules (`manager.js`, `client.js`, `donors.js`, etc.) handle API communication and UI state. |

## Getting started locally

1. Install Node.js 18 or newer.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Ensure a SQLite database is available at `data/campaign.db` (preferred) or
   `server/campaign.db`. The repository includes a starter database in
   `data/campaign.db`. To initialize a fresh database, create an empty file at that
   path and apply the schema in `data/scheme.sql` with the SQLite CLI.
4. Start the application:

   ```bash
   npm start
   ```

   The Express server listens on port `3000` by default and serves the interface at
   <http://localhost:3000>. Set the `PORT` environment variable to use a different
   port.

## Authentication and configuration

- **Manager access** – The dashboard uses a single manager password. By default the
  password is `10231972Fn*`. Override it with the `MANAGER_PASSWORD` environment
  variable or provide a PBKDF2 hash via `MANAGER_PASSWORD_HASH`.
- **Client access** – Each campaign has its own portal password stored in the
  database. Newly created clients receive the default temporary password `password`
  unless overridden by the `DEFAULT_CLIENT_PORTAL_PASSWORD` environment variable.
  Clients are prompted to set a new password on first sign-in.
- **Sessions** – Both manager and client sessions expire after eight hours. Logging
  out immediately invalidates the session token.

## Managing data

- **Client records** – Managers can create campaigns with contact details, launch
  dates, fundraising goals, and internal notes. Editing a client allows resetting or
  replacing portal passwords and toggling whether the new password must be changed on
  next login.
- **Donor assignments** – Drag-and-drop tools and API endpoints manage
  `donor_assignments`, ensuring each client sees only their focus list. Assignments
  support priority levels, custom ask amounts, and activity tracking.
- **Bulk imports** – Upload CSV or Excel files through the manager dashboard. The
  import pipeline normalizes column names (see `DONOR_COLUMN_MAP` in
  `server/index.js`), creates or updates donor records, and optionally assigns donors
  to a client based on spreadsheet data or the selected default.
- **Call tracking** – Fundraisers log outcomes, follow-up plans, pledges, and
  contributions from the client portal. The API stores entries in `call_outcomes`,
  while optional session summaries are saved in `call_sessions`.
- **Research & notes** – Client-specific research categories and notes are isolated
  per campaign using the `client_donor_research` and `client_donor_notes` tables.

## Directory highlights

- `public/` – Static assets for the landing page, manager dashboard, client portal,
  and donor database interface.
- `server/index.js` – Express server, authentication helpers, import pipeline, and
  REST endpoints.
- `data/campaign.db` – Default SQLite database shipped with the project.
- `data/scheme.sql` – Schema migrations used to extend an existing database with the
  enhanced tables and indexes expected by the current application.

## Contribution

Pull requests and feature suggestions are welcome. Please include a description of
schema changes and any new environment variables when submitting updates so that the
operations team can deploy them safely.
