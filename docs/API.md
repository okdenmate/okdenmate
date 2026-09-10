# API

JSON over HTTP. Every response is `{ "ok": true, "data": … }` or
`{ "ok": false, "error": "…", "detail": … }`. Authentication is a session cookie,
set by `POST /api/auth/login`; a bearer token in `Authorization` also works.

Roles: `owner`, `ops_director`, `sales`, `production`, `readonly`. Writes need
`owner`, `ops_director` or `sales`. Signing off buyer verification, filing a
notification, or resolving a suspicious transaction needs `owner` or
`ops_director` — someone has to be answerable for those.

## Public — no authentication

These two are the endpoints the live website is missing.

### `POST /api/public/enquiry`

```json
{
  "companyName": "Fen Glassworks Ltd",
  "contactName": "R. Fenwick",
  "email": "buyer@example.com",
  "phone": "01553 000000",
  "sector": "glass",
  "natureOfTrade": "Container glass manufacture",
  "productIds": ["nano3"],
  "quantityKg": 15600,
  "fulfilment": "delivery",
  "deliveryPostcode": "PE30 4JS",
  "timing": "Within a month",
  "buyerType": "business",
  "message": "…",
  "source": "google",
  "medium": "organic",
  "campaign": "…",
  "sessionId": "…"
}
```

Screens the enquiry for explosives-precursor risk as it arrives and raises a
suspicious-transaction record where warranted. The response deliberately reveals
nothing about that:

```json
{ "ok": true, "data": { "received": true, "reference": "A1B2C3D4", "message": "…" } }
```

### `POST /api/public/events`

```json
{ "event": "calc_engaged", "sessionId": "…", "source": "google", "productId": "nano3" }
```

Event names: `page_view`, `calc_engaged`, `spec_changed`, `enquiry_opened`,
`enquiry_step_2`, `enquiry_submitted`, `spec_emailed`, `enquiry_abandoned`,
`enquiry_failed`. `quote_sent` and `order_won` are raised by the system itself.

---

## Authentication

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | |

## Reference and dashboard

| Method | Path | Returns |
|---|---|---|
| GET | `/api/reference` | Products, sectors and their mix-shift routes, commission rates, stages, thresholds, margin floors, undeliverable services |
| GET | `/api/dashboard` | Everything the command deck shows, in one round trip |
| GET | `/api/health` | Unauthenticated |

## Accounts

| Method | Path | Notes |
|---|---|---|
| GET | `/api/accounts` | `?search=` `?status=` |
| POST | `/api/accounts` | Creates an empty verification record alongside, so the compliance gap is visible from the first minute |
| GET | `/api/accounts/:id` | Account, contacts, deals, orders, activities, storage, verification and its assessment, share of the book |
| PATCH | `/api/accounts/:id` | |
| POST | `/api/accounts/:id/contacts` | |
| PUT | `/api/accounts/:id/kyc` | Buyer verification. `signOff: true` stamps the signer and starts the eighteen-month clock. Owner or operations director only |

## Deals

| Method | Path | Notes |
|---|---|---|
| GET | `/api/deals` | With computed revenue, margin, and whether the deal carries specialty |
| POST | `/api/deals` | |
| GET | `/api/deals/:id` | Includes `pricing`: margin, guards, sale gate, anchor checks, mix-shift suggestions, and whether it can be sent |
| PATCH | `/api/deals/:id` | Stage, expected close, probability override, lost reason |
| POST | `/api/deals/:id/lines` | Returns the recomputed pricing |
| DELETE | `/api/deals/:dealId/lines/:lineId` | Returns the recomputed pricing |
| POST | `/api/deals/:id/quote` | **422 if the sale gate blocks or a margin floor is breached.** The detail carries the reasons and the required actions |
| POST | `/api/deals/:id/win` | **Also 422 on a blocked gate.** Creates the order and the commission accrual in one transaction |

## Orders and commission

| Method | Path | Notes |
|---|---|---|
| GET | `/api/orders` | |
| POST | `/api/orders/:id/paid` | Moves the matching commission from accrued to payable |
| GET | `/api/commission` | Entries, summary, and the rate card |
| POST | `/api/commission/:id/paid` | |

## Enquiries

| Method | Path | Notes |
|---|---|---|
| GET | `/api/enquiries` | Each one carries `isCommodityOnly` and the suggested specialty route |
| POST | `/api/enquiries/:id/convert` | Creates account, contact, verification record and deal. Carries the stated trade across |
| POST | `/api/enquiries/:id/disqualify` | `{ reason }` |

## Analytics

| Method | Path |
|---|---|
| GET | `/api/analytics/funnel` `?since=` |
| GET | `/api/analytics/mix` |
| GET | `/api/analytics/concentration` |
| GET | `/api/analytics/scenarios` |

## Compliance and storage

| Method | Path | Notes |
|---|---|---|
| GET | `/api/compliance` | Holdings, peak, breaches, notifications, pitch readiness, suspicious transactions |
| PUT | `/api/compliance/notifications/:thresholdId` | Owner or operations director |
| PUT | `/api/compliance/site` | Peak tonnage, signage, procedures, pallet positions |
| POST | `/api/compliance/suspicious` | Raise one manually |
| PATCH | `/api/compliance/suspicious/:id` | Report or dismiss |
| GET | `/api/storage` | Agreements, holdings, movements, capacity model, charges |
| POST | `/api/storage/agreements` | A null rate is allowed and shows as a gap, not as free |
| POST | `/api/storage/movements` | Returns the recomputed compliance overview, because goods in can cross a threshold |
| POST | `/api/storage/billing-run` | Idempotent per agreement and period |

## Open questions and reference data

| Method | Path |
|---|---|
| GET | `/api/questions` |
| PATCH | `/api/questions/:id` |
| GET | `/api/anchors` |
| POST | `/api/anchors` |
| GET | `/api/audit` |

## Errors

| Status | Meaning |
|---|---|
| 400 | Validation failed. `detail` lists the paths |
| 401 | Not signed in |
| 403 | Signed in, wrong role |
| 404 | No such record or endpoint |
| 409 | Conflicts with current state, such as winning an already-won deal |
| 422 | Refused on a business rule. **This is the compliance gate.** `detail.reasons` and `detail.requiredActions` say what to fix |
