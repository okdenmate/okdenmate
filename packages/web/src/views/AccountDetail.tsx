import { useState } from 'react';
import type { Ctx } from '../App';
import { api, ApiError } from '../api';
import { useApi } from '../hooks';
import type { KycAssessment, Row } from '../types';
import { Button, Callout, Chip, Empty, Field, Panel, Stat } from '../components/ui';
import { Fulfilment } from './Accounts';
import { gbp, pct, shortDate } from '../format';

interface AccountPayload {
  account: Row;
  contacts: Row[];
  deals: Row[];
  orders: Row[];
  activities: Row[];
  storageAgreements: Row[];
  kyc: Row | null;
  kycAssessment: KycAssessment;
  shareOfGrossMarginBps: number;
  revenue: { revenue: number; grossMargin: number; orderCount: number } | null;
}

const EMPTY_KYC = {
  photoIdReference: '',
  photoIdType: 'driving_licence',
  businessName: '',
  businessAddress: '',
  vatNumber: '',
  natureOfTrade: '',
  buyerType: 'unknown',
};

export function AccountDetail({ ctx, accountId }: { ctx: Ctx; accountId: string }) {
  const { data, error, loading, reload } = useApi<AccountPayload>(
    accountId ? `/api/accounts/${accountId}` : null,
    [ctx.version],
  );
  const [kycForm, setKycForm] = useState<typeof EMPTY_KYC | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (error) return <Callout tone="critical">{error}</Callout>;
  if (!data) return null;

  const { account, kyc, kycAssessment } = data;
  const canSign = ctx.user.role === 'owner' || ctx.user.role === 'ops_director';

  function startEditing() {
    setKycForm({
      photoIdReference: String(kyc?.['photoIdReference'] ?? ''),
      photoIdType: String(kyc?.['photoIdType'] ?? 'driving_licence'),
      businessName: String(kyc?.['businessName'] ?? account['name'] ?? ''),
      businessAddress: String(kyc?.['businessAddress'] ?? account['address'] ?? ''),
      vatNumber: String(kyc?.['vatNumber'] ?? ''),
      natureOfTrade: String(kyc?.['natureOfTrade'] ?? ''),
      buyerType: String(kyc?.['buyerType'] ?? 'unknown'),
    });
  }

  async function saveKyc(signOff: boolean) {
    if (!kycForm) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.put(`/api/accounts/${accountId}/kyc`, { ...kycForm, signOff });
      setKycForm(null);
      reload();
      ctx.refresh();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow"><a href="#accounts">Accounts</a></div>
        <h1>{String(account['name'])}</h1>
        <p>
          {account['sector'] ? `${String(account['sector']).replace(/_/g, ' ')} · ` : ''}
          {String(account['origin']) === 'new' ? 'New account, 25% of gross margin' : 'Inherited account, 7.5% of gross margin'}
          {' · '}
          {Number(account['payment_terms_days'])}-day terms
        </p>
      </div>

      {Number(account['possible_direct_importer']) === 1 && data.shareOfGrossMarginBps >= 1500 && (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="warn" title="Low switching cost.">
            This account carries {pct(data.shareOfGrossMarginBps, 0)} of all gross margin and may be able to buy the same
            goods at source. Treat that margin as at risk rather than as a base.
          </Callout>
        </div>
      )}

      {/* What this customer actually buys and how they take it. Both decide the
          conversation before any price is discussed. */}
      <Panel className="rise" title="What they buy" hint="The shape of the account, before any price is discussed">
        <div className="grid cols-4">
          <Stat
            label="Nitrate"
            value={account['preferred_product_name'] ? String(account['preferred_product_name']) : 'Not known'}
            unknown={!account['preferred_product_name']}
            note={account['nature_of_trade'] ? `For ${String(account['nature_of_trade']).toLowerCase()}.` : 'Nature of trade not recorded.'}
          />
          <div className="stat">
            <div className="label">How they take it</div>
            <div style={{ marginTop: 4 }}>
              <Fulfilment
                value={String(account['fulfilment_preference'] ?? 'unknown')}
                storage={data.storageAgreements.length}
              />
            </div>
            <div className="note" style={{ marginTop: 6 }}>
              {String(account['fulfilment_preference']) === 'storage'
                ? 'Buys and leaves it on our racking, so we carry the duty and charge for it monthly.'
                : String(account['fulfilment_preference']) === 'immediate'
                  ? 'Wants it off the floor, which only UK stock at King’s Lynn can do. Imported lines are eight to ten weeks.'
                  : String(account['fulfilment_preference']) === 'scheduled'
                    ? 'Called off against a contract or a season rather than bought on the spot.'
                    : 'Not established. Ask before quoting: it decides whether this account can also carry a storage fee.'}
            </div>
          </div>
          <Stat
            label="Typical order"
            value={account['typical_order_kg'] ? `${(Number(account['typical_order_kg']) / 1000).toFixed(1)} t` : 'Not known'}
            unknown={!account['typical_order_kg']}
            note="A 28 t arable buyer and a 2 t pyrotechnics buyer are not the same customer."
          />
          <Stat
            label="Storage agreements"
            value={String(data.storageAgreements.length)}
            note={
              String(account['fulfilment_preference']) === 'storage' && data.storageAgreements.length === 0
                ? 'They keep stock here with nothing agreed in writing. That is unbilled revenue and an undocumented duty.'
                : 'Live agreements on the racking.'
            }
          />
        </div>
      </Panel>

      <div className="grid cols-4 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Gross margin, all time" value={gbp(data.revenue?.grossMargin ?? 0, true)} /></Panel>
        <Panel><Stat label="Revenue, all time" value={gbp(data.revenue?.revenue ?? 0, true)} /></Panel>
        <Panel><Stat label="Share of the book" value={pct(data.shareOfGrossMarginBps, 0)} note="By gross margin." /></Panel>
        <Panel><Stat label="Orders" value={String(data.revenue?.orderCount ?? 0)} /></Panel>
      </div>

      {/* Buyer verification. Poisons Act 1972, in force since 1 October 2023. */}
      <Panel
        title="Buyer verification"
        hint="Poisons Act 1972. Required at the point of every sale of an explosives precursor, whatever the tonnage."
        action={
          !kycForm && (
            <Button small onClick={startEditing} disabled={!canSign}>
              {kyc?.['verifiedAt'] ? 'Update' : 'Complete'}
            </Button>
          )
        }
      >
        <div style={{ marginBottom: 14 }}>
          <Callout tone={kycAssessment.valid ? 'good' : 'critical'}>
            {kycAssessment.valid
              ? `Complete and signed off${kycAssessment.retentionExpiresAt ? `. On file until ${shortDate(kycAssessment.retentionExpiresAt)}, eighteen months from sign-off.` : '.'}`
              : kycAssessment.reasons.join(' ')}
          </Callout>
        </div>

        {!canSign && !kycForm && (
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
            Only an owner or operations director can sign a verification off. Someone has to be answerable for it.
          </div>
        )}

        {kycForm ? (
          <>
            <div className="grid cols-2">
              <Field label="Photographic ID reference" help="A reference to where the document is held, not the document.">
                <input value={kycForm.photoIdReference} onChange={(e) => setKycForm({ ...kycForm, photoIdReference: e.target.value })} />
              </Field>
              <Field label="ID type">
                <select value={kycForm.photoIdType} onChange={(e) => setKycForm({ ...kycForm, photoIdType: e.target.value })}>
                  <option value="driving_licence">Driving licence</option>
                  <option value="passport">Passport</option>
                  <option value="national_id">National identity card</option>
                </select>
              </Field>
              <Field label="Business name">
                <input value={kycForm.businessName} onChange={(e) => setKycForm({ ...kycForm, businessName: e.target.value })} />
              </Field>
              <Field label="Business address">
                <input value={kycForm.businessAddress} onChange={(e) => setKycForm({ ...kycForm, businessAddress: e.target.value })} />
              </Field>
              <Field label="VAT number">
                <input value={kycForm.vatNumber} onChange={(e) => setKycForm({ ...kycForm, vatNumber: e.target.value })} />
              </Field>
              <Field label="Nature of trade" help="What they actually do with the material.">
                <input value={kycForm.natureOfTrade} onChange={(e) => setKycForm({ ...kycForm, natureOfTrade: e.target.value })} />
              </Field>
              <Field label="Buyer type" help="Regulated lines may only go to businesses and professional users.">
                <select value={kycForm.buyerType} onChange={(e) => setKycForm({ ...kycForm, buyerType: e.target.value })}>
                  <option value="unknown">Not established</option>
                  <option value="business">Business</option>
                  <option value="professional_user">Professional user</option>
                  <option value="member_of_public">Member of the public</option>
                </select>
              </Field>
            </div>
            {saveError && <Callout tone="critical">{saveError}</Callout>}
            <div className="row" style={{ marginTop: 12 }}>
              <Button variant="primary" disabled={busy} onClick={() => saveKyc(true)}>
                Save and sign off as {ctx.user.name}
              </Button>
              <Button disabled={busy} onClick={() => saveKyc(false)}>Save without signing</Button>
              <Button disabled={busy} onClick={() => setKycForm(null)}>Cancel</Button>
            </div>
          </>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {[
                  ['Photographic ID', kyc?.['photoIdReference']],
                  ['Business name', kyc?.['businessName']],
                  ['Business address', kyc?.['businessAddress']],
                  ['VAT number', kyc?.['vatNumber']],
                  ['Nature of trade', kyc?.['natureOfTrade']],
                  ['Buyer type', kyc?.['buyerType'] ? String(kyc['buyerType']).replace(/_/g, ' ') : null],
                  ['Signed off by', kyc?.['verifiedBy']],
                  ['Signed off on', kyc?.['verifiedAt'] ? shortDate(String(kyc['verifiedAt'])) : null],
                  ['On file until', kycAssessment.retentionExpiresAt ? shortDate(kycAssessment.retentionExpiresAt) : null],
                ].map(([label, value]) => (
                  <tr key={String(label)}>
                    <td style={{ width: 200, color: 'var(--text-3)' }}>{String(label)}</td>
                    <td>{value ? String(value) : <span className="dim">Not recorded</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid cols-2">
        <Panel title="Deals">
          {data.deals.length === 0 ? (
            <Empty>No deals.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Deal</th><th>Stage</th><th className="num">Updated</th></tr></thead>
                <tbody>
                  {data.deals.map((d) => (
                    <tr key={String(d['id'])} className="clickable" onClick={() => ctx.navigate(`deal/${d['id']}`)}>
                      <td>{String(d['title'])}<div className="dim">{String(d['reference'])}</div></td>
                      <td><Chip tone={d['stage'] === 'won' ? 'good' : d['stage'] === 'lost' ? 'critical' : 'neutral'}>{String(d['stage'])}</Chip></td>
                      <td className="num muted">{shortDate(String(d['updated_at']))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Orders">
          {data.orders.length === 0 ? (
            <Empty>No orders.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Reference</th><th className="num">Revenue</th><th className="num">Margin</th><th>Paid</th></tr></thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={String(o['id'])}>
                      <td className="num">{String(o['reference'])}<div className="dim">{shortDate(String(o['ordered_at']))}</div></td>
                      <td className="num">{gbp(Number(o['revenue']), true)}</td>
                      <td className="num">{gbp(Number(o['gross_margin']), true)}<div className="dim">{pct(Number(o['gm_bps']))}</div></td>
                      <td>
                        {String(o['payment_status']) === 'paid'
                          ? <Chip tone="good">Paid</Chip>
                          : <Chip tone="warn">Unpaid</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {String(account['notes']).trim().length > 0 && (
        <Panel title="Notes"><p className="muted">{String(account['notes'])}</p></Panel>
      )}
    </>
  );
}
