# CallTime Desk

CallTime Desk is an internal call-time workspace for campaign finance consultants.
Create a dedicated donor queue for each client, pull profiles from Google Sheets or
CSV exports, and log outcomes that remain private to the active campaign.

## Highlights

- **Multi-client switcher** keeps donor notes, pledges, and outcomes scoped to
  the selected campaign.
- **Dedicated donor database** capture full profiles (contact, biography,
  company, industry, photo, and structured giving history) through the in-app
  editor—no spreadsheet required.
- **Google Sheet ingestion** still accepts either the `gviz` JSON feed or the
  "Publish to web" CSV link from Sheets when you want to bulk-import records.
- **Rich donor profiles** surface contact info, giving history, bios, and
  optional tags directly in the call view.
- **Structured outcomes** capture voicemail dates, follow-up commitments, and
  contribution amounts with built-in prompts per status.
- **Local storage persistence** saves call logs in the browser so each session
  resumes where you left off.
- **Demo workspace** loads sample clients and donors for quick evaluation.

## Running the workspace locally

This is a static web application. Start any HTTP server and open `index.html` in
your browser:

```bash
python -m http.server 8000
```

Then navigate to <http://localhost:8000>.

## Authentication

The manager workspace and client portal now require passwords.

- **Manager access:** the dashboard ships with a built-in password of
  `10231972Fn*`. You can override it by setting `MANAGER_PASSWORD` or supply a
  precomputed PBKDF2 hash via `MANAGER_PASSWORD_HASH` when starting the API.

- **Client access:** new campaigns are provisioned with the temporary password
  `password`. Fundraisers select their campaign from the login list, enter the
  temporary password, and are immediately prompted to create a new one on first
  sign-in. Managers can reset a portal back to the default from the client
  editor if needed. Set `DEFAULT_CLIENT_PORTAL_PASSWORD` in the environment if
  you want a different temporary password when the server boots.

Sessions last eight hours and can be ended with the **Log out** button in either
the manager workspace or client portal.

## Using the donor database

Open the **Donor database** window from the global toolbar or the active client
header to review and edit the profiles attached to the selected campaign.

- Add donors with the **New donor** button, then fill in identity, contact,
  professional, and biography fields. Suggested asks, last gift notes, and tags
  help you organize follow-up plans.
- Record detailed giving history by entering an election year, candidate, and
  contribution amount. Each entry is grouped automatically by year, so you can
  scan a donor’s past activity at a glance during call time.
- Upload photo URLs to quickly differentiate supporters or to surface visual
  cues for your candidate.
- Use the JSON export button to create a portable backup of the current
  campaign’s donor database.

All changes save instantly to the local database for the active client. Notes
and outcome logs remain private to each campaign, so overlapping prospects never
share information between clients.

## Connecting a Google Sheet

1. Prepare a sheet with one row per donor. Helpful columns include:
   - `Name`
   - `Phone`
   - `Email`
   - `Ask` or `Ask Amount`
   - `City`
   - `Employer` or `Occupation`
   - `Last Gift` (e.g., "$500 (2023)")
   - `Bio` for background snippets
   - `Notes` or `Priority`
2. Publish the sheet so it is accessible:
   - **Preferred:** `File → Share → Publish to web → Entire sheet → Web page`.
     Copy the generated URL and replace the ending with `?format=csv`.
   - **Alternative:** Use the `gviz` feed by copying the sheet ID and building
     `https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:json`.
3. In CallTime Desk, add or edit a client and paste the published link into the
   **Google Sheet link** field. Refresh the donors list to pull the latest
   records.

> **Tip:** If you need to keep separate worksheets per client, publish each
> sheet individually and paste the unique link in the configuration form.

## Data privacy

- Outcomes (status, notes, follow-up dates, contribution amounts) are stored in
  `localStorage` under the key `calltime:interactions:v1`.
- Client configurations and the donor database live under
  `calltime:database:v1`.
- Clearing browser storage or switching browsers will remove this history. For a
  shared office environment, pair the tool with a dedicated workstation profile
  or export interactions periodically.

## Built-in outcomes

| Outcome                | Extra prompts                                 |
| ---------------------- | --------------------------------------------- |
| Not Contacted          | —                                             |
| No Answer              | —                                             |
| Left Voicemail         | Date voicemail was left                       |
| Call Back Scheduled    | Follow-up date                                |
| Committed to Donate    | Follow-up date, optional pledge amount        |
| Received Contribution  | Contribution amount                           |
| Do Not Call            | —                                             |

Use the quick action buttons in the donor detail panel for one-click updates,
then add notes and save. Statuses remain isolated to the client who is logged in
so overlapping prospects never share information between campaigns.

## Customizing

- Update the interface styles via `styles.css`.
- Extend donor parsing or add new outcome types in `app.js`.
- Modify the layout and copy in `index.html` to match your firm’s brand.

Pull requests and suggestions are welcome as you evolve your call-time process.
