# Book Marketing Webhook — Vercel Deploy Guide

## Deploy in 3 Steps

### 1. Install Vercel CLI (one-time)
```
npm i -g vercel
```

### 2. Deploy from this folder
```
cd book-marketing/webhook-vercel
vercel --prod
```
Follow the prompts: create a new project, accept defaults. Done.

**No CLI? Use the dashboard:**
- Go to vercel.com → Add New Project → drag this folder in

### 3. Set Environment Variables
In Vercel dashboard → Project → Settings → Environment Variables:

| Key | Value |
|-----|-------|
| `AC_API_KEY` | *(your ActiveCampaign API key)* |
| `AC_BASE_URL` | `https://eavesrealtygroup.api-us1.com` |
| `HUBSPOT_API_KEY` | *(your HubSpot Private App token)* |

Then redeploy once for the vars to take effect.

---

## Your Live Endpoint URLs
```
https://YOUR-SITE.vercel.app/api/lead-capture
https://YOUR-SITE.vercel.app/api/score-update
https://YOUR-SITE.vercel.app/api/deal-create
```

---

## API Reference

### POST /api/lead-capture
```json
{
  "firstName": "Sarah",
  "email": "sarah@example.com",
  "leadSource": "lp-analysis-paralysis",
  "leadMagnet": "checklist",
  "dfwLocal": true,
  "phone": "214-555-0123"
}
```

### POST /api/score-update
```json
{ "contactId": "12345", "action": "email_click" }
```
Actions: `email_open`(+2) `email_click`(+5) `page_visit`(+3) `video_watch`(+8) `scorecard_complete`(+15) `book_purchase`(+30)

### POST /api/deal-create
```json
{
  "firstName": "Sarah", "lastName": "Johnson",
  "email": "sarah@example.com", "phone": "214-555-0123",
  "leadSource": "lp-analysis-paralysis", "leadMagnet": "checklist",
  "leadScore": 65, "acContactId": "12345"
}
```
Triggers when lead hits `buyer-ready`. Creates HubSpot contact + deal, auto-associated.
