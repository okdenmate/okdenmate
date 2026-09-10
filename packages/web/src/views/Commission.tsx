import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import type { Row } from '../types';
import { Button, Callout, Chip, Empty, Panel, Stat } from '../components/ui';
import { gbp, pct, shortDate } from '../format';

interface CommissionPayload {
  entries: Row[];
  summary: { accrued: number; payable: number; paid: number; total: number; recurring: number; count: number; byBusiness: Record<string, number> };
  rates: Array<{ id: string; business: string; line: string; basis: string; bps: number; description: string }>;
}

export function Commission({ ctx }: { ctx: Ctx }) {
  const { data, loading, reload } = useApi<CommissionPayload>('/api/commission', [ctx.version]);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (!data) return null;

  const { entries, summary, rates } = data;

  async function markPaid(entryId: string) {
    setBusy(entryId);
    try {
      await api.post(`/api/commission/${entryId}/paid`);
      reload();
      ctx.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Commission</div>
        <h1>What you have earned</h1>
        <p>
          Nothing becomes payable until Tom is paid, so commission lags every order by the customer&rsquo;s
          terms. The ledger shows that lag rather than treating an order as cash.
        </p>
      </div>

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Paid" value={gbp(summary.paid, true)} hero /></Panel>
        <Panel><Stat label="Payable now" value={gbp(summary.payable, true)} note="The order is settled; this is owed." /></Panel>
        <Panel><Stat label="Accrued" value={gbp(summary.accrued, true)} note="Earned, waiting on the customer to pay." /></Panel>
        <Panel>
          <Stat
            label="Recurring"
            value={gbp(summary.recurring, true)}
            note="From storage. The only line that repeats without a new sale."
          />
        </Panel>
      </div>

      <Panel title="The rates" hint="Fixed and accepted, 1 September 2026. Encoded rather than configurable.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Line</th><th>Business</th><th>Paid on</th><th className="num">Rate</th><th>Note</th></tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td>{r.line}</td>
                  <td>{r.business === 'UKN' ? 'UK Nitrates' : 'Reeve Wood'}</td>
                  <td className="muted">{r.basis.replace(/_/g, ' ')}</td>
                  <td className="num">{pct(r.bps, r.bps % 100 === 0 ? 0 : 1)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14 }}>
          <Callout tone="warn" title="Q12 is unresolved.">
            It is not written down whether the 25 per cent new-account rate applies to that account&rsquo;s later
            orders. This system takes the conservative reading and pays the repeat rate, so forecasts are not
            inflated by an entitlement that was never agreed. Get it in writing before it matters.
          </Callout>
        </div>
      </Panel>

      <Panel title="Ledger" hint={`${summary.count} entries`}>
        {entries.length === 0 ? (
          <Empty>Nothing yet. Commission is created when a deal is marked won.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Account</th>
                  <th className="num">Basis</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th className="num">Payable from</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={String(e['id'])}>
                    <td>
                      {String(e['source_type']) === 'storage_period' ? 'Storage' : 'Order'}
                      <div className="dim">{shortDate(String(e['occurred_at']))}</div>
                    </td>
                    <td className="muted">{String(e['account_name'] ?? '—')}</td>
                    <td className="num">
                      {gbp(Number(e['basis_amount']), true)}
                      <div className="dim">{String(e['basis']).replace(/_/g, ' ')}</div>
                    </td>
                    <td className="num">{pct(Number(e['rate_bps']), Number(e['rate_bps']) % 100 === 0 ? 0 : 1)}</td>
                    <td className="num">{gbp(Number(e['amount']))}</td>
                    <td>
                      <Chip tone={e['status'] === 'paid' ? 'good' : e['status'] === 'payable' ? 'warn' : 'neutral'}>
                        {String(e['status'])}
                      </Chip>
                    </td>
                    <td className="num muted">{shortDate(String(e['expected_payable_at']))}</td>
                    <td className="num">
                      {e['status'] === 'payable' && (
                        <Button small disabled={busy === String(e['id'])} onClick={() => markPaid(String(e['id']))}>
                          Mark paid
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.some((e) => String(e['note'] ?? '').length > 0) && (
          <div className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>
            {entries.find((e) => String(e['note'] ?? '').length > 0)?.['note'] as string}
          </div>
        )}
      </Panel>
    </>
  );
}
