/**
 * UK Nitrates enquiry widget.
 *
 * This is the half of the funnel that lives on the website. The CRM has an
 * intake endpoint; until something posts to it, the funnel counts nothing.
 *
 * Three things it is built to do, none of which a mailto link can:
 *
 *  1. Give something back before it asks for anything. The tonnage calculator
 *     answers a real question (how many bags, how many pallets, how soon) with
 *     no personal detail requested and nothing sent anywhere.
 *
 *  2. Ask what the material is for before asking which product. That ordering
 *     is the mix shift expressed as a form: it routes the enquiry on the job to
 *     be done rather than on the commodity the caller happened to name.
 *
 *  3. Leave a record at every stage, including the ones that do not finish. An
 *     abandoned enquiry is the most useful thing in the funnel and the one a
 *     mailto link can never see.
 *
 * Deployment:
 *
 *   <div id="ukn-enquiry"></div>
 *   <script src="https://crm.example.com/ukn-enquiry.js"
 *           data-endpoint="https://crm.example.com"
 *           data-mount="#ukn-enquiry"
 *           data-phone="01553 817744"
 *           data-surface="dark"></script>
 *
 * No build step on the site's side, no dependencies, and the styles are sealed
 * inside a shadow root so the host theme cannot reach them.
 */

import { breakDown, PACKS, PRODUCTS, SECTORS, type PackSpec, type WidgetProduct } from './catalogue.js';
import { CSS } from './styles.js';

interface Config {
  endpoint: string;
  phone: string;
  surface: 'dark' | 'light';
  /** Which identity to wear. Matches the application's design profiles. */
  profile: 'ukn' | 'group';
}

type Stage = 'calculator' | 'qualify' | 'contact' | 'done';

interface Draft {
  sector: string;
  productId: string;
  packId: PackSpec['id'];
  tonnes: number;
  fulfilment: 'delivery' | 'collection';
  deliveryPostcode: string;
  timing: string;
  natureOfTrade: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  message: string;
}

const TIMINGS = ['As soon as you can', 'Within a month', 'This quarter', 'Pricing for a budget'];

/* ------------------------------------------------------------------ */
/* Session and analytics                                               */
/* ------------------------------------------------------------------ */

