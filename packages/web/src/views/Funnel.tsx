import type { Ctx } from '../App';
import { useApi } from '../hooks';
import type { FunnelReport } from '../types';
import { Callout, Chip, Empty, Panel, Stat } from '../components/ui';
import { FunnelChart } from '../components/charts';
import { pct } from '../format';

export function Funnel({ ctx }: { ctx: Ctx }) {
  const { data, loading } = useApi<{ report: FunnelReport; stages: Ctx['reference']['funnelStages'] }>(
    '/api/analytics/funnel',
    [ctx.version],
  );

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (!data) return null;
  const { report } = data;

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Funnel</div>
        <h1>Where enquiries come from and where they stop</h1>
        <p>
          Stages nought to five are fired by the web pages. Six and seven are recorded here, by this system,
          which is what makes the quote-to-order ratio countable for the first time.
        </p>
      </div>

      {report.diagnosis.length > 0 && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {report.diagnosis.map((d) => (
            <Callout key={d} tone="warn">{d}</Callout>
          ))}
        </div>
      )}

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel>
          <Stat
            label="Arrival to lead"
            value={report.overallConversionBps === null ? 'No data' : pct(report.overallConversionBps, 2)}
            hero={report.overallConversionBps !== null}
            unknown={report.overallConversionBps === null}
            note="The single number that says whether the site works."
          />
        </Panel>
        <Panel>
          <Stat
            label="Quote to order"
            value={report.quoteToOrderBps === null ? 'No data' : pct(report.quoteToOrderBps, 0)}
            unknown={report.quoteToOrderBps === null}
            note="Every forecast on the pipeline screen needs this. Until it exists the stage weightings are assumed."
          />
        </Panel>
        <Panel><Stat label="Soft leads" value={String(report.softLeads)} note="Not ready to buy, still captured." /></Panel>
        <Panel>
          <Stat
            label="Leaks"
            value={String(report.abandons + report.failures)}
            note={`${report.abandons} abandoned, ${report.failures} failed to submit.`}
          />
        </Panel>
      </div>

      <Panel title="By stage">
        <FunnelChart
          stages={report.stages.map((s) => ({
            label: s.label,
            count: s.count,
            stepConversionBps: s.stepConversionBps,
            absoluteConversionBps: s.absoluteConversionBps,
            note: s.note,
          }))}
        />
      </Panel>

      <Panel title="What each stage tells you" hint="A table view of the same figures, for anyone the chart does not serve">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Event</th>
                <th className="num">Sessions</th>
                <th className="num">From previous</th>
                <th className="num">From arrival</th>
                <th>Reads as</th>
                <th>What it tells you</th>
              </tr>
            </thead>
            <tbody>
              {report.stages.map((s) => {
                const def = ctx.reference.funnelStages.find((d) => d.stage === s.stage);
                return (
                  <tr key={s.stage}>
                    <td>{s.label}</td>
                    <td className="dim"><code>{def?.event}</code></td>
                    <td className="num">{s.count}</td>
                    <td className="num">{s.stepConversionBps === null ? '—' : pct(s.stepConversionBps, 0)}</td>
                    <td className="num">{s.absoluteConversionBps === null ? '—' : pct(s.absoluteConversionBps, 1)}</td>
                    <td>
                      <Chip tone={s.health === 'good' ? 'good' : s.health === 'watch' ? 'warn' : s.health === 'poor' ? 'critical' : 'neutral'}>
                        {s.health}
                      </Chip>
                    </td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 320 }}>
                      {s.enteredOutsideFunnel > 0 ? s.note : (def?.tells ?? s.note)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Sending events">
        <p className="muted">
          Post to <code>/api/public/events</code> with an event name, a session id and, where it applies, a
          product id. The event names are the ones in the table above. Nothing here needs a third-party
          analytics account, so the funnel works whether or not Google Analytics is ever installed.
        </p>
        <pre
          style={{
            background: 'rgba(0,0,0,.3)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: 14,
            fontSize: 12.5,
            overflowX: 'auto',
            color: 'var(--text-2)',
          }}
        >
{`fetch('/api/public/events', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    event: 'calc_engaged',
    sessionId: yourSessionId,
    source: 'google',
    productId: 'nano3',
  }),
});`}
        </pre>
      </Panel>
    </>
  );
}
