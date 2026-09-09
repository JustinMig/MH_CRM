# M&H CRM workspace update — 2026-09-09

## Implemented interface

The top toolbar has the compact Appointments, Notes, Contacts, Height & Weight and Commissions icons. Their glyphs, tile colors, compact arrangement, desktop overlays and mobile bottom sheets follow the existing Mayer CRM components. This repository contains its own implementation, not an iframe, runtime import or API connection to the old CRM.

Dashboard and Appointments show the month calendar with previous/next/Today controls, Today’s Appointments and Reschedule queues. Clicking a day opens a day overlay. Adding an appointment opens the shared editor above that overlay and prefills the selected date.

Main navigation no longer contains Client Information, Medicare, Life, Retirement or Documents. Add Client and any future client search results use the shared Client Information dialog. It contains Client Information, Medicare, Life, Retirement, Documents and Notes tabs. Hidden tabs keep their form values.

All editable dialogs compare the entire form against its baseline. X, Escape, backdrop and hash navigation share a close guard. Unchanged/reverted forms close immediately; changed forms offer Keep Editing, Discard Changes, or Save & Close. Saving must resolve successfully before closing. Failed saves retain the draft. Focus is trapped in the active modal and restored on close, including nested dialogs. The underlying page and search filters are retained.

## Important: still an empty framework

`app.js` mounts `createWorkspace` with `disconnectedRepository` from `core.js`. That provider cannot read or save records and does not make network calls. No production clients, appointments, notes, directory contacts, commission rates, chart rows or agent accounts were seeded or imported. No client records are put in browser storage. Forms hold only temporary, unsaved edits while open.

The contacts directory and height/weight lookup have their controls and result views, but their source data has not been imported. Commissions display unavailable values, not invented zeroes or estimates. Document uploads and sensitive identity inputs remain disabled until appropriate secure services exist. This change does NOT make the application production-ready for personal or health information and does NOT add authentication, an App Store package or an actual database.

Before real use, connect an isolated backend, authenticated role-based access, server-side validation and search/pagination, private storage, audit trails and backup/restore. Availability checks and commission calculations must be authoritative server operations. Do not reuse the old CRM's endpoint, database credentials or storage.

## Repository adapter contract

A future implementation may pass an adapter to `createWorkspace(root, repository)`; there is no runtime URL or demo-data switch in the production application.

- `connected`: boolean; `agents`: permitted agents, each with `id` and `full_name`.
- `searchClients({query, product, agent, birthYear, limit, cursor})` returns `{rows, nextCursor}`. Empty searches are blocked. Names and identifiers are escaped in the interface.
- `getClient(id)` returns the permitted client. `saveClient(record, {expectedVersion})` returns the saved record including `id` and a concurrency version in `updated_at`; a missing ID is not treated as success.
- Client field keys are defined by the named controls in `views.js`. Date input is MM/DD/YYYY; serialization uses YYYY-MM-DD. Changes are merged with the loaded record so unrelated fields are not dropped.
- `listEvents({start, end, includeToday, includeReschedule})` returns permitted events. Include the selected month range, today's queue and reschedule queue. `saveEvent(value)` must validate date/time, client/agent permissions and conflicts, then return `{id}`. An existing `event_id` identifies an update.
- `listNotes({owner})` returns permitted note records. `saveNote(value)` returns the saved note including `id`.
- `searchContacts({query, limit})` returns company records with `company`, `phones`, `faxes`, `emails` and `notes`.
- `getBuildChart({company, heightInches})` returns `{values:[{label,value}], source}` or null. Import and verify genuine carrier reference tables first.
- `commissions({type, agent})` returns authorized numeric summary values. Life: `monthly`, `yearly`. Medicare: `bookCount`, `monthlyRenewals`, `annualRenewals`, `periods` keyed by AEP/OEP/SEP/T65 / IEP. No rates are assumed in the client.

Adapter methods reject on failure. Browser-side checks alone are not authorization. There is no durable local fallback or cross-CRM fallback.

## Validation performed

`node --experimental-default-type=module --test tests/core.test.mjs`

10 pure tests cover navigation, nested tabs, month geometry including leap years, manual dates, invalid dates, dirty snapshots/reversions, hidden-tab fields, HTML escaping, and disconnected read/write failures.

20 local headless Chromium workflow checks passed: all tools, modal close paths, focus return/trapping, unsaved drafts, failed saves, hidden-tab validation, Notes, calendar controls/queues/nested editors, dates, tool selectors, Clients search/filter retention, hash-navigation protection, scroll restoration, and viewport widths 1440/768/390/360. A disposable memory adapter tested result selection and successful Save & Close; it is not present in production or this repository.

The browser checks used locally rendered source because the environment blocked direct localhost browser navigation. They are not claims of testing Safari, physical phones, screen readers, live database permissions or native iOS behavior. No production records were created.

## Read-only source references

Viewed in `JustinMig/Mayer-insurance-crm` (no writes):

- `app/(crm)/dashboard/DashboardQuickTools.tsx` — compact toolbar and shared overlay.
- `app/(crm)/dashboard/CommissionTopbarButton.tsx` / `CommissionQuickView.tsx` — commission icon and split panel.
- `app/(crm)/dashboard/DashboardCalendar.tsx` — calendar grid and day/queue overlays.
- `app/(crm)/dashboard/AppointmentQuickSetter.tsx`, `DashboardNotes.tsx`, `CompanyDirectory.tsx`, `BuildChartLookup.tsx` — tool controls and layouts.
- `app/(crm)/layout.tsx` — top-bar placement.

Accessibility reference: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
