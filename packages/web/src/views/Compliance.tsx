import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import type { ComplianceOverview } from '../types';
import { Button, Callout, Chip, Empty, Field, Panel, Stat } from '../components/ui';
import { Meter } from '../components/charts';
import { shortDate, tonnes } from '../format';

export function Compliance({ ctx }: { ctx: Ctx }) {
  const { data, loading, reload } = useApi<ComplianceOverview>('/api/compliance', [ctx.version]);
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState<{ peakTonnes: string; signage: boolean; procedures: boolean; positions: string } | null>(null);

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (!data) return null;

  const canEdit = ctx.user.role === 'owner' || ctx.user.role === 'ops_director';
  const threshold = (id: string) => ctx.reference.storageThresholds.find((t) => t.id === id);

  async function setNotification(thresholdId: string, status: string) {
    setBusy(true);
    try {
      await api.put(`/api/compliance/notifications/${thresholdId}`, {
        status,
        filedAt: status === 'filed' ? new Date().toISOString().slice(0, 10) : null,
        reference: status === 'filed' ? window.prompt('Notification reference') ?? null : null,
        note: '',
      });
      reload();
      ctx.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveSite() {
    if (!site) return;
    setBusy(true);
    try {
      await api.put('/api/compliance/site', {
        peakAnKg: site.peakTonnes ? Math.round(Number(site.peakTonnes) * 1000) : null,
        signageInPlace: site.signage,
        proceduresDocumented: site.procedures,
        totalPalletPositions: site.positions ? Number(site.positions) : null,
        note: '',
      });
      setSite(null);
      reload();
      ctx.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function updateSuspicious(id: string, status: string) {
    setBusy(true);
    try {
      const reference = status === 'reported' ? window.prompt('Report reference') ?? null : null;
      await api.patch(`/api/compliance/suspicious/${id}`, { status, reference });
      reload();
      ctx.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Compliance</div>
        <h1>Duty</h1>
        <p>
          Two separate regimes, routinely confused. The Poisons Act applies at the point of every sale
          whatever the tonnage. The notification thresholds apply to the tonnage held, and have nothing to
          do with how much is sold.
        </p>
      </div>

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Held on site" value={tonnes(data.currentAnKg, 1)} note="Ammonium nitrate, from the movement ledger." /></Panel>
        <Panel>
          <Stat
            label="Peak ever held"
            value={data.peakAnKg === null ? 'Not recorded' : tonnes(data.peakAnKg, 1)}
            unknown={data.peakAnKg === null}
            tag={data.peakAnKg === null ? 'U' : data.peakSource === 'declared' ? 'R' : 'V'}
            note={
              data.peakAnKg === null
                ? 'The duty attaches to the peak, so this is the number that decides whether a notification was ever owed.'
                : data.peakSource === 'declared'
                  ? 'Declared. Reconstruct from goods-in records to verify.'
                  : `Proven by the ledger${data.peakAt ? `, on ${shortDate(data.peakAt)}` : ''}.`
            }
          />
        </Panel>
        <Panel>
          <Stat
            label="Accounts cleared to buy"
            value={`${data.accountsTotal - data.accountsMissingKyc} of ${data.accountsTotal}`}
            note="The rest cannot lawfully be sold a regulated line, and the quote screen will refuse."
          />
        </Panel>
        <Panel>
          <Stat label="Storage pitch readiness" value={`${data.readiness.score}/100`} />
          <div style={{ marginTop: 8 }}>
            <Meter
              valueBps={data.readiness.score * 100}
              tone={data.readiness.score >= 75 ? 'good' : data.readiness.score >= 40 ? 'warn' : 'critical'}
            />
          </div>
        </Panel>
      </div>

      <Panel title="Notification thresholds" hint="Peak tonnage held, not tonnage sold">
        <div className="stack">
          {data.breaches.map((b) => {
            const t = threshold(b.thresholdId);
            return (
              <Callout
                key={b.thresholdId}
                tone={b.severity === 'critical' ? 'critical' : b.severity === 'warning' ? 'warn' : 'good'}
                title={t ? `${tonnes(t.limitKg, 0)} · ${t.basis}` : b.thresholdId}
              >
                {b.message} {b.action}
                {t && <div className="dim" style={{ marginTop: 5, fontSize: 12 }}>Applies to: {t.applies}</div>}
              </Callout>
            );
          })}
          {data.breaches.length === 0 && (
            <Callout tone="good">Holdings are well inside every threshold and the positions are confirmed.</Callout>
          )}
        </div>

        <div className="divider" />

        <div className="table-wrap">
          <table>
            <thead><tr><th>Threshold</th><th>Notify</th><th>Status</th><th className="num">Filed</th><th /></tr></thead>
            <tbody>
              {data.notifications.map((n) => {
                const t = threshold(n.thresholdId);
                return (
                  <tr key={n.thresholdId}>
                    <td>{t ? tonnes(t.limitKg, 0) : n.thresholdId}<div className="dim">{t?.basis}</div></td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 300 }}>{t?.notify}</td>
                    <td>
                      <Chip tone={n.status === 'filed' ? 'good' : n.status === 'not_required' ? 'neutral' : 'critical'}>
                        {n.status.replace(/_/g, ' ')}
                      </Chip>
                    </td>
                    <td className="num muted">{n.filedAt ? shortDate(n.filedAt) : '—'}</td>
                    <td className="num">
                      {canEdit && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <Button small disabled={busy} onClick={() => setNotification(n.thresholdId, 'filed')}>Filed</Button>
                          <Button small disabled={busy} onClick={() => setNotification(n.thresholdId, 'not_required')}>Not required</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Site"
        action={
          canEdit && !site && (
            <Button
              small
              onClick={() =>
                setSite({
                  peakTonnes: data.peakAnKg === null ? '' : String(data.peakAnKg / 1000),
                  signage: data.site.signageInPlace,
                  procedures: data.site.proceduresDocumented,
                  positions: data.site.totalPalletPositions === null ? '' : String(data.site.totalPalletPositions),
                })
              }
            >
              Update
            </Button>
          )
        }
      >
        {site ? (
          <>
            <div className="grid cols-2">
              <Field label="Peak tonnage ever held" help="Reconstruct from goods-in records if it was never logged.">
                <input type="number" step="0.1" value={site.peakTonnes} onChange={(e) => setSite({ ...site, peakTonnes: e.target.value })} />
              </Field>
              <Field label="Pallet positions in the racking">
                <input type="number" value={site.positions} onChange={(e) => setSite({ ...site, positions: e.target.value })} />
              </Field>
            </div>
            <label className="row" style={{ gap: 8, fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={site.signage} onChange={(e) => setSite({ ...site, signage: e.target.checked })} style={{ width: 'auto' }} />
              Warning signage is in place at the site entrance
            </label>
            <label className="row" style={{ gap: 8, fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={site.procedures} onChange={(e) => setSite({ ...site, procedures: e.target.checked })} style={{ width: 'auto' }} />
              Storage procedures are written down
            </label>
            <div className="row">
              <Button variant="primary" disabled={busy} onClick={saveSite}>Save</Button>
              <Button disabled={busy} onClick={() => setSite(null)}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 18, marginBottom: 12 }}>
              <Chip tone={data.site.signageInPlace ? 'good' : 'critical'}>
                Signage {data.site.signageInPlace ? 'in place' : 'not recorded'}
              </Chip>
              <Chip tone={data.site.proceduresDocumented ? 'good' : 'critical'}>
                Procedures {data.site.proceduresDocumented ? 'documented' : 'not documented'}
              </Chip>
              <Chip tone={data.site.totalPalletPositions === null ? 'warn' : 'good'}>
                {data.site.totalPalletPositions === null ? 'Pallet positions never counted' : `${data.site.totalPalletPositions} positions`}
              </Chip>
            </div>
            {data.site.note && <p className="muted" style={{ fontSize: 13 }}>{data.site.note}</p>}
            <div className="divider" />
            <strong style={{ fontSize: 13.5 }}>Why storage cannot be pitched yet</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text-2)' }}>
              {data.readiness.blockers.map((b) => <li key={b} style={{ marginBottom: 5 }}>{b}</li>)}
              {data.readiness.blockers.length === 0 && <li>Nothing outstanding. The duty can be shown as discharged.</li>}
            </ul>
          </>
        )}
      </Panel>

      <Panel
        title="Transactions to review"
        hint="Screened automatically on arrival. Reportable within 24 hours of detection."
      >
        {data.suspicious.length === 0 ? (
          <Empty>Nothing raised.</Empty>
        ) : (
          <div className="stack">
            {data.suspicious.map((s) => (
              <Callout
                key={s.id}
                tone={s.status !== 'open' ? 'info' : s.sla.breached ? 'critical' : s.sla.urgent ? 'warn' : 'info'}
                title={s.summary}
              >
                <ul style={{ margin: '6px 0 8px', paddingLeft: 18 }}>
                  {s.indicators.map((i) => <li key={i}>{i}</li>)}
                </ul>
                <div className="row">
                  <Chip tone={s.status === 'reported' ? 'good' : s.status === 'dismissed' ? 'neutral' : 'warn'}>{s.status}</Chip>
                  <span className="dim" style={{ fontSize: 12 }}>
                    Detected {shortDate(s.detectedAt)}.{' '}
                    {s.status === 'open'
                      ? s.sla.breached
                        ? `The 24-hour window closed ${Math.abs(Math.round(s.sla.hoursRemaining))} hours ago.`
                        : `${Math.round(s.sla.hoursRemaining)} hours left to report.`
                      : ''}
                  </span>
                  {s.status === 'open' && canEdit && (
                    <>
                      <Button small disabled={busy} onClick={() => updateSuspicious(s.id, 'reported')}>Reported</Button>
                      <Button small disabled={busy} onClick={() => updateSuspicious(s.id, 'dismissed')}>Dismiss</Button>
                    </>
                  )}
                </div>
              </Callout>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="What the point-of-sale regime requires" hint="Poisons Act 1972, in force since 1 October 2023">
        <div className="table-wrap">
          <table>
            <tbody>
              {[
                ['Buyer verification', 'Photographic ID, business name and address, VAT number, nature of trade.'],
                ['Applies to', 'Any business buying ammonium nitrate at or above 16% nitrogen, and potassium nitrate.'],
                ['Record retention', 'Eighteen months, available for inspection.'],
                ['Suspicious transactions', 'Reportable within 24 hours.'],
                ['Supply restriction', 'Businesses and professional users only. No supply to members of the public.'],
              ].map(([k, v]) => (
                <tr key={k}><td style={{ width: 210, color: 'var(--text-3)' }}>{k}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
