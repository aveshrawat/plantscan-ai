# GreenOps ITSM — Feature Set Prompt 1 Implementation Notes

Base used: `greenops-itsm-ceo-final-complete`.

## Preserved
- Login/home page UI was not redesigned.
- Existing AI scan, score, ticket, evidence, report, and role workflows are preserved.

## Added

### Client Operations Assistant
- Added `Ask GreenOps` client tab.
- Answers are generated from platform records only, not a generic chatbot.
- Supported questions include site status, pending tickets, SLA breaches, invoice explanation, recurring issues, last serviced, report summary, and WhatsApp notifications.

### Invoice Module
- Added `src/billing.js`.
- Formula: Fixed Monthly AMC - SLA Service Credit = Net Payable.
- SLA credit rule: ₹50 per breached SLA item / plant.
- Added client invoice view and downloadable invoice HTML.

### WhatsApp Demo Notification Layer
- Added `src/notifications.js`.
- Added `api/notify-whatsapp.js` as a future provider hook.
- Client-created P1 tickets now prepare client confirmation and supervisor alert notifications.
- Ticket in-progress and closure events prepare update notifications.
- Current mode is prefilled WhatsApp link only; no true WhatsApp Business API delivery.

### Notification Log
- Added notification log view for client/supervisor/admin contexts.

### Operational Intelligence
- Added `src/intelligence.js`.
- Added baseline audit, zone health breakdown, last visited timestamps, recurring issue auto-flags, replacement frequency report, visit compliance report, and vendor performance score.

### Maintenance Staff Scan Support
- Added visible voice-note control in maintenance scan flow.
- AI diagnosis now renders root cause and next steps with English/Hindi toggle.
- Added read-aloud support using browser speech synthesis.
- Manual-confirmation language is no longer shown in the diagnosis result; confidence remains secondary.

### Role-Specific Reports
- Supervisor report and client report now carry different titles, purpose, summary logic, and print/PDF emphasis.
