import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import type { Row } from '../types';
import { Button, Callout, Chip, Empty, Field, Panel, Stat } from '../components/ui';
import { gbp, shortDate, tonnes } from '../format';

interface StoragePayload {
  agreements: Array<{
    id: string;
    accountId: string;
    feeBasis: string;
    ratePence: number | null;
    palletPositions: number | null;
    startedAt: string;
    endedAt: string | null;
    dutyAccepted: boolean;
    notes: string;
  }>;
  holdings: Array<{ accountId: string; productId: string; heldKg: number }>;
  movements: Array<{ id: string; accountId: string; productId: string; direction: string; quantityKg: number; occurredAt: string }>;
  capacity: {
    totalPalletPositions: number | null;
    occupiedPalletPositions: number;
    utilisationBps: number | null;
    revenueAtFullOccupancy: number | null;
    currentMonthlyRevenue: number;
    headroom: string;
  };
  unresolvedCharges: number;
  charges: Row[];
}

export function Storage({ ctx }: { ctx: Ctx }) {
  const { data, loading, reload } = useApi<StoragePayload>('/api/storage', [ctx.version]);
  const accounts = useApi<{ accounts: Row[] }>('/api/accounts', [ctx.version]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    accountId: '',
    feeBasis: 'per_pallet_month',
    ratePounds: '',
    palletPositions: '',
    startedAt: new Date().toISOString().slice(0, 10),
    dutyAccepted: false,
  });

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (!data) return null;

  const accountName = (id: string) =>
    (accounts.data?.accounts ?? []).find((a) => String(a['id']) === id)?.['name'] ?? id;
  const productName = (id: string) => ctx.reference.products.find((p) => p.id === id)?.name ?? id;

  async function createAgreement(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/storage/agreements', {
        accountId: form.accountId,
        feeBasis: form.feeBasis,
        ratePence: form.ratePounds ? Math.round(Number(form.ratePounds) * 100) : null,
        palletPositions: form.palletPositions ? Number(form.palletPositions) : null,
        startedAt: form.startedAt,
        dutyAccepted: form.dutyAccepted,
      });
      setAdding(false);
      reload();
      ctx.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function billingRun() {
    setBusy(true);
    try {
      await api.post('/api/storage/billing-run', {});
      reload();
      ctx.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Storage</div>
        <h1>The only line that repeats</h1>
        <p>
          What the customer buys here is not space, it is the discharge of a regulatory duty. That makes it
          a moat when compliance is solid and a liability when it is not.
        </p>
      </div>

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel>
          <Stat label="Monthly storage revenue" value={gbp(data.capacity.currentMonthlyRevenue, true)} hero />
        </Panel>
        <Panel>
          <Stat
            label="Pallet positions let"
            value={
              data.capacity.totalPalletPositions === null
                ? String(data.capacity.occupiedPalletPositions)
                : `${data.capacity.occupiedPalletPositions} of ${data.capacity.totalPalletPositions}`
            }
            tag={data.capacity.totalPalletPositions === null ? 'U' : 'V'}
            note={data.capacity.headroom}
          />
        </Panel>
        <Panel>
          <Stat
            label="At full occupancy"
            value={data.capacity.revenueAtFullOccupancy === null ? 'Not known' : gbp(data.capacity.revenueAtFullOccupancy, true)}
            unknown={data.capacity.revenueAtFullOccupancy === null}
            note="Needs both the fee schedule and a count of the racking."
          />
        </Panel>
        <Panel>
          <Stat
            label="Months that could not be billed"
            value={String(data.unresolvedCharges)}
            note="Raised as unresolved rather than charged at zero, so a blank fee schedule shows as a gap."
          />
        </Panel>
      </div>

      {data.unresolvedCharges > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="warn" title="Storage revenue is being lost silently.">
            {data.unresolvedCharges} monthly charge{data.unresolvedCharges === 1 ? '' : 's'} could not be raised because
            no rate is recorded against the agreement. That is Q3, and it also stops the 25 per cent storage
            commission accruing.
          </Callout>
        </div>
      )}

      <Panel
        title="Agreements"
        action={
          <div className="row">
            <Button small disabled={busy} onClick={billingRun}>Run this month&rsquo;s billing</Button>
            <Button variant="primary" small onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'New agreement'}</Button>
          </div>
        }
      >
        {adding && (
          <form onSubmit={createAgreement} className="grid cols-3" style={{ marginBottom: 18, alignItems: 'end' }}>
            <Field label="Account">
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} required>
                <option value="">Choose</option>
                {(accounts.data?.accounts ?? []).map((a) => (
                  <option key={String(a['id'])} value={String(a['id'])}>{String(a['name'])}</option>
                ))}
              </select>
            </Field>
            <Field label="Charged on">
              <select value={form.feeBasis} onChange={(e) => setForm({ ...form, feeBasis: e.target.value })}>
                <option value="per_pallet_month">Per pallet position, per month</option>
                <option value="per_tonne_month">Per tonne held, per month</option>
                <option value="flat_month">Flat monthly fee</option>
              </select>
            </Field>
            <Field label="Rate, £" help="Leave blank if the fee has not been agreed. It will show as a gap, not as free.">
              <input type="number" step="0.01" value={form.ratePounds} onChange={(e) => setForm({ ...form, ratePounds: e.target.value })} />
            </Field>
            <Field label="Pallet positions">
              <input type="number" value={form.palletPositions} onChange={(e) => setForm({ ...form, palletPositions: e.target.value })} />
            </Field>
            <Field label="Started">
              <input type="date" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} required />
            </Field>
            <div>
              <label className="row" style={{ gap: 8, fontSize: 13, marginBottom: 10 }}>
                <input type="checkbox" checked={form.dutyAccepted} onChange={(e) => setForm({ ...form, dutyAccepted: e.target.checked })} style={{ width: 'auto' }} />
                Notification duty accepted in writing
              </label>
              <Button variant="primary" type="submit" disabled={busy}>Create</Button>
            </div>
          </form>
        )}

        {data.agreements.length === 0 ? (
          <Empty>No storage agreements. The shed is roughly 5 per cent occupied, so the constraint is sales, not space.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Account</th><th>Basis</th><th className="num">Rate</th><th className="num">Positions</th><th>Duty</th><th className="num">Started</th></tr>
              </thead>
              <tbody>
                {data.agreements.map((a) => (
                  <tr key={a.id}>
                    <td>{String(accountName(a.accountId))}</td>
                    <td className="muted">{a.feeBasis.replace(/_/g, ' ')}</td>
                    <td className="num">
                      {a.ratePence === null ? <span className="dim">Not agreed</span> : gbp(a.ratePence)}
                    </td>
                    <td className="num">{a.palletPositions ?? '—'}</td>
                    <td>{a.dutyAccepted ? <Chip tone="good">Accepted</Chip> : <Chip tone="warn">Not in writing</Chip>}</td>
                    <td className="num muted">{shortDate(a.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid cols-2">
        <Panel title="What is on the racking now">
          {data.holdings.length === 0 ? (
            <Empty>Nothing held.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Account</th><th>Product</th><th className="num">Held</th></tr></thead>
                <tbody>
                  {data.holdings.map((h) => (
                    <tr key={h.accountId + h.productId}>
                      <td>{String(accountName(h.accountId))}</td>
                      <td className="muted">{productName(h.productId)}</td>
                      <td className="num">{tonnes(h.heldKg, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Movements" hint="Every intake is checked against the notification thresholds as it lands">
          {data.movements.length === 0 ? (
            <Empty>No movements recorded.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th className="num">Date</th><th>Account</th><th>Product</th><th className="num">Quantity</th></tr></thead>
                <tbody>
                  {data.movements.slice(0, 12).map((m) => (
                    <tr key={m.id}>
                      <td className="num muted">{shortDate(m.occurredAt)}</td>
                      <td>{String(accountName(m.accountId))}</td>
                      <td className="muted">{productName(m.productId)}</td>
                      <td className="num">
                        <Chip tone={m.direction === 'in' ? 'good' : 'neutral'}>{m.direction}</Chip>{' '}
                        {tonnes(m.quantityKg, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
