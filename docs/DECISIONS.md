# Why it is built this way

## The database is `node:sqlite`

Built into Node 22.5 and later, so there is nothing to compile and nothing to
install. A two-person business should not need a database server, a container
runtime or a native build toolchain to run its CRM. The whole system is one
process and one file, and the file can be copied to back it up.

Money is `INTEGER` pence and tonnage `INTEGER` kilogrammes. SQLite has no decimal
type worth trusting for either.

## The domain has no dependencies

`packages/core` imports nothing. The commission rules, the compliance gates and
the margin engine can be read and tested without a database or a browser
anywhere near them, which matters because these are the rules someone will
eventually want to argue about.

Route handlers validate, delegate and serialise. They contain no business logic
at all.

## Commission rates are code, not configuration

A rate that can be edited in an admin screen is a rate that gets disputed later.
Changing one is a commit, a review and a deployment, which is the correct amount
of friction for changing what somebody is paid.

## The compliance gate blocks the order as well as the quote

Stopping only the quote leaves the obvious workaround open: mark it won and
invoice it anyway. Both paths call the same gate, and the integration tests
prove it over real HTTP, because a unit test proving the engine says "blocked"
is worth little if a route forgets to ask it.

## Unknown is a first-class value

Almost every system in this position would have defaulted a missing storage rate
to zero and moved on. This one raises the month as *unresolved* and says which
question would fix it. A gap that looks like a gap gets chased; a zero does not.

The same rule runs through the derivation helper: any calculation with an
unknown input returns unknown rather than a plausible-looking number.

## The seed loads two orders

The order sheet shows more than two lines, but only two have both a value and a
product recorded. The rest became tasks. A plausible placeholder in a database
is indistinguishable from a fact three months later, and this system's whole
argument is that it knows the difference.

The two it does load are marked Estimated on tonnage and cost, because the sheet
records what the customer paid and not what the goods cost. When the invoice
detail arrives those two lines should be corrected, not appended to.

Demo data lives in a separate script and a separate file, with every account
prefixed `[demo]`. Its ten clients span the real shape of the book rather than
merely looking plausible: two in horticulture (one wanting it immediately, one on
a fortnightly schedule), two in agriculture (one storing a season's ammonium
nitrate on our racking, one buying on the spot price with no verification on
file), plus food production, glass, water treatment, pyrotechnics, ceramics and
animal nutrition. Each carries its trade, its nitrate, its tonnage and how it
takes delivery, so every branch in the system has a customer that exercises it:
a blocked quote, an unbillable storage month, a direct-importer risk, and a
commodity account earning a tenth of the specialty ones beside it.

## Measured on gross margin, not revenue

Tonnes of ammonium nitrate will always dominate revenue and never dominate
profit. The mix-shift target, the concentration index and the commission basis
are all margin-denominated, so real progress does not look like failure.

## The palette is a profile, not a constant

The brief adopts one visual system across both businesses for production-cost
reasons, and leaves the identity consequence open. The shared palette is also,
on inspection, Reeve Wood's own: warm timber and that company's brand sage.
Extending it to a nitrate distributor is dressing one business in another's.

So the token set became a profile. `ukn` is the default here — cold ground,
chemical accent, hazard yellow reserved for Class 5.1 — and `group` is kept
whole. Component CSS names only roles, never colours, which is what makes the
switch a swap rather than a rewrite. See [`DESIGN.md`](DESIGN.md).

## Chart colours are validated, not chosen

Chart series need their own palette, and it was checked against both grounds for
lightness, chroma, contrast and colour-vision separation rather than picked by
eye. It does not change between profiles, because the separation was measured
against those exact backgrounds.

The result is deliberately two categorical hues, not six. The only categorical
split in this system is commodity against specialty, and two well-separated hues
beat four badly separated ones. Ordered data — funnel stages, scenario bands —
uses a single-hue sequential ramp instead.

Status colours are green, amber and red, which cannot be separated under
deuteranopia. Every status chip therefore carries a glyph and a word. Colour is
never the only signal.

## The public endpoints are unauthenticated and say nothing

The enquiry endpoint screens for explosives-precursor risk as the enquiry lands,
and the response reveals none of it. A buyer must never be able to learn from a
form whether they tripped a flag, or they will simply resubmit without the
trigger.

## What is deliberately not built

- **Email.** No sending, no templates, no sequences. Quoting by email is
  currently a person's job and pretending otherwise would hide where the work is.
- **Reeve Wood production.** The schema carries the business and the commission
  rates for flooring, but scheduling, the cutting list and the machines are a
  different system.
- **Document storage.** Verification records hold a *reference* to where
  photographic ID is filed, not the image. Storing identity documents brings a
  data-protection obligation this system is not built to carry.
- **Multi-currency.** Everything is sterling.
