import { useState } from 'react';
import type { Ctx } from '../App';
import { api, ApiError } from '../api';
import { useApi } from '../hooks';
import type { DealPricing, Row } from '../types';
import { Button, Callout, Chip, Empty, Field, Panel, Stat, Tag } from '../components/ui';
import { gbp, pct, shortDate, tonnes } from '../format';

interface DealPayload {
  deal: Row;
  lines: Row[];
  quotes: Row[];
  activities: Row[];
  pricing: DealPricing;
}

const STAGES = ['enquiry', 'qualified', 'quoted', 'negotiation'] as const;

export function DealDetail({ ctx, dealId }: { ctx: Ctx; dealId: string }) {
  const { data, error, loading, reload } = useApi<DealPayload>(dealId ? `/api/deals/${dealId}` : null, [ctx.version]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; detail: unknown } | null>(null);
  const [adding, setAdding] = useState(false);
  const [line, setLine] = useState({
    productId: '',
    tonnes: '',
    costPerTonne: '',
    sellPerTonne: '',
    costTag: 'E',
  });

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (error) return <Callout tone="critical">{error}</Callout>;
  if (!data) return null;

  const { deal, lines, quotes, pricing } = data;
  const productName = (id: string) => ctx.reference.products.find((p) => p.id === id)?.name ?? id;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
      ctx.refresh();
    } catch (err) {
      if (err instanceof ApiError) setActionError({ message: err.message, detail: err.detail });
      else setActionError({ message: 'Something went wrong.', detail: null });
    } finally {
      setBusy(false);
    }
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    await run(() =>
      api.post(`/api/deals/${dealId}/lines`, {
        productId: line.productId,
        quantityKg: Math.round(Number(line.tonnes) * 1000),
        costPerTonne: Math.round(Number(line.costPerTonne) * 100),
        sellPerTonne: Math.round(Number(line.sellPerTonne) * 100),
        costTag: line.costTag,
      }),
    );
    setAdding(false);
    setLine({ productId: '', tonnes: '', costPerTonne: '', sellPerTonne: '', costTag: 'E' });
  }

  const gateTone = pricing.gate.decision === 'blocked' ? 'critical' : pricing.gate.decision === 'warn' ? 'warn' : 'good';

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <a href="#pipeline">Pipeline</a> · {String(deal['reference'])}
        </div>
        <h1>{String(deal['title'])}</h1>
        <p>
          <a href={`#account/${deal['account_id']}`}>{String(deal['account_name'])}</a>
          {deal['sector'] ? ` · ${String(deal['sector']).replace(/_/g, ' ')}` : ''} ·{' '}
          {String(deal['origin']) === 'new' ? 'New account, 25% of margin' : "Inherited account, 7.5% of margin"}
        </p>
      </div>

      {/* The gate sits above the numbers because it decides whether the numbers
          can be acted on at all. */}
      <div className="stack" style={{ marginBottom: 16 }}>
        <Callout tone={gateTone} title={
          pricing.gate.decision === 'blocked'
            ? 'This quote cannot be sent.'
            : pricing.gate.decision === 'warn'
              ? 'Verification needs attention.'
              : 'Cleared to quote.'
        }>
          {pricing.gate.regulatedProducts.length > 0 && (
            <>
              {pricing.gate.regulatedProducts.join(' and ')}{' '}
              {pricing.gate.regulatedProducts.length === 1 ? 'is an explosives precursor' : 'are explosives precursors'}
              , so the Poisons Act buyer checks apply to this sale.{' '}
            </>
          )}
          {pricing.gate.reasons.join(' ')}
          {pricing.gate.requiredActions.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {pricing.gate.requiredActions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          {pricing.gate.decision === 'blocked' && (
            <div style={{ marginTop: 10 }}>
              <Button small onClick={() => ctx.navigate(`account/${deal['account_id']}`)}>
                Open buyer verification
              </Button>
            </div>
          )}
        </Callout>

        {pricing.guards.map((g) => (
          <Callout key={g.code + g.message} tone={g.severity === 'block' ? 'critical' : g.severity === 'warn' ? 'warn' : 'info'}>
            {g.message}
          </Callout>
        ))}
      </div>

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Revenue" value={gbp(pricing.margin.revenue)} /></Panel>
        <Panel><Stat label="Laid-down cost" value={gbp(pricing.margin.cost)} /></Panel>
        <Panel>
          <Stat
            label="Gross margin"
            value={gbp(pricing.margin.grossMargin)}
            hero
            note={`${pct(pricing.margin.gmBps)} of revenue.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Your commission"
            value={gbp(Math.round(pricing.margin.grossMargin * (String(deal['origin']) === 'new' ? 0.25 : 0.075)))}
            note={`${String(deal['origin']) === 'new' ? '25' : '7.5'} per cent of gross margin, payable once Tom is paid.`}
          />
        </Panel>
      </div>

      {/* Mix shift, at the only moment it is useful: while the deal is still open. */}
      {pricing.mixShift.length > 0 && (
        <Panel
          className="rise"
          title="This is a commodity deal"
          hint="Same customer, same effort, different product"
        >
          {pricing.mixShift.map((m) => (
            <div key={m.fromProductId + m.toProductId} style={{ marginBottom: 14 }}>
              <p>
                <strong>{productName(m.fromProductId)}</strong> → <strong>{productName(m.toProductId)}</strong>. {m.rationale}
              </p>
              <p className="dim" style={{ fontSize: 12.5, marginTop: 10 }}>
                Both sides are modelled at the midpoint of each product&rsquo;s target margin band, not at the
                price on this deal, so the two are compared on the same footing.
              </p>
              <div className="grid cols-3" style={{ marginTop: 12 }}>
                <Stat
                  label="This line, at its band"
                  value={m.currentGm.value === null ? 'Not known' : gbp(m.currentGm.value, true)}
                  tag={m.currentGm.tag}
                  unknown={m.currentGm.value === null}
                />
                <Stat
                  label="The alternative, at its band"
                  value={m.suggestedGm.value === null ? 'Not known' : gbp(m.suggestedGm.value, true)}
                  tag={m.suggestedGm.tag}
                  unknown={m.suggestedGm.value === null}
                />
                <Stat
                  label="Difference to you"
                  value={m.commissionUplift.value === null ? `Blocked by ${m.commissionUplift.blockedBy ?? 'Q2'}` : gbp(m.commissionUplift.value, true)}
                  tag={m.commissionUplift.tag}
                  unknown={m.commissionUplift.value === null}
                />
              </div>
              <div style={{ marginTop: 12 }}>
                <Callout tone="warn">{m.caveat}</Callout>
              </div>
            </div>
          ))}
        </Panel>
      )}

      <Panel
        title="Lines"
        action={<Button small onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'Add line'}</Button>}
      >
        {adding && (
          <form onSubmit={addLine} className="grid cols-4" style={{ marginBottom: 18, alignItems: 'end' }}>
            <Field label="Product">
              <select value={line.productId} onChange={(e) => setLine({ ...line, productId: e.target.value })} required>
                <option value="">Choose</option>
                {ctx.reference.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Tonnes">
              <input type="number" step="0.001" min="0.001" value={line.tonnes} onChange={(e) => setLine({ ...line, tonnes: e.target.value })} required />
            </Field>
            <Field label="Laid-down cost, £/t" help="Goods plus freight plus handling">
              <input type="number" step="0.01" min="0" value={line.costPerTonne} onChange={(e) => setLine({ ...line, costPerTonne: e.target.value })} required />
            </Field>
            <Field label="Sell, £/t">
              <input type="number" step="0.01" min="0" value={line.sellPerTonne} onChange={(e) => setLine({ ...line, sellPerTonne: e.target.value })} required />
            </Field>
            <Field label="How reliable is that cost">
              <select value={line.costTag} onChange={(e) => setLine({ ...line, costTag: e.target.value })}>
                <option value="V">Verified, from an invoice</option>
                <option value="R">Reported by a supplier</option>
                <option value="E">Estimated</option>
                <option value="A">Assumed</option>
              </select>
            </Field>
            <div>
              <Button variant="primary" type="submit" disabled={busy}>Add</Button>
            </div>
          </form>
        )}

        {lines.length === 0 ? (
          <Empty>No lines yet. Add one to price the deal.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Quantity</th>
                  <th className="num">Cost £/t</th>
                  <th className="num">Sell £/t</th>
                  <th className="num">Margin</th>
                  <th className="num">£/t margin</th>
                  <th>Against market</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const m = pricing.margin.lines.find((x) => x.productId === String(l['product_id']));
                  const anchor = pricing.anchors.find((a) => a.productId === String(l['product_id']));
                  return (
                    <tr key={String(l['id'])}>
                      <td>
                        {String(l['product_name'])}
                        <div style={{ marginTop: 4 }}>
                          <Chip tone={String(l['product_class']) === 'specialty' ? 'specialty' : 'commodity'}>
                            {String(l['product_class'])}
                          </Chip>
                        </div>
                      </td>
                      <td className="num">{tonnes(Number(l['quantity_kg']))}</td>
                      <td className="num">
                        {gbp(Number(l['cost_per_tonne']))}
                        <Tag tag={String(l['cost_tag'])} />
                      </td>
                      <td className="num">{gbp(Number(l['sell_per_tonne']))}</td>
                      <td className="num">
                        {gbp(m?.grossMargin ?? 0)}
                        <div className="dim">{pct(m?.gmBps ?? 0)}</div>
                      </td>
                      <td className="num">{gbp(m?.gmPerTonne ?? 0)}</td>
                      <td style={{ maxWidth: 280, fontSize: 12.5, color: 'var(--text-2)' }}>
                        {anchor?.check.anchored ? anchor.check.message : 'No published reference price.'}
                      </td>
                      <td className="num">
                        <Button
                          small
                          variant="danger"
                          disabled={busy}
                          onClick={() => run(() => api.del(`/api/deals/${dealId}/lines/${l['id']}`))}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Move it on">
        {actionError && (
          <div style={{ marginBottom: 12 }}>
            <Callout tone="critical" title={actionError.message}>
              {Array.isArray((actionError.detail as { reasons?: string[] })?.reasons)
                ? (actionError.detail as { reasons: string[] }).reasons.join(' ')
                : 'Clear the blockers above and try again.'}
            </Callout>
          </div>
        )}
        <div className="row">
          {String(deal['stage']) !== 'won' && String(deal['stage']) !== 'lost' && (
            <>
              <Field label="Stage">
                <select
                  value={String(deal['stage'])}
                  onChange={(e) => run(() => api.patch(`/api/deals/${dealId}`, { stage: e.target.value }))}
                  disabled={busy}
                >
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Button
                disabled={busy || !pricing.sendable}
                onClick={() => run(() => api.post(`/api/deals/${dealId}/quote`, {}))}
                title={pricing.sendable ? '' : pricing.blockers.join(' ')}
              >
                Issue quote
              </Button>
              <Button
                variant="primary"
                disabled={busy || !pricing.sendable}
                onClick={() => run(() => api.post(`/api/deals/${dealId}/win`, {}))}
              >
                Mark won
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Why was it lost?');
                  if (reason) void run(() => api.patch(`/api/deals/${dealId}`, { stage: 'lost', lostReason: reason }));
                }}
              >
                Mark lost
              </Button>
            </>
          )}
          {String(deal['stage']) === 'won' && <Chip tone="good">Won</Chip>}
          {String(deal['stage']) === 'lost' && (
            <Chip tone="critical">Lost{deal['lost_reason'] ? `: ${String(deal['lost_reason'])}` : ''}</Chip>
          )}
        </div>
        {!pricing.sendable && (
          <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
            {pricing.blockers.join(' ')}
          </div>
        )}
      </Panel>

      {quotes.length > 0 && (
        <Panel title="Quotes" hint="Each one is a frozen snapshot of the pricing at the moment it went out">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th className="num">Revenue</th>
                  <th className="num">Margin</th>
                  <th className="num">Valid until</th>
                  <th className="num">Issued</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={String(q['id'])}>
                    <td className="num">{String(q['reference'])}</td>
                    <td className="num">{gbp(Number(q['revenue']))}</td>
                    <td className="num">{gbp(Number(q['gross_margin']))} <span className="dim">{pct(Number(q['gm_bps']))}</span></td>
                    <td className="num">{shortDate(String(q['valid_until'] ?? ''))}</td>
                    <td className="num">{shortDate(String(q['created_at']))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
