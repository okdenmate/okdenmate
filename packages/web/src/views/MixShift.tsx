import type { Ctx } from '../App';
import { useApi } from '../hooks';
import { Button, Callout, Chip, Empty, Panel, Stat } from '../components/ui';
import { MixBars } from '../components/charts';
import { gbp, pct } from '../format';

interface MixPayload {
  mix: {
    specialtyGmShareBps: number;
    specialtyRevenueShareBps: number;
    blendedGmBps: number;
    targetSpecialtyGmShareBps: number;
    onTrack: boolean;
    headline: string;
  };
  callList: Array<{
    accountId: string;
    accountName: string;
    commodityRevenue12m: number;
    specialtyRevenue12m: number;
    sector: string | null;
    opportunityScore: number;
    suggestedProductId: string;
    reason: string;
  }>;
}

export function MixShift({ ctx }: { ctx: Ctx }) {
  const { data, loading } = useApi<MixPayload>('/api/analytics/mix', [ctx.version]);

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (!data) return null;

  const productName = (id: string) => ctx.reference.products.find((p) => p.id === id)?.name ?? id;
  const routeFor = (sector: string | null) => ctx.reference.sectors.find((s) => s.id === sector)?.route;

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Mix shift</div>
        <h1>The same effort, four to fifteen times the margin</h1>
        <p>
          Commodity ammonium nitrate runs at 2 to 6 per cent gross margin against 20 to 30 on specialty
          grades. Moving an existing customer costs nothing and needs no budget, which is why it comes
          before any spend on advertising.
        </p>
      </div>

      <div className="grid cols-3 rise" style={{ marginBottom: 16 }}>
        <Panel>
          <Stat
            label="Specialty share of margin"
            value={pct(data.mix.specialtyGmShareBps, 0)}
            hero
            note={`Target is ${pct(data.mix.targetSpecialtyGmShareBps, 0)}.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Specialty share of revenue"
            value={pct(data.mix.specialtyRevenueShareBps, 0)}
            note="Always the smaller number, which is exactly why the target is set on margin instead."
          />
        </Panel>
        <Panel>
          <Stat label="Blended gross margin" value={pct(data.mix.blendedGmBps, 1)} note="Across the whole book." />
        </Panel>
      </div>

      <Panel title="Revenue against margin">
        <MixBars
          revenueShareBps={data.mix.specialtyRevenueShareBps}
          gmShareBps={data.mix.specialtyGmShareBps}
          targetBps={data.mix.targetSpecialtyGmShareBps}
        />
        <div className="divider" />
        <Callout tone={data.mix.onTrack ? 'good' : 'warn'}>{data.mix.headline}</Callout>
      </Panel>

      <Panel
        title="Who to call, in order"
        hint="Ranked by volume that could move, how untouched the account is, and how live the relationship still is"
      >
        {data.callList.length === 0 ? (
          <Empty>
            No trading history in the last twelve months, so there is nothing to rank. Load the order book
            first.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Score</th>
                  <th>Account</th>
                  <th>Sector</th>
                  <th className="num">Commodity, 12m</th>
                  <th className="num">Specialty, 12m</th>
                  <th>Lead with</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.callList.map((c) => {
                  const route = routeFor(c.sector);
                  return (
                    <tr key={c.accountId}>
                      <td className="num"><strong>{c.opportunityScore}</strong></td>
                      <td>
                        {c.accountName}
                        <div className="dim" style={{ fontSize: 12 }}>{c.reason}</div>
                      </td>
                      <td className="muted">{c.sector ? c.sector.replace(/_/g, ' ') : <span className="dim">Not recorded</span>}</td>
                      <td className="num">{gbp(c.commodityRevenue12m, true)}</td>
                      <td className="num">
                        {c.specialtyRevenue12m === 0 ? <Chip tone="warn">Nothing yet</Chip> : gbp(c.specialtyRevenue12m, true)}
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <strong style={{ fontSize: 13 }}>{productName(c.suggestedProductId)}</strong>
                        {route && <div className="muted" style={{ fontSize: 12.5 }}>{route.rationale}</div>}
                      </td>
                      <td className="num">
                        <Button small onClick={() => ctx.navigate(`account/${c.accountId}`)}>Open</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Before you quote anything specialty">
        <Callout tone="warn" title="The margin band is still assumed.">
          Every specialty figure in this system rests on a 20 to 30 per cent gross margin that nobody has
          verified. If the real number is 10 per cent, the case halves. Three to five real orders with price
          and cost against them would settle it, and that is Q2.
        </Callout>
        <div style={{ marginTop: 10 }}>
          <Callout tone="warn" title="Two advertised services cannot be delivered.">
            {ctx.reference.unfulfillableServices.map((s) => s.name).join(' and ')} appear on the live site and
            do not exist as capabilities. Do not offer either on a call.
          </Callout>
        </div>
      </Panel>
    </>
  );
}
