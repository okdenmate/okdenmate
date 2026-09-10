import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import type { Row } from '../types';
import { Button, Callout, Chip, Empty, Panel, Stat } from '../components/ui';
import { shortDate, tonnes } from '../format';

interface EnquiryRow extends Row {
  productIds: string[];
  productNames: string[];
  isCommodityOnly: boolean;
  suggestedRoute: { productId: string; rationale: string };
}

export function Enquiries({ ctx }: { ctx: Ctx }) {
  const { data, loading, reload } = useApi<{ enquiries: EnquiryRow[] }>('/api/enquiries', [ctx.version]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = data?.enquiries ?? [];
  const fresh = all.filter((e) => e['status'] === 'new');
  const productName = (id: string) => ctx.reference.products.find((p) => p.id === id)?.name ?? id;

  async function convert(enquiry: EnquiryRow) {
    setBusy(String(enquiry['id']));
    setError(null);
    try {
      const res = await api.post<{ dealId: string }>(`/api/enquiries/${enquiry['id']}/convert`, {});
      ctx.refresh();
      ctx.navigate(`deal/${res.dealId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert.');
    } finally {
      setBusy(null);
    }
  }

  async function disqualify(enquiry: EnquiryRow) {
    const reason = window.prompt('Why is this not a lead?');
    if (!reason) return;
    setBusy(String(enquiry['id']));
    try {
      await api.post(`/api/enquiries/${enquiry['id']}/disqualify`, { reason });
      reload();
      ctx.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Enquiries</div>
        <h1>Inbox</h1>
        <p>
          Everything posted to the public intake endpoint arrives here. Until the live site&rsquo;s Enquire
          buttons are repointed at it, this counts only what is sent deliberately.
        </p>
      </div>

      <div className="grid cols-3 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Waiting on you" value={String(fresh.length)} hero /></Panel>
        <Panel>
          <Stat
            label="Commodity-only enquiries"
            value={String(all.filter((e) => e.isCommodityOnly).length)}
            note="Each one is a mix-shift conversation before it is a quote."
          />
        </Panel>
        <Panel>
          <Stat label="Converted" value={String(all.filter((e) => e['status'] === 'converted').length)} />
        </Panel>
      </div>

      {error && <Callout tone="critical">{error}</Callout>}

      <Panel title="How to wire the live site" hint="This closes the gap the brief calls unmeasurable">
        <p className="muted">
          Post the enquiry form to <code>/api/public/enquiry</code> and send stage events to{' '}
          <code>/api/public/events</code>. The homepage Enquire buttons currently point at a URL containing a
          space and the footer contact route returns a 404, so no enquiry is countable today. A mailto link
          is not a fix: it leaves no record of who started and abandoned.
        </p>
      </Panel>

      <Panel title="Enquiries">
        {loading && all.length === 0 ? (
          <Empty>Loading…</Empty>
        ) : all.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <div className="stack">
            {all.map((e) => (
              <div key={String(e['id'])} className="callout info" style={{ display: 'block' }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>
                      {String(e['company_name'] ?? e['contact_name'] ?? 'Unnamed enquiry')}
                    </strong>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {shortDate(String(e['created_at']))}
                      {e['source'] ? ` · ${String(e['source'])}` : ''}
                      {e['sector'] ? ` · ${String(e['sector']).replace(/_/g, ' ')}` : ''}
                    </div>
                  </div>
                  <div className="row">
                    <Chip tone={e['status'] === 'new' ? 'warn' : e['status'] === 'converted' ? 'good' : 'neutral'}>
                      {String(e['status'])}
                    </Chip>
                    {e.isCommodityOnly && <Chip tone="commodity">Commodity only</Chip>}
                    {String(e['buyer_type']) === 'member_of_public' && <Chip tone="critical">Member of the public</Chip>}
                  </div>
                </div>

                <div className="row" style={{ gap: 20, fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                  <span>{e.productNames.length > 0 ? e.productNames.join(', ') : 'No product stated'}</span>
                  {Number(e['quantity_kg']) > 0 && <span>{tonnes(Number(e['quantity_kg']), 1)}</span>}
                  <span>{String(e['fulfilment'] ?? 'delivery')}</span>
                  {e['delivery_postcode'] && <span>{String(e['delivery_postcode'])}</span>}
                  {e['timing'] && <span>{String(e['timing'])}</span>}
                </div>

                {e['nature_of_trade'] && (
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    <span className="dim">Trade: </span>{String(e['nature_of_trade'])}
                  </div>
                )}
                {e['message'] && <p className="muted" style={{ fontSize: 13 }}>{String(e['message'])}</p>}

                {e.isCommodityOnly && e['status'] === 'new' && (
                  <div style={{ marginTop: 10 }}>
                    <Callout tone="warn" title={`Ask about ${productName(e.suggestedRoute.productId)} first.`}>
                      {e.suggestedRoute.rationale}
                    </Callout>
                  </div>
                )}

                {e['status'] === 'new' && (
                  <div className="row" style={{ marginTop: 12 }}>
                    <Button variant="primary" small disabled={busy === String(e['id'])} onClick={() => convert(e)}>
                      Convert to a deal
                    </Button>
                    <Button small variant="danger" disabled={busy === String(e['id'])} onClick={() => disqualify(e)}>
                      Not a lead
                    </Button>
                  </div>
                )}
                {e['status'] === 'converted' && e['deal_id'] && (
                  <div style={{ marginTop: 10 }}>
                    <Button small onClick={() => ctx.navigate(`deal/${e['deal_id']}`)}>Open the deal</Button>
                  </div>
                )}
                {e['disqualified_reason'] && (
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
                    Disqualified: {String(e['disqualified_reason'])}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
