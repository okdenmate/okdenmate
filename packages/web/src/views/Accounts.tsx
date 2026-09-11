import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import type { Row } from '../types';
import { Button, Callout, Chip, Empty, Field, Panel } from '../components/ui';
import { gbp, shortDate } from '../format';

/**
 * How an account takes the material. It is a commercial fact, not a preference:
 * a buyer who wants it off the floor is a margin sale, and one who leaves it on
 * our racking is a margin sale plus the only recurring fee in the business.
 */
export function Fulfilment({ value, storage = 0 }: { value: string; storage?: number }) {
  if (value === 'storage') {
    return (
      <>
        <Chip tone="good">Stored here</Chip>
        {storage === 0 && (
          <div style={{ marginTop: 4 }}>
            <Chip tone="warn">No agreement</Chip>
          </div>
        )}
      </>
    );
  }
  if (value === 'immediate') return <Chip tone="specialty">Immediately</Chip>;
  if (value === 'scheduled') return <Chip tone="neutral">Called off</Chip>;
  return <Chip tone="warn">Not established</Chip>;
}

export function Accounts({ ctx }: { ctx: Ctx }) {
  const [search, setSearch] = useState('');
  const { data, loading, reload } = useApi<{ accounts: Row[] }>(
    `/api/accounts${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    [ctx.version, search],
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    sector: '',
    origin: 'new',
    natureOfTrade: '',
    preferredProductId: '',
    fulfilmentPreference: 'unknown',
    typicalTonnes: '',
    possibleDirectImporter: false,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ id: string }>('/api/accounts', {
        name: form.name,
        sector: form.sector || null,
        origin: form.origin,
        natureOfTrade: form.natureOfTrade || null,
        preferredProductId: form.preferredProductId || null,
        fulfilmentPreference: form.fulfilmentPreference,
        typicalOrderKg: form.typicalTonnes ? Math.round(Number(form.typicalTonnes) * 1000) : null,
        possibleDirectImporter: form.possibleDirectImporter,
      });
      setCreating(false);
      setForm({
        name: '',
        sector: '',
        origin: 'new',
        natureOfTrade: '',
        preferredProductId: '',
        fulfilmentPreference: 'unknown',
        typicalTonnes: '',
        possibleDirectImporter: false,
      });
      reload();
      ctx.navigate(`account/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    }
  }

  const accounts = data?.accounts ?? [];

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Accounts</div>
        <h1>The book</h1>
        <p>
          Ordered by gross margin, because that is what pays. An account with no verification record
          cannot be sold a regulated nitrate line, and the quote screen will refuse.
        </p>
      </div>

      <Panel
        title={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
        action={
          <div className="row">
            <input
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 180 }}
            />
            <Button variant="primary" small onClick={() => setCreating((c) => !c)}>
              {creating ? 'Cancel' : 'New account'}
            </Button>
          </div>
        }
      >
        {creating && (
          <form onSubmit={create} style={{ maxWidth: 460, marginBottom: 18 }}>
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Sector" help="Decides which specialty line the mix-shift prompt suggests.">
              <select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
                <option value="">Not known yet</option>
                {ctx.reference.sectors.map((s) => (
                  <option key={s.id} value={s.id}>{s.id.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="What do they make or do" help="Required at the point of sale for a regulated line, and it decides which grade they need.">
              <input
                value={form.natureOfTrade}
                onChange={(e) => setForm({ ...form, natureOfTrade: e.target.value })}
                placeholder="e.g. container glass manufacture"
              />
            </Field>
            <Field label="Which nitrate do they buy">
              <select
                value={form.preferredProductId}
                onChange={(e) => setForm({ ...form, preferredProductId: e.target.value })}
              >
                <option value="">Not known yet</option>
                {ctx.reference.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field
              label="How do they take it"
              help="Whether they want it off the floor or leave it on our racking decides whether this account also carries a recurring fee."
            >
              <select
                value={form.fulfilmentPreference}
                onChange={(e) => setForm({ ...form, fulfilmentPreference: e.target.value })}
              >
                <option value="unknown">Not established</option>
                <option value="immediate">Immediately, off the floor</option>
                <option value="storage">Stored here on our racking</option>
                <option value="scheduled">Called off against a schedule</option>
              </select>
            </Field>
            <Field label="Typical order, tonnes">
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.typicalTonnes}
                onChange={(e) => setForm({ ...form, typicalTonnes: e.target.value })}
              />
            </Field>
            <Field label="Whose account is it" help="This sets the commission rate and cannot be changed casually.">
              <select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
                <option value="new">New, opened by you — 25% of margin</option>
                <option value="inherited">Inherited from Tom — 7.5% of margin</option>
              </select>
            </Field>
            <label className="row" style={{ gap: 8, marginBottom: 12, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.possibleDirectImporter}
                onChange={(e) => setForm({ ...form, possibleDirectImporter: e.target.checked })}
                style={{ width: 'auto' }}
              />
              This customer may be able to import the same goods directly
            </label>
            {error && <Callout tone="critical">{error}</Callout>}
            <Button variant="primary" type="submit" style={{ marginTop: 10 }}>Create</Button>
          </form>
        )}

        {loading && accounts.length === 0 ? (
          <Empty>Loading…</Empty>
        ) : accounts.length === 0 ? (
          <Empty>No accounts match.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Sector</th>
                  <th>Nitrate</th>
                  <th>How they take it</th>
                  <th className="num">Typical</th>
                  <th>Verification</th>
                  <th className="num">Gross margin</th>
                  <th className="num">Last order</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={String(a['id'])} className="clickable" onClick={() => ctx.navigate(`account/${a['id']}`)}>
                    <td>
                      {String(a['name'])}
                      {Number(a['possible_direct_importer']) === 1 && (
                        <div style={{ marginTop: 4 }}>
                          <Chip tone="warn">May import directly</Chip>
                        </div>
                      )}
                    </td>
                    <td className="muted">{a['sector'] ? String(a['sector']).replace(/_/g, ' ') : '—'}</td>
                    <td>
                      {a['preferred_product_name'] ? (
                        <>
                          <div style={{ fontSize: 13 }}>{String(a['preferred_product_name'])}</div>
                          <div style={{ marginTop: 4 }}>
                            <Chip tone={String(a['preferred_product_class']) === 'specialty' ? 'specialty' : 'commodity'}>
                              {String(a['preferred_product_class'])}
                            </Chip>
                          </div>
                        </>
                      ) : (
                        <span className="dim">Not known</span>
                      )}
                    </td>
                    <td><Fulfilment value={String(a['fulfilment_preference'] ?? 'unknown')} storage={Number(a['storage_agreements'] ?? 0)} /></td>
                    <td className="num muted">
                      {a['typical_order_kg'] ? `${(Number(a['typical_order_kg']) / 1000).toFixed(1)} t` : '—'}
                    </td>
                    <td>
                      {a['kyc_verified_at'] ? <Chip tone="good">Signed off</Chip> : <Chip tone="critical">Not verified</Chip>}
                    </td>
                    <td className="num">{gbp(Number(a['gross_margin']), true)}</td>
                    <td className="num muted">{a['last_order_at'] ? shortDate(String(a['last_order_at'])) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
