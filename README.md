# UK Nitrates CRM

A margin-first, compliance-gated revenue system for UK Nitrates.

It is not a generic CRM with nitrate labels on it. Four things in this business
decide whether a month is good or bad, and each one is built into the machinery
rather than left to a rep's memory:

1. **Commodity and specialty are different businesses.** Ammonium nitrate runs at
   2 to 6 per cent gross margin against 20 to 30 on specialty grades. The same
   sales effort earns four to fifteen times as much on one as the other. Every
   commodity deal in this system raises a specific alternative, with the margin
   and commission difference computed for the person doing the steering.
2. **Some sales are unlawful without paperwork.** Ammonium nitrate at or above
   16 per cent nitrogen, and potassium nitrate, are explosives precursors under
   the Poisons Act 1972. The system refuses to issue a quote or book an order to
   a buyer whose verification is incomplete, expired, or unsigned. It is a gate,
   not a reminder.
3. **Commission is paid on gross margin, and it lags.** Nothing becomes payable
   until the customer pays. The ledger models that lag instead of treating an
   order as cash.
4. **Half the numbers in this business are not known yet.** Every figure carries
   a tag saying how much weight it can bear, and a derived figure can never be
   more certain than its weakest input. A missing number propagates as a gap,
   never as a silent zero.

## Running it

Requires Node 22.5 or later. There are no native dependencies: the database is
the `node:sqlite` module built into Node.

```bash
npm install
npm run build
npm run seed          # loads reference data and prints one-time passwords
npm start             # http://localhost:4000
```

For development with hot reload:

```bash
npm run dev:server    # API on :4000
npm run dev:web       # Vite on :5173, proxying /api
```

To see the system with a populated book before real data exists:

```bash
npm run demo          # writes data/demo.db, all accounts prefixed [demo]
UKN_DB=$PWD/data/demo.db npm start
```

The demo data is openly fictional and is kept in a separate file from the seed
for that reason. The seed loads only figures that are actually evidenced.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `UKN_DB` | `data/ukn.db` | Database file |
| `COOKIE_SECRET` | a development value | **Set this in production** |
| `UKN_PUBLIC_ORIGINS` | none | Comma-separated origins allowed to post enquiries. Unset means none |
| `UKN_SEED_PASSWORD` | random per user | Fixes seed passwords, for testing |

## Layout

```
packages/core     Domain engines. Pure functions, no I/O, 54 tests.
packages/server   Fastify API over node:sqlite. 35 integration tests.
packages/web      React and Vite front end.
packages/embed    The enquiry widget for uknitrates.com. No dependencies.
```

`packages/core` is where the business lives. It has no dependencies at all, so
the commission rules, the compliance gates and the margin engine can be read,
tested and argued about without a database or a browser anywhere near them.

## Closing the measurement gap

The brief records that enquiry volume and conversion are unmeasurable: the live
site's Enquire buttons point at a URL containing a space and the footer contact
route returns a 404. A `mailto:` link is not a fix either, because it leaves no
record of who started an enquiry and abandoned.

This system provides the endpoint that was missing:

```
POST /api/public/enquiry     an enquiry, screened for precursor risk on arrival
POST /api/public/events      funnel stage events
```

Neither needs authentication and neither needs a third-party analytics account.

`packages/embed` is the other half: a self-contained enquiry form for the
website that posts to both. It renders inside a shadow root, so the site's
theme cannot reach it, and it needs no build step on that side.

```html
<div id="ukn-enquiry"></div>
<script src="https://crm.uknitrates.com/ukn-enquiry.js"
        data-endpoint="https://crm.uknitrates.com"></script>
```

Add the site's origin to `UKN_PUBLIC_ORIGINS` or the browser will refuse the
cross-origin post. See [`docs/WIDGET.md`](docs/WIDGET.md).

## Documentation

| File | What it covers |
|---|---|
| [`docs/DOMAIN.md`](docs/DOMAIN.md) | The engines, and the reasoning behind each rule |
| [`docs/API.md`](docs/API.md) | Every endpoint |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why the system is built this way |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The two design profiles, and why the default is not the shared one |
| [`docs/WIDGET.md`](docs/WIDGET.md) | The site-side enquiry form, and how to deploy it |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | What is still unknown, and what each unknown blocks |

## Tests

```bash
npm test
```

The tests that matter most are in `packages/server/src/api.test.ts`, under
"the compliance gate cannot be walked past". A unit test proving the engine says
"blocked" is worth little if a route forgets to ask it, so those run over the
real HTTP surface and a real database.