function sessionId(): string {
  const KEY = 'ukn_sid';
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private browsing, or storage disabled. A per-page-load id still gives a
    // usable funnel; it just cannot follow the visitor across pages.
    return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function campaign(): { source: string | null; medium: string | null; campaign: string | null } {
  try {
    const q = new URLSearchParams(window.location.search);
    const referrerHost = document.referrer ? new URL(document.referrer).hostname : null;
    return {
      source: q.get('utm_source') ?? referrerHost ?? 'direct',
      medium: q.get('utm_medium'),
      campaign: q.get('utm_campaign'),
    };
  } catch {
    return { source: null, medium: null, campaign: null };
  }
}

/* ------------------------------------------------------------------ */
/* Widget                                                              */
/* ------------------------------------------------------------------ */

class EnquiryWidget {
  private readonly root: ShadowRoot;
  private readonly sid = sessionId();
  private readonly utm = campaign();
  private stage: Stage = 'calculator';
  private engaged = false;
  private opened = false;
  private submitted = false;
  private busy = false;
  private error: string | null = null;
  private softSent = false;

  private draft: Draft = {
    sector: '',
    productId: '',
    packId: 'bag_25kg',
    tonnes: 5,
    fulfilment: 'delivery',
    deliveryPostcode: '',
    timing: '',
    natureOfTrade: '',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    message: '',
  };

  constructor(private readonly host: HTMLElement, private readonly config: Config) {
    this.root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style);
    host.setAttribute('data-surface', config.surface);
    host.setAttribute('data-profile', config.profile);

    this.track('page_view');
    this.render();

    // An enquiry opened and never finished is the most useful signal here, and
    // the one a mailto link can never produce.
    window.addEventListener('pagehide', () => {
      if (this.opened && !this.submitted) this.track('enquiry_abandoned', { stage: this.stage });
    });
  }

  /* -------------------------------------------------------------- */

  private track(event: string, payload: Record<string, unknown> = {}): void {
    const body = JSON.stringify({
      event,
      sessionId: this.sid,
      source: this.utm.source,
      medium: this.utm.medium,
      campaign: this.utm.campaign,
      productId: this.draft.productId || null,
      business: 'UKN',
      payload,
    });
    /*
     * keepalive lets the request outlive the page, which is what the
     * abandonment event needs.
     *
     * navigator.sendBeacon would be the obvious choice and is the wrong one
     * here: the spec fixes its credentials mode at "include", so the browser
     * demands Access-Control-Allow-Credentials on the response. This endpoint
     * is deliberately credential-free, so a beacon is refused at the preflight
     * every time. Omitting credentials explicitly keeps the request simple and
     * keeps the server's policy narrow.
     */
    void fetch(`${this.config.endpoint}/api/public/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      keepalive: true,
      body,
    }).catch(() => undefined);
  }

  private markEngaged(): void {
    if (this.engaged) return;
    this.engaged = true;
    this.track('calc_engaged');
  }

  private get product(): WidgetProduct | undefined {
    return PRODUCTS.find((p) => p.id === this.draft.productId);
  }

  private update(patch: Partial<Draft>, opts: { silent?: boolean } = {}): void {
    Object.assign(this.draft, patch);
    if (!opts.silent) {
      this.markEngaged();
      this.track('spec_changed', {
        sector: this.draft.sector || null,
        productId: this.draft.productId || null,
        tonnes: this.draft.tonnes,
        pack: this.draft.packId,
      });
    }
    this.render();
  }

  /* -------------------------------------------------------------- */
  /* Rendering helpers. Everything dynamic goes in through textContent   */
  /* or a property, never innerHTML, so nothing on this page can be      */
  /* turned into markup.                                                 */
  /* -------------------------------------------------------------- */

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
    ...children: Array<Node | string>
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    const { class: cls, ...rest } = props as Record<string, unknown> & { class?: string };
    if (cls) node.className = cls;
    Object.assign(node, rest);
    for (const child of children) node.append(child);
    return node;
  }

  private nextId = 0;

  /**
   * A single control inside a <label>. Correct for an input or a select, and
   * wrong for anything else: a label wrapping several buttons folds its text
   * into every one of their accessible names, so a screen reader announces the
   * second chip as the question plus the first chip's text.
   */
  private field(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const wrap = this.el('label', { class: 'field' });
    wrap.append(this.el('span', { textContent: label }), control);
    if (hint) wrap.append(this.el('div', { class: 'hint', textContent: hint }));
    return wrap;
  }

  /** Several controls answering one question: a labelled group, not a label. */
  private group(label: string, controls: HTMLElement, hint?: string): HTMLElement {
    const labelId = `ukn-g${(this.nextId += 1)}`;
    const wrap = this.el('div', { class: 'field' });
    wrap.append(this.el('span', { id: labelId, textContent: label }));
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-labelledby', labelId);
    wrap.append(controls);
    if (hint) wrap.append(this.el('div', { class: 'hint', textContent: hint }));
    return wrap;
  }

  private select(
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (v: string) => void,
  ): HTMLSelectElement {
    const sel = this.el('select');
    for (const o of options) {
      const opt = this.el('option', { value: o.value, textContent: o.label });
      sel.append(opt);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  private steps(current: number): HTMLElement {
    const wrap = this.el('div', { class: 'steps' });
    for (let i = 0; i < 3; i += 1) {
      wrap.append(this.el('div', { class: `step-pip${i <= current ? ' done' : ''}` }));
    }
    return wrap;
  }

  /* -------------------------------------------------------------- */

  private render(): void {
    for (const node of Array.from(this.root.children)) {
      if (node.tagName !== 'STYLE') node.remove();
    }

    const card = this.el('div', { class: 'card' });
    card.append(
      this.el('div', { class: 'blob blob-a' }),
      this.el('div', { class: 'blob blob-b' }),
      this.el('div', { class: 'grain' }),
    );
    const inner = this.el('div', { class: 'inner' });
    card.append(inner);

    if (this.stage === 'calculator') this.renderCalculator(inner);
    else if (this.stage === 'qualify') this.renderQualify(inner);
    else if (this.stage === 'contact') this.renderContact(inner);
    else this.renderDone(inner);

    this.root.append(card);
  }

  /* -------------------------------------------------------------- */
  /* Stage 1: the tool. Nothing personal is asked and nothing is sent. */
  /* -------------------------------------------------------------- */

  private renderCalculator(inner: HTMLElement): void {
    inner.append(this.steps(0));
    inner.append(this.el('div', { class: 'step-label', textContent: 'Step one of three' }));
    inner.append(this.el('h2', { textContent: 'What do you need, and how soon?' }));
    inner.append(
      this.el('p', {
        textContent:
          'Tell us what the material is for and we will work out the packaging and the lead time. Nothing is sent until you ask us to quote.',
      }),
    );

    // Sector before product. The ordering is the point.
    inner.append(
      this.field(
        'What are you using it for?',
        this.select(
          this.draft.sector,
          [{ value: '', label: 'Choose an application' }, ...SECTORS.map((s) => ({ value: s.id, label: s.label }))],
          (v) => {
            const sector = SECTORS.find((s) => s.id === v);
            // Suggest the line that sector usually turns out to want, but only
            // where the visitor has not already chosen for themselves.
            this.update({
              sector: v,
              productId: this.draft.productId || (sector ? sector.leads : ''),
            });
          },
        ),
        'This decides which grade suits you, which matters more than the price per tonne.',
      ),
    );

    const productSelect = this.select(
      this.draft.productId,
      [
        { value: '', label: 'Choose a product' },
        ...PRODUCTS.map((p) => ({ value: p.id, label: `${p.name} · ${p.short}` })),
      ],
      (v) => {
        const next = PRODUCTS.find((p) => p.id === v);
        const packId = next && !next.packs.includes(this.draft.packId) ? next.packs[0]! : this.draft.packId;
        this.update({ productId: v, packId });
      },
    );
    inner.append(this.field('Product', productSelect));

    const product = this.product;

    const row = this.el('div', { class: 'row' });
    const tonnesInput = this.el('input', {
      type: 'number',
      min: '0.1',
      step: '0.1',
      value: String(this.draft.tonnes),
      inputMode: 'decimal',
    });
    tonnesInput.addEventListener('input', () => {
      const n = Number(tonnesInput.value);
      if (Number.isFinite(n) && n > 0) this.update({ tonnes: n });
    });
    row.append(this.field('How many tonnes?', tonnesInput));

    const packs = product ? product.packs : (['bag_25kg', 'fibc_600kg'] as Array<PackSpec['id']>);
    row.append(
      this.field(
        'Packed how?',
        this.select(
          this.draft.packId,
          packs.map((id) => ({ value: id, label: PACKS[id].label })),
          (v) => this.update({ packId: v as PackSpec['id'] }),
        ),
      ),
    );
    inner.append(row);

    if (product) {
      const b = breakDown(product, this.draft.packId, this.draft.tonnes);
      const result = this.el('div', { class: 'result' });
      result.append(
        this.el('div', {
          class: 'figure',
          textContent: `${b.units.toLocaleString('en-GB')} ${b.unitLabel}`,
        }),
      );
      const sub =
        b.pallets === null
          ? `${this.draft.tonnes} t of ${product.name.toLowerCase()}.`
          : `${this.draft.tonnes} t of ${product.name.toLowerCase()}, about ${b.pallets} pallet${b.pallets === 1 ? '' : 's'}${b.palletsAreApproximate ? ' (pallet count to be confirmed)' : ''}.`;
      result.append(this.el('div', { class: 'sub', textContent: sub }));
      result.append(this.el('div', { class: 'lead', textContent: b.leadTime }));
      if (b.regulated) {
        result.append(
          this.el('div', {
            class: 'lead',
            textContent:
              'This is a regulated line. We will need your business details and photographic ID before we can supply it, which is a legal requirement rather than a preference.',
          }),
        );
      }
      inner.append(result);
    }

    const actions = this.el('div', { class: 'actions' });
    const next = this.el('button', {
      class: 'btn primary',
      type: 'button',
      textContent: 'Get a delivered price',
      disabled: !product,
    });
    next.addEventListener('click', () => {
      this.opened = true;
      this.stage = 'qualify';
      this.track('enquiry_opened', { productId: this.draft.productId, tonnes: this.draft.tonnes });
      this.render();
      this.focusFirst();
    });
    actions.append(next);
    actions.append(this.el('span', { class: 'spacer' }));
    const call = this.el('a', {
      class: 'btn',
      href: `tel:${this.config.phone.replace(/\s+/g, '')}`,
      textContent: `Or call ${this.config.phone}`,
    });
    call.addEventListener('click', () => this.track('phone_click'));
    actions.append(call);
    inner.append(actions);
  }

  /* -------------------------------------------------------------- */
  /* Stage 2: qualification. Still nothing personal.                  */
  /* -------------------------------------------------------------- */

  private renderQualify(inner: HTMLElement): void {
    inner.append(this.steps(1));
    inner.append(this.el('div', { class: 'step-label', textContent: 'Step two of three' }));
    inner.append(this.el('h2', { textContent: 'Where is it going, and when?' }));
    inner.append(
      this.el('p', {
        textContent: 'Two questions so the price we send you is a delivered price rather than a guess.',
      }),
    );

    const fulfilment = this.el('div', { class: 'chips' });
    for (const option of [
      { id: 'delivery', label: 'Delivered' },
      { id: 'collection', label: 'We collect' },
    ] as const) {
      const chip = this.el('button', { class: 'chip', type: 'button', textContent: option.label });
      chip.setAttribute('aria-pressed', String(this.draft.fulfilment === option.id));
      chip.addEventListener('click', () => this.update({ fulfilment: option.id }, { silent: true }));
      fulfilment.append(chip);
    }
    inner.append(this.group('Delivery or collection', fulfilment));

    if (this.draft.fulfilment === 'delivery') {
      const postcode = this.el('input', {
        type: 'text',
        value: this.draft.deliveryPostcode,
        placeholder: 'PE30 4JS',
        autocomplete: 'postal-code',
      });
      postcode.addEventListener('input', () => {
        this.draft.deliveryPostcode = postcode.value;
      });
      inner.append(this.field('Delivery postcode', postcode, 'The postcode alone is enough at this stage.'));
    }

    const timing = this.el('div', { class: 'chips' });
    for (const t of TIMINGS) {
      const chip = this.el('button', { class: 'chip', type: 'button', textContent: t });
      chip.setAttribute('aria-pressed', String(this.draft.timing === t));
      chip.addEventListener('click', () => this.update({ timing: t }, { silent: true }));
      timing.append(chip);
    }
    inner.append(this.group('When do you need it?', timing));

    const trade = this.el('input', {
      type: 'text',
      value: this.draft.natureOfTrade,
      placeholder: 'e.g. container glass manufacture',
    });
    trade.addEventListener('input', () => {
      this.draft.natureOfTrade = trade.value;
    });
    inner.append(
      this.field(
        'What does your business do?',
        trade,
        this.product?.regulated
          ? 'Required by law for this product, and it also tells us which grade you actually need.'
          : 'It tells us which grade you actually need.',
      ),
    );

    const actions = this.el('div', { class: 'actions' });
    const back = this.el('button', { class: 'btn', type: 'button', textContent: 'Back' });
    back.addEventListener('click', () => {
      this.stage = 'calculator';
      this.render();
    });
    const next = this.el('button', {
      class: 'btn primary',
      type: 'button',
      textContent: 'Next, your details',
      disabled: !this.draft.timing,
    });
    next.addEventListener('click', () => {
      this.stage = 'contact';
      this.track('enquiry_step_2', {
        fulfilment: this.draft.fulfilment,
        postcode: this.draft.deliveryPostcode || null,
        timing: this.draft.timing,
      });
      this.render();
      this.focusFirst();
    });
    actions.append(back, this.el('span', { class: 'spacer' }), next);
    inner.append(actions);
  }

  /* -------------------------------------------------------------- */
  /* Stage 3: contact, asked last because that is what lifts completion */
  /* -------------------------------------------------------------- */

  private renderContact(inner: HTMLElement): void {
    inner.append(this.steps(2));
    inner.append(this.el('div', { class: 'step-label', textContent: 'Step three of three' }));
    inner.append(this.el('h2', { textContent: 'Where shall we send it?' }));

    if (this.error) {
      const notice = this.el('div', { class: 'notice err' });
      notice.append(this.el('strong', { textContent: 'That did not send. ' }));
      notice.append(document.createTextNode(this.error));
      notice.append(
        document.createTextNode(` You can call us on ${this.config.phone} and we will pick it up from there.`),
      );
      inner.append(notice);
    }

    const summary = this.el('div', { class: 'notice' });
    const product = this.product;
    summary.append(this.el('strong', { textContent: 'Your enquiry: ' }));
    summary.append(
      document.createTextNode(
        `${this.draft.tonnes} t ${product ? product.name.toLowerCase() : ''}, ${PACKS[this.draft.packId].label.toLowerCase()}, ` +
          `${this.draft.fulfilment === 'delivery' ? `delivered${this.draft.deliveryPostcode ? ` to ${this.draft.deliveryPostcode}` : ''}` : 'collected'}. ` +
          `${this.draft.timing}.`,
      ),
    );
    inner.append(summary);

    const row = this.el('div', { class: 'row' });
    const company = this.el('input', { type: 'text', value: this.draft.companyName, autocomplete: 'organization' });
    company.addEventListener('input', () => {
      this.draft.companyName = company.value;
    });
    row.append(this.field('Company', company));

    const name = this.el('input', { type: 'text', value: this.draft.contactName, autocomplete: 'name' });
    name.addEventListener('input', () => {
      this.draft.contactName = name.value;
    });
    row.append(this.field('Your name', name));
    inner.append(row);

    const row2 = this.el('div', { class: 'row' });
    const email = this.el('input', { type: 'email', value: this.draft.email, autocomplete: 'email' });
    email.addEventListener('input', () => {
      this.draft.email = email.value;
      this.render();
    });
    row2.append(this.field('Email', email));

    const phone = this.el('input', { type: 'tel', value: this.draft.phone, autocomplete: 'tel' });
    phone.addEventListener('input', () => {
      this.draft.phone = phone.value;
    });
    row2.append(this.field('Phone', phone));
    inner.append(row2);

    const message = this.el('textarea', { value: this.draft.message });
    message.addEventListener('input', () => {
      this.draft.message = message.value;
    });
    inner.append(this.field('Anything else we should know?', message));

    const actions = this.el('div', { class: 'actions' });
    const back = this.el('button', { class: 'btn', type: 'button', textContent: 'Back' });
    back.addEventListener('click', () => {
      this.stage = 'qualify';
      this.render();
    });
    const send = this.el('button', {
      class: 'btn primary',
      type: 'button',
      textContent: this.busy ? 'Sending…' : 'Send the enquiry',
      disabled: this.busy || !this.draft.email.includes('@') || this.draft.contactName.trim() === '',
    });
    send.addEventListener('click', () => void this.submit());
    actions.append(back, this.el('span', { class: 'spacer' }), send);
    inner.append(actions);

    inner.append(
      this.el('div', {
        class: 'legal',
        textContent:
          'We use these details to quote and to meet our record-keeping duties on regulated products. We do not sell them on.',
      }),
    );

    this.renderSoftCapture(inner);
  }

  /**
   * The visitor who is not ready. One field, still a lead, and the only thing
   * standing between a browsing engineer and nothing at all.
   */
  private renderSoftCapture(inner: HTMLElement): void {
    const soft = this.el('div', { class: 'soft' });
    if (this.softSent) {
      soft.append(
        this.el('p', {
          textContent: 'Saved. We will send the specification and a price when you are ready.',
        }),
      );
      inner.append(soft);
      return;
    }
    soft.append(this.el('p', { textContent: 'Not ready yet? Leave an email and we will send the specification over.' }));
    const line = this.el('div', { class: 'row-inline' });
    const input = this.el('input', { type: 'email', placeholder: 'you@company.co.uk', value: this.draft.email });
    const button = this.el('button', { class: 'btn', type: 'button', textContent: 'Send me the spec' });
    button.addEventListener('click', () => {
      if (!input.value.includes('@')) return;
      this.softSent = true;
      this.track('spec_emailed', {
        email: input.value,
        productId: this.draft.productId || null,
        tonnes: this.draft.tonnes,
      });
      this.render();
    });
    line.append(input, button);
    soft.append(line);
    inner.append(soft);
  }

  /* -------------------------------------------------------------- */

  private async submit(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch(`${this.config.endpoint}/api/public/enquiry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          companyName: this.draft.companyName || null,
          contactName: this.draft.contactName || null,
          email: this.draft.email || null,
          phone: this.draft.phone || null,
          sector: this.draft.sector || null,
          natureOfTrade: this.draft.natureOfTrade || null,
          productIds: this.draft.productId ? [this.draft.productId] : [],
          quantityKg: Math.round(this.draft.tonnes * 1000),
          fulfilment: this.draft.fulfilment,
          deliveryPostcode: this.draft.deliveryPostcode || null,
          timing: this.draft.timing || null,
          // The form never asks a visitor to declare themselves a business, and
          // it never assumes one either. The nature-of-trade answer is what a
          // person assesses; guessing here would defeat the supply restriction.
          buyerType: 'unknown',
          message: this.draft.message || null,
          source: this.utm.source,
          medium: this.utm.medium,
          campaign: this.utm.campaign,
          sessionId: this.sid,
        }),
      });
      const body = (await res.json()) as { ok: boolean; data?: { reference?: string }; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'The server refused it.');

      this.submitted = true;
      this.reference = body.data?.reference ?? null;
      this.stage = 'done';
      this.track('enquiry_submitted', { reference: this.reference });
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Something went wrong.';
      this.track('enquiry_failed', { reason: this.error });
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private reference: string | null = null;

  private renderDone(inner: HTMLElement): void {
    inner.append(this.el('div', { class: 'done-mark', textContent: '✓' }));
    inner.append(this.el('h2', { textContent: 'That is with us.' }));
    inner.append(
      this.el('p', {
        textContent: this.reference
          ? `Your reference is ${this.reference}. We will confirm stock and come back with a delivered price.`
          : 'We will confirm stock and come back with a delivered price.',
      }),
    );

    const what = this.el('div', { class: 'notice' });
    what.append(this.el('strong', { textContent: 'What happens next. ' }));
    what.append(
      document.createTextNode(
        'We check the grade against what you told us it is for, confirm what is on the floor at King’s Lynn, ' +
          'and send a delivered price. If it is a regulated line we will ask for your business details and ' +
          'photographic ID at that point, because we cannot supply it otherwise.',
      ),
    );
    inner.append(what);

    const actions = this.el('div', { class: 'actions' });
    const call = this.el('a', {
      class: 'btn',
      href: `tel:${this.config.phone.replace(/\s+/g, '')}`,
      textContent: `Call ${this.config.phone}`,
    });
    const again = this.el('button', { class: 'btn', type: 'button', textContent: 'Price something else' });
    again.addEventListener('click', () => {
      this.stage = 'calculator';
      this.submitted = false;
      this.opened = false;
      this.reference = null;
      this.render();
    });
    actions.append(call, this.el('span', { class: 'spacer' }), again);
    inner.append(actions);
  }

  private focusFirst(): void {
    const first = this.root.querySelector<HTMLElement>('input, select, button.chip');
    first?.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/**
 * Find the script tag that loaded this.
 *
 * document.currentScript is null inside an ES module, and matching on the
 * built filename alone breaks the moment the file is renamed or bundled into
 * the site's own JavaScript. Matching on the configuration attributes as well
 * means the tag is found however it was included.
 */
function findScript(): HTMLScriptElement | null {
  return (
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>(
      'script[data-endpoint], script[data-mount], script[src*="ukn-enquiry"]',
    )
  );
}

function readConfig(script: HTMLScriptElement | null): Config {
  const origin = (() => {
    try {
      return script?.src ? new URL(script.src).origin : window.location.origin;
    } catch {
      return window.location.origin;
    }
  })();
  const surface = script?.dataset['surface'] === 'light' ? 'light' : 'dark';
  const profile = script?.dataset['profile'] === 'group' ? 'group' : 'ukn';
  return {
    endpoint: (script?.dataset['endpoint'] ?? origin).replace(/\/+$/, ''),
    phone: script?.dataset['phone'] ?? '01553 817744',
    surface,
    profile,
  };
}

/**
 * Mount into a selector explicitly. The script tag mounts one instance on its
 * own; this is for a page that wants a second, or wants to place one after the
 * fact without another script tag.
 */
export function mount(
  selector: string,
  overrides: Partial<Config> = {},
): void {
  const config = { ...readConfig(findScript()), ...overrides };
  document.querySelectorAll<HTMLElement>(selector).forEach((host) => {
    if (host.shadowRoot) return;
    new EnquiryWidget(host, config);
  });
}

function boot(): void {
  const config = readConfig(findScript());
  const selector = findScript()?.dataset['mount'] ?? '#ukn-enquiry';

  const run = () => {
    document.querySelectorAll<HTMLElement>(selector).forEach((host) => {
      if (host.shadowRoot) return;
      new EnquiryWidget(host, config);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

boot();
