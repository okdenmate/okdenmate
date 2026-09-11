# The domain

Everything in `packages/core` is a pure function over plain data. No database, no
HTTP, no framework. That is deliberate: these are the rules the business runs on,
and they should be arguable by someone who does not write software.

---

## Provenance

The brief this system was built from is unusually disciplined about one thing:
every figure carries a tag saying how much weight it can bear.

| Tag | Meaning |
|---|---|
| V | Verified. Evidence in hand. |
| R | Reported. Stated by a person, not independently checked. |
| E | Estimated. Calculated from what was available. |
| A | Assumed. A necessary assumption that could be wrong. |
| U | Unknown. Must be obtained. |
| X | Corrected. An earlier version asserted this and it was wrong. |

`provenance.ts` makes that enforceable rather than editorial. Three rules:

- A value tagged Unknown **cannot carry a number**. The constructor throws.
- A derived figure inherits the **weakest** tag among its inputs. A calculation
  from one verified figure and one assumption is an assumption.
- A derivation with any unknown input **returns unknown**, not zero.

That last rule is the one that earns its keep. Storage fees are unknown, so a
monthly charge with no rate is raised as *unresolved* rather than as £0. A gap
shows up as a gap. A silent zero would look like a month where nothing was owed.

## Money

Integer pence throughout, and integer kilogrammes for tonnage. Never floats.
Commission is a real person's pay and storage fees accrue monthly for years;
drift in either is a dispute waiting to happen. Percentages are basis points, so
they stay integers end to end too.

## Products, and the split the business turns on

The brief calls it the critical split:

- **Commodity** — ammonium nitrate. AHDB publishes a delivered GB price every
  week, so the buyer can check any quote in thirty seconds. Merchant margin 2 to
  6 per cent. A volume and logistics business.
- **Specialty** — potassium and sodium nitrate, calcium nitrate, MKP. Opaque
  pricing, technical sell, grade-driven. Margin estimated at 20 to 30 per cent.

Classification is a **property of the product**, not a judgement made per deal.
That is what lets the quote screen prompt for a mix shift without anyone having
to remember to.

Two services advertised on the live site — bespoke blending and white-label
packing — are held in the catalogue as explicitly not deliverable, so nobody
quotes them by accident.

## How an account takes it

An account carries four facts about its supply beyond its name and sector,
because all four change the conversation before a price is ever discussed:

| Field | Why it is on the account |
|---|---|
| Nature of trade | Required at the point of sale for a regulated line, and the single most useful thing to know before quoting a grade |
| Preferred nitrate | Drives the mix-shift prompt, and stops a rep opening a call by asking something already on file |
| Fulfilment | Immediately, stored here, called off, or not established |
| Typical order | A 28 t arable buyer and a 2 t pyrotechnics buyer are not the same customer even at identical revenue |

Fulfilment is the commercially important one, and the first version did not
model it at all:

- **Immediately** — wants it off the floor this week, which only UK stock at
  King's Lynn can do. An imported line is eight to ten weeks, so promising a
  date on one of those is promising something the business cannot deliver.
- **Stored here** — buys it and leaves it on the racking. A margin sale *plus*
  the only recurring fee in the business, and the point at which the customer's
  notification duty becomes ours.
- **Called off** — a contract or a season drawn down in instalments.
- **Not established** — the default, never guessed, because guessing it loses
  the storage conversation entirely.

An account that says it stores with us but has no storage agreement is flagged
in the list. That combination is unbilled revenue sitting beside an
undocumented duty, which is the worst of both.

## Margin

`computeDealMargin` returns revenue, cost and gross margin, split by product
class, plus **specialty share of gross margin**. The share is measured on margin
rather than revenue on purpose: tonnes of ammonium nitrate will always dominate
revenue and never dominate profit, so measuring the shift on revenue would make
real progress look like failure.

**Price anchors.** Any ammonium nitrate quote is compared to the published AHDB
price and the rep is told, in words, what the buyer will see. Above ten per cent
over the anchor the message says to expect a challenge.

**Guardrails.** Floors below which a line is not worth the handling, the duty or
the working capital:

| Class | Floor | Effect |
|---|---|---|
| Commodity | 1.5% | Warns. Ammonium nitrate genuinely runs this thin. |
| Ancillary | 5% | Warns. |
| Specialty | 12% | **Blocks the quote.** A specialty line this thin means the pricing has gone wrong, not that specialty is thin. |

A negative margin blocks in every class.

## Mix shift

Given a commodity deal and the buyer's sector, `suggestMixShift` names a specific
alternative, explains why that sector buys it, and computes the margin and
commission difference. The routes come from the sectors the live site already
claims to serve, not from an invented segmentation.

Two honest details:

- A specialty substitution is not tonne-for-tonne. Specialty buyers take smaller,
  more frequent loads, so the comparison uses a conservative fraction of the
  commodity tonnage rather than all of it.
- Every figure carries the Assumed tag it inherits from the unverified specialty
  margin band, and the caveat says so in the interface. The direction is sound;
  the magnitude is a working estimate until real specialty orders are priced out.

`rankMixShiftCandidates` produces the call list: volume that could move, weighted
by how untouched the account is and how live the relationship still is.

## Commission

Rates are encoded, not configurable. A rate that can be edited in an admin screen
is a rate that gets disputed later.

| Line | Basis | Rate |
|---|---|---|
| Reeve Wood, new customer | Order value | 10% |
| Reeve Wood, repeat | Order value | 3% |
| UK Nitrates, new account | **Gross margin** | 25% |
| UK Nitrates, repeat | **Gross margin** | 7.5% |
| Storage | Monthly fee | 25% |

**The unresolved term.** It is not written down whether the 25 per cent
new-account rate applies to that account's later orders. If it is first-order
only, every projection halves. The engine takes the reading as an explicit
input and defaults to the conservative one, so the ambiguity is visible in the
numbers rather than buried in them.

**The lag.** Commission moves `accrued → payable → paid`. It becomes payable only
when the order is marked paid, because nothing is paid to the rep until the
company is paid.

## Compliance

Two regimes, routinely confused, kept apart in the code.

### Point of sale — Poisons Act 1972

Applies to every sale of an explosives precursor regardless of tonnage. Requires
photographic ID, business name and address, VAT number and nature of trade;
eighteen months' retention; suspicious transactions reportable within 24 hours;
and no supply to members of the public.

`evaluateSaleGate` returns `clear`, `warn` or `blocked`. A blocked gate stops the
quote **and** the order — both, because stopping only the quote would leave the
obvious workaround open. Sign-off requires a named person and an owner or
operations director role.

`screenEnquiry` runs on every public enquiry as it arrives and raises indicators
for a member-of-the-public buyer, refused details, cash for bulk, no stated trade,
bulk collection, or no destination. The response to the enquirer says nothing
about the result: a buyer must never learn from a form whether they tripped a flag.

### Storage — NAMOS and NIHHS

| Threshold | Applies to | Notify |
|---|---|---|
| 25 t | Ammonium nitrate at or above 28%N | HSE, local Fire & Rescue, warning sign at the entrance |
| 150 t | AN mixtures at or above 15.75%N | Fire & Rescue, HSE via NAMOS |
| 150 t | AN and mixtures | HSE (NIHHS 1982 as amended) |

Single stack maximum 300 t, with a metre between stacks.

Two design decisions worth stating:

- **An unconfirmed notification is treated as an exposure, not as a pass.** The
  site's status is unknown and no warning signage was visible in photographs.
  Silence is not evidence of compliance.
- **Peak matters as much as current holdings.** The duty attaches to the tonnage
  held, so a single 30-tonne week two months ago creates an obligation that a
  snapshot of today's near-empty shed will not show. Where the ledger proves a
  higher peak than the one declared, the ledger wins.

`assessStoragePitch` scores whether storage can honestly be sold as outsourced
compliance. The pitch is "outsource your regulatory duty to us", and that only
sells if the duty is demonstrably discharged.

## Concentration

Herfindahl-Hirschman index computed on **gross margin**, not revenue, because
margin is what pays the wages. Accounts flagged as possible direct importers get
a specific finding: if they can buy the same goods at source, the switching cost
is near zero and that margin is at risk rather than a base.

With no trading history the function returns `unknown` and says so, rather than
returning a comfortable-looking `low`.

## Funnel

Eight stages. Nought to five are fired by the website; six and seven are recorded
by this system, which is what makes the quote-to-order ratio countable at all.

A stage cannot really convert above 100 per cent. When it appears to, sessions
are entering partway down — an order taken over the phone, or a deal marked won
without a quote going out. The report suppresses the percentage and says how many
did that instead, because printing 400 per cent teaches the reader nothing.

Stage close-probabilities for the pipeline forecast are **assumed**. There is no
historical quote-to-order ratio to fit them to, so the forecast is labelled as a
ranking device rather than a prediction until a full quarter has been recorded.

## Forecast

Three scenarios reproduced from the brief's growth case. Both the per-order margin
and the ramp are back-solved from the published figures rather than invented:
£656 a month across three orders at 25 per cent is £875 of margin per order, and
£4,300 in year one against £656 a month is 6.6 months of mature trading inside
twelve, which a linear ramp reaches only if it runs the whole year.

A test asserts the reproduction. If the ramp is ever changed, it catches the
scenarios drifting away from the numbers the growth case was argued on.
