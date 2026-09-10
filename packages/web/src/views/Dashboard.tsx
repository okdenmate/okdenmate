import type { Ctx } from '../App';
import { useApi } from '../hooks';
import type { Dashboard as DashboardData } from '../types';
import { Button, Callout, Chip, Empty, Panel, Stat } from '../components/ui';
import { ConcentrationChart, FunnelChart, Meter, MixBars, ScenarioChart } from '../components/charts';
import { gbp, pct, relativeDays, shortDate, tonnes } from '../format';

interface ConcentrationPayload {
  risk: DashboardData['concentration'];
  accounts: Array<{
    accountId: string;
    accountName: string;
    revenue: number;
    grossMargin: number;
    possibleDirectImporter: boolean;
  }>;
}

export function Dashboard({ ctx }: { ctx: Ctx }) {
  const { data, error, loading } = useApi<DashboardData>('/api/dashboard', [ctx.version]);
  const conc = useApi<ConcentrationPayload>('/api/analytics/concentration', [ctx.version]);

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (error) return <Callout tone="critical">{error}</Callout>;
  if (!data) return null;

  const critical = data.compliance.breaches.filter((b) => b.severity === 'critical');
  const openSuspicious = data.compliance.suspicious.filter((s) => s.status === 'open');
  const totalGm = data.concentration.totalGrossMargin;
  const accountShares =
    totalGm > 0
      ? (conc.data?.accounts ?? [])
          .map((a) => ({
            accountName: a.accountName,
            grossMargin: a.grossMargin,
            shareBps: Math.round((a.grossMargin / totalGm) * 10_000),
            possibleDirectImporter: a.possibleDirectImporter,
          }))
          .sort((x, y) => y.shareBps - x.shareBps)
          .slice(0, 7)
      : [];

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Command deck</div>
        <h1>Good {greeting()}, {ctx.user.name.split(' ')[0]}</h1>
        <p>{data.concentration.headline}</p>
      </div>

      {/* Anything that stops a sale from being lawful comes first, above the money. */}
      {(critical.length > 0 || openSuspicious.length > 0 || data.compliance.accountsMissingKyc > 0) && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {critical.map((b) => (
            <Callout key={b.thresholdId} tone="critical" title="Notification overdue.">
              {b.message} {b.action}
            </Callout>
          ))}
          {openSuspicious.map((s) => (
            <Callout key={s.id} tone={s.sla.breached ? 'critical' : 'warn'} title="Transaction to review.">
              {s.summary}{' '}
              {s.sla.breached
                ? `The 24-hour reporting window closed ${Math.abs(Math.round(s.sla.hoursRemaining))} hours ago.`
                : `${Math.round(s.sla.hoursRemaining)} hours left to report.`}{' '}
              <a href="#compliance">Open compliance</a>
            </Callout>
          ))}
          {data.compliance.accountsMissingKyc > 0 && (
            <Callout tone="warn" title="Buyer verification incomplete.">
              {data.compliance.accountsMissingKyc} of {data.compliance.accountsTotal} accounts cannot lawfully be sold a
              regulated nitrate line today. Quotes to those accounts are blocked until the record is signed off.
            </Callout>
          )}
        </div>
      )}

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel>
          <Stat
            label="Commission this year"
            value={gbp(data.earnings.commissionYearToDate, true)}
            hero
            note={`On a straight-line run rate that is ${gbp(data.earnings.projectedTotalAnnual, true)} for the year, including base.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Weighted pipeline margin"
            value={gbp(data.pipeline.weightedGrossMargin, true)}
            tag="A"
            note={`${data.pipeline.openDealCount} open deals. Your share of that is ${gbp(data.pipeline.weightedCommission, true)}.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Specialty share of margin"
            value={pct(data.mix.specialtyGmShareBps, 0)}
            note={`Against a ${pct(data.mix.targetSpecialtyGmShareBps, 0)} target. Blended margin is ${pct(data.mix.blendedGmBps, 1)}.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Ammonium nitrate held"
            value={tonnes(data.compliance.currentAnKg, 1)}
            note={
              data.compliance.peakAnKg === null
                ? 'Peak tonnage ever held is unrecorded, so the notification duty is unproven.'
                : `Peak ${tonnes(data.compliance.peakAnKg, 1)}${data.compliance.peakAt ? ` on ${shortDate(data.compliance.peakAt)}` : ''}.`
            }
          />
        </Panel>
      </div>

      <div className="grid wide-left rise">
        <div className="stack">
          <Panel
            title="Where the margin actually comes from"
            hint="Measured on gross margin, not revenue. Tonnes of ammonium nitrate will always dominate revenue and never dominate profit."
          >
            <MixBars
              revenueShareBps={data.mix.specialtyRevenueShareBps}
              gmShareBps={data.mix.specialtyGmShareBps}
              targetBps={data.mix.targetSpecialtyGmShareBps}
            />
            <div className="divider" />
            <p className="muted" style={{ fontSize: 13.5 }}>{data.mix.headline}</p>
            <Button small onClick={() => ctx.navigate('mix')}>Open the call list</Button>
          </Panel>

          <Panel
            title="Funnel"
            hint="Stages 0 to 5 come from the web pages. Stages 6 and 7 come from this system."
          >
            <FunnelChart
              stages={data.funnel.stages.map((s) => ({
                label: s.label,
                count: s.count,
                stepConversionBps: s.stepConversionBps,
                absoluteConversionBps: s.absoluteConversionBps,
                note: s.note,
              }))}
            />
            {data.funnel.diagnosis.map((d) => (
              <div key={d} style={{ marginTop: 10 }}>
                <Callout tone="warn">{d}</Callout>
              </div>
            ))}
          </Panel>

          <Panel
            title="What the specialty push is worth"
            hint="Three scenarios, ramping across the first year. Every figure moves with the specialty margin band, which is still assumed."
          >
            <ScenarioChart
              series={data.scenarios.map((s) => ({
                id: s.scenario.id,
                label: s.scenario.label,
                points: s.months.map((m) => ({ month: m.month, commission: m.commission })),
              }))}
            />
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th className="num">Orders per month</th>
                    <th className="num">Commission at maturity</th>
                    <th className="num">Year one</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scenarios.map((s) => (
                    <tr key={s.scenario.id}>
                      <td>{s.scenario.label}</td>
                      <td className="num">{s.scenario.ordersPerMonthAtMaturity}</td>
                      <td className="num">{gbp(s.monthlyCommissionAtMaturity, true)}</td>
                      <td className="num">{gbp(s.yearOneCommission, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Concentration" hint={`HHI ${data.concentration.hhi} on gross margin`}>
            {data.concentration.severity === 'unknown' ? (
              <Empty>{data.concentration.headline}</Empty>
            ) : (
              <>
                <div className="row" style={{ marginBottom: 12 }}>
                  <Chip tone={data.concentration.severity === 'low' ? 'good' : data.concentration.severity === 'moderate' ? 'warn' : 'critical'}>
                    {data.concentration.severity}
                  </Chip>
                  <span className="dim" style={{ fontSize: 12.5 }}>
                    {data.concentration.accountsToHalfMargin === 1
                      ? 'One account makes half the margin'
                      : `${data.concentration.accountsToHalfMargin} accounts make half the margin`}
                  </span>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <ConcentrationChart accounts={accountShares} />
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-2)' }}>
                  {data.concentration.findings.map((f) => (
                    <li key={f} style={{ marginBottom: 6 }}>{f}</li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Duty" hint="Storage pitch readiness">
            <Meter
              valueBps={data.compliance.readiness.score * 100}
              tone={data.compliance.readiness.score >= 75 ? 'good' : data.compliance.readiness.score >= 40 ? 'warn' : 'critical'}
              label={`${data.compliance.readiness.score} out of 100. ${
                data.compliance.readiness.sellable
                  ? 'The duty can be shown as discharged, so storage is sellable.'
                  : 'Storage cannot be pitched as outsourced compliance until this clears.'
              }`}
            />
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text-2)' }}>
              {data.compliance.readiness.blockers.map((b) => (
                <li key={b} style={{ marginBottom: 6 }}>{b}</li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="What would firm up the numbers"
            hint="Ranked by how many figures on these screens stop being assumptions"
            action={<Button small onClick={() => ctx.navigate('questions')}>All</Button>}
          >
            <div className="stack">
              {data.questions.map((q) => (
                <div key={q.questionId}>
                  <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                    <strong style={{ fontSize: 13 }}>{q.questionId}</strong>
                    <Chip tone={q.tier === 1 ? 'critical' : q.tier === 2 ? 'warn' : 'neutral'}>Tier {q.tier}</Chip>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{q.question}</div>
                  <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                    Blocks: {q.blocks.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Next actions" action={<Button small onClick={() => ctx.navigate('enquiries')}>Enquiries</Button>}>
            {data.openTasks.length === 0 ? (
              <Empty>Nothing scheduled.</Empty>
            ) : (
              <div className="stack">
                {data.openTasks.slice(0, 7).map((t) => (
                  <div key={String(t['id'])}>
                    <div style={{ fontSize: 13.5 }}>{String(t['subject'])}</div>
                    <div className="dim" style={{ fontSize: 11.5 }}>
                      Due {relativeDays(String(t['due_at'] ?? ''))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
