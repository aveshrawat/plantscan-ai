# GreenOps ITSM

AI-powered plant health diagnosis + SLA-based maintenance + client visibility.

This is a zero-cost V1 designed for Vercel/static hosting. It uses localStorage for persistence and calls the LLM only during the plant scan phase.

## Core loop

Scan → Diagnose → Categorise → Ticket → SLA → Evidence → Close → Report

## Views

1. Maintenance Staff
   - Scan plant
   - Get AI diagnosis and instructions
   - See assigned tickets
   - Upload evidence before closure

2. Supervisor / Manager
   - Master dashboard
   - City/client/site/date filters
   - Healthy / Monitor / Critical categorisation
   - SLA breach tracking
   - Evidence-controlled closure
   - CSV reports

3. Client
   - Live health overview
   - Site health trend graph
   - Raise Priority 1 tickets
   - Download reports
   - View closure evidence

## Zero-cost storage

V1 uses browser localStorage. This is intentional for demo/pilot use.

Limitation: data is device/browser-specific. For multi-user usage, replace `src/store.js` with Supabase, Cloudflare D1, Firebase, or any SQL backend.

## Deploy on Vercel

1. Upload this folder to GitHub.
2. Import the repo into Vercel.
3. Add this environment variable:

```bash
ANTHROPIC_API_KEY=your_key_here
```

Optional:

```bash
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

4. Deploy.

## Local development

```bash
npm i -g vercel
vercel dev
```

Open the local Vercel URL.

## Architecture

```text
index.html
src/app.js        Main router and UI controller
src/config.js     Roles, SLA rules, app constants
src/store.js      Local-first data layer
src/health.js     Health categorisation and trends
src/tickets.js    Ticket lifecycle logic
src/sla.js        SLA ageing and breach logic
src/reports.js    CSV exports and joined records
src/utils.js      Shared utilities
api/diagnose.js   Serverless LLM diagnosis endpoint
```

## Upgrade path

V2:
- Replace localStorage with Supabase / Cloudflare D1
- Add real login
- Add role-based server permissions
- Add image storage
- Add PDF reports

V3:
- Client-specific deployments
- Escalation rules
- WhatsApp/email alerts
- Sensor integrations
- ServiceNow/Salesforce integration layer

## V1.1 additions in this build

Added client-portal commercial features for Model 3 / competitor-displacement demos:

- Client Operations Assistant (`Ask GreenOps`) for status, tickets, invoices, recurring issue signals, reports, last serviced status, and WhatsApp notification status.
- Client Invoices tab with fixed monthly AMC invoice generation.
- SLA service credit rule: ₹50 per breached plant/ticket for the current billing month.
- Downloadable invoice as an HTML file with SLA billing summary.
- WhatsApp demo notification log for client-raised P1 tickets.
- WhatsApp demo uses +91-8799765307 and creates prefilled `wa.me` links.
- `/api/notify-whatsapp` stub added for future provider integration.

Important: WhatsApp is demo-link mode in this build. Truly automatic WhatsApp delivery needs a WhatsApp Business API provider such as Meta Cloud API, Twilio, Interakt, Gupshup, or 360dialog.
