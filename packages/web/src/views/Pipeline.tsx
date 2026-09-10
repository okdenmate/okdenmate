import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import type { Row } from '../types';
import { Button, Callout, Chip, Empty, Field, Panel, Stat } from '../components/ui';
import { gbp, pct, shortDate } from '../format';

const OPEN_STAGES = ['enquiry', 'qualified', 'quoted', 'negotiation'] as const;
const STAGE_LABEL: Record<string, string> = {
  enquiry: 'Enquiry',
  qualified: 'Qualified',
  quoted: 'Quoted',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

export function Pipeline({ ctx }: { ctx: Ctx }) {
  const deals = useApi<{ deals: Row[] }>('/api/deals', [ctx.version]);
  const accounts = useApi<{ accounts: Row[] }>('/api/accounts', [ctx.version]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ accountId: '', title: '' });
  const [error, setError] = useState<string | null>(null);

  const all = deals.data?.deals ?? [];
  const open = all.filter((d) => OPEN_STAGES.includes(String(d['stage']) as never));
  const won = all.filter((d) => d['stage'] === 'won');

  const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ id: string }>('/api/deals', form);
      setCreating(false);
      setForm({ accountId: '', title: '' });
      ctx.refresh();
      ctx.navigate(`deal/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the deal.');
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Pipeline</div>
        <h1>Open deals</h1>
        <p>
          Sorted by stage, sized by gross margin rather than order value. A large ammonium nitrate load
          and a small specialty load can be the same revenue and ten times apart on what they pay.
        </p>
      </div>

      <div className="grid cols-3 rise" style={{ marginBottom: 18 }}>
        <Panel>
          <Stat label="Open gross margin" value={gbp(sum(open, 'gross_margin'), true)} note={`${open.length} deals in play.`} />
        </Panel>
        <Panel>
          <Stat label="Open revenue" value={gbp(sum(open, 'revenue'), true)} note="Headline value, before cost." />
        </Panel>
        <Panel>
          <Stat
            label="Deals carrying specialty"
            value={`${open.filter((d) => Number(d['has_specialty']) === 1).length} of ${open.length}`}
            note="The rest are commodity only, where margin runs 2 to 6 per cent."
          />
        </Panel>
      </div>

      <Panel
        title="Board"
        action={<Button variant="primary" small onClick={() => setCreating((c) => !c)}>{creating ? 'Cancel' : 'New deal'}</Button>}
      >
        {creating && (
          <form onSubmit={create} style={{ marginBottom: 18, maxWidth: 460 }}>
            <Field label="Account">
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} required>
                <option value="">Choose an account</option>
                {(accounts.data?.accounts ?? []).map((a) => (
                  <option key={String(a['id'])} value={String(a['id'])}>{String(a['name'])}</option>
                ))}
              </select>
            </Field>
            <Field label="What is it">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Sodium nitrate, 15t, glass" />
            </Field>
            {error && <Callout tone="critical">{error}</Callout>}
            <Button variant="primary" type="submit" style={{ marginTop: 10 }}>Create</Button>
          </form>
        )}

        {open.length === 0 ? (
          <Empty>No open deals. Convert an enquiry, or create one directly.</Empty>
        ) : (
          <div className="board">
            {OPEN_STAGES.map((stage) => {
              const inStage = open.filter((d) => d['stage'] === stage);
              return (
                <div className="board-col" key={stage}>
                  <h3>{STAGE_LABEL[stage]}</h3>
                  <div className="col-total">
                    {inStage.length} · {gbp(sum(inStage, 'gross_margin'), true)} margin
                  </div>
                  {inStage.map((d) => (
                    <div key={String(d['id'])} className="deal-card" onClick={() => ctx.navigate(`deal/${d['id']}`)}>
                      <div className="dc-title">{String(d['title'])}</div>
                      <div className="dc-account">{String(d['account_name'])}</div>
                      <div className="dc-figures">
                        <span>{gbp(Number(d['gross_margin']), true)}</span>
                        <span className="dim">{gbp(Number(d['revenue']), true)}</span>
                      </div>
                      <div style={{ marginTop: 7 }}>
                        <Chip tone={Number(d['has_specialty']) === 1 ? 'specialty' : 'commodity'}>
                          {Number(d['has_specialty']) === 1 ? 'Specialty' : 'Commodity'}
                        </Chip>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Closed" hint={`${won.length} won`}>
        {won.length === 0 ? (
          <Empty>Nothing won yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Account</th>
                  <th>Deal</th>
                  <th className="num">Revenue</th>
                  <th className="num">Margin</th>
                  <th className="num">Closed</th>
                </tr>
              </thead>
              <tbody>
                {won.map((d) => (
                  <tr key={String(d['id'])} className="clickable" onClick={() => ctx.navigate(`deal/${d['id']}`)}>
                    <td className="num">{String(d['reference'])}</td>
                    <td>{String(d['account_name'])}</td>
                    <td>{String(d['title'])}</td>
                    <td className="num">{gbp(Number(d['revenue']), true)}</td>
                    <td className="num">
                      {gbp(Number(d['gross_margin']), true)}
                      <span className="dim"> {pct(Math.round((Number(d['gross_margin']) / Math.max(1, Number(d['revenue']))) * 10_000), 0)}</span>
                    </td>
                    <td className="num">{shortDate(String(d['closed_at'] ?? ''))}</td>
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
