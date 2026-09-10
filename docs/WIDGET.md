# The enquiry widget

The CRM has had an intake endpoint since day one. Until something posts to it,
the funnel counts nothing. This is that something: a self-contained form for
uknitrates.com that needs no build step on the site's side and no dependencies.

It is 24 kB, 8 kB over the wire, and it renders inside a shadow root so the
site's theme cannot reach it and it cannot leak out. The preview page loads
deliberately hostile styles — every form control on it is a dashed magenta
border at 22px — precisely so that isolation is proven rather than assumed.

## Putting it on the site

```html
<div id="ukn-enquiry"></div>
<script src="https://crm.uknitrates.com/ukn-enquiry.js"
        data-endpoint="https://crm.uknitrates.com"
        data-mount="#ukn-enquiry"
        data-phone="01553 817744"
        data-profile="ukn"
        data-surface="dark"></script>
```

| Attribute | Default | Purpose |
|---|---|---|
| `data-endpoint` | the script's own origin | Where the CRM lives |
| `data-mount` | `#ukn-enquiry` | Selector to mount into. Every match gets an instance |
| `data-phone` | `01553 817744` | Shown as the secondary action throughout |
| `data-profile` | `ukn` | `group` for the shared timber palette. See [DESIGN.md](DESIGN.md) |
| `data-surface` | `dark` | `light` for a page not ready to carry a dark panel |

For a second instance on the same page, or one placed after load:

```js
UknEnquiry.mount('#footer-enquiry', { surface: 'light' });
```

**Then add the site's origin to `UKN_PUBLIC_ORIGINS` on the server**, comma
separated. Unset means no cross-origin posting is allowed at all, which is the
right default but will look like a silent failure if you forget.

```
UKN_PUBLIC_ORIGINS=https://uknitrates.com,https://www.uknitrates.com
```

## Why it is shaped this way

**It gives something back before it asks for anything.** The first step is a
tonnage calculator: how many bags, how many pallets, how soon. It runs entirely
in the browser and posts nothing. A visitor who came to find out whether 15
tonnes is a lot of pallets gets that answer without surrendering an email
address, and is measurably more likely to carry on.

**It asks what the material is for before it asks which product.** That ordering
is the whole of the mix-shift opportunity expressed as a form. A caller who
names ammonium nitrate because it is the only nitrate they know gets routed by
the job to be done instead, and the specialty line their sector usually turns
out to want is preselected. Nothing is forced: the visitor can override it.

**It leaves a record at every stage, including the ones that do not finish.**
An enquiry opened and abandoned is the most useful signal in the funnel, and the
one a `mailto:` link can never produce. Abandonment fires on `pagehide`.

**It splits contact details out into a final step.** Steps one and two ask
nothing personal, which is what lifts completion. The visitor who is still not
ready gets a one-field email capture rather than nothing at all.

**It never guesses buyer type.** The form asks what the business does and sends
the answer; whether that makes someone a business or a member of the public is
a judgement a person makes when they read it. Guessing would defeat the supply
restriction the CRM exists to enforce.

**It says nothing about screening.** The response to a submitted enquiry is the
same whether or not it raised a compliance flag. A buyer who could learn from
the form that they had tripped something would simply resubmit without it.

## Events

Every stage posts to `/api/public/events`, so the funnel screen fills in without
Google Analytics or any other third party.

| Event | Fires when |
|---|---|
| `page_view` | The widget mounts |
| `calc_engaged` | The visitor first touches the calculator |
| `spec_changed` | Any product, sector, tonnage or pack change |
| `enquiry_opened` | They leave the calculator for step two |
| `enquiry_step_2` | They complete qualification |
| `enquiry_submitted` | The enquiry lands |
| `spec_emailed` | Soft capture: email only, still a lead |
| `enquiry_abandoned` | The page unloads with an enquiry open and unsent |
| `enquiry_failed` | The post was refused or the network dropped |
| `phone_click` | They chose to ring instead |

Requests go out with `keepalive` and `credentials: 'omit'`.

`navigator.sendBeacon` would be the obvious way to survive the page unloading
and is the wrong one here: the specification fixes its credentials mode at
`include`, so the browser demands `Access-Control-Allow-Credentials` on the
response. These endpoints are deliberately credential-free, so a beacon is
refused at the preflight every time. `fetch` with `keepalive` gives the same
delivery guarantee without widening the server's CORS policy.

## Developing it

```bash
npm run dev -w @ukn/embed     # preview on :5174/demo/
```

The preview expects the API on `http://localhost:4111`. Start it with that
origin allowed:

```bash
UKN_DB=$PWD/data/demo.db \
UKN_PUBLIC_ORIGINS=http://127.0.0.1:5174 \
PORT=4111 npm start
```

## What it deliberately does not do

- **No pricing.** It promises a delivered price by return, never a number on
  screen. Quoting needs a laid-down cost and a compliance check, and both are a
  person's job.
- **No file upload.** Photographic ID is collected when the quote is sent, by a
  named person, not by an anonymous web form.
- **No cookies.** A session id in `sessionStorage`, which is dropped when the
  tab closes, and nothing else.
