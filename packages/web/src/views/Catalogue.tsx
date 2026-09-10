import type { Ctx } from '../App';
import { useApi } from '../hooks';
import type { Row } from '../types';
import { Callout, Chip, Empty, Panel, Stat, Tag } from '../components/ui';
import { gbp, pct, shortDate } from '../format';

export function Catalogue({ ctx }: { ctx: Ctx }) {
  const anchors = useApi<{ anchors: Row[] }>('/api/anchors', [ctx.version]);
  const products = ctx.reference.products;

  const specialty = products.filter((p) => p.productClass === 'specialty');
  const commodity = products.filter((p) => p.productClass === 'commodity');

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Catalogue</div>
        <h1>What is sold, and what it earns</h1>
        <p>
          Classification is a property of the product, not a judgement made per deal. That is what lets the
          quote screen prompt for a mix shift without anyone having to remember to.
        </p>
      </div>

      <div className="grid cols-3 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Specialty lines" value={String(specialty.length)} note="Opaque pricing, technical sell, real margin." /></Panel>
        <Panel><Stat label="Commodity lines" value={String(commodity.length)} note="Price-transparent, thin margin, a logistics play." /></Panel>
        <Panel>
          <Stat
            label="Regulated at the point of sale"
            value={String(products.filter((p) => p.id.startsWith('an-') || p.formula === 'KNO3').length)}
            note="Poisons Act buyer checks apply to every sale of these, whatever the tonnage."
          />
        </Panel>
      </div>

      <Panel title="Products">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Class</th>
                <th>Analysis</th>
                <th>Hazard</th>
                <th>Stock</th>
                <th className="num">Target margin</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.formula && <div className="dim">{p.formula}</div>}
                  </td>
                  <td>
                    <Chip tone={p.productClass === 'specialty' ? 'specialty' : p.productClass === 'commodity' ? 'commodity' : 'neutral'}>
                      {p.productClass}
                    </Chip>
                    {(p.id.startsWith('an-') || p.formula === 'KNO3') && (
                      <div style={{ marginTop: 4 }}><Chip tone="critical">Precursor</Chip></div>
                    )}
                  </td>
                  <td className="muted">{p.analysis ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {p.unClass ?? '—'}
                    {p.unNumber && <div className="dim">{p.unNumber}</div>}
                  </td>
                  <td>
                    {p.ukStock ? (
                      <Chip tone="good">King&rsquo;s Lynn</Chip>
                    ) : (
                      <Chip tone="warn">8 to 10 weeks</Chip>
                    )}
                  </td>
                  <td className="num">
                    {p.targetGmBps.value === null ? (
                      <span className="dim">Not known<Tag tag="U" /></span>
                    ) : (
                      <>
                        {pct(p.targetGmBps.value[0], 0)}–{pct(p.targetGmBps.value[1], 0)}
                        <Tag tag={p.targetGmBps.tag} />
                      </>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12.5, maxWidth: 340 }}>{p.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Published reference prices" hint="A buyer can check any ammonium nitrate quote against these in thirty seconds">
        {(anchors.data?.anchors ?? []).length === 0 ? (
          <Empty>No reference prices recorded.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th className="num">Price per tonne</th><th className="num">As of</th><th>Source</th><th>Basis</th></tr>
              </thead>
              <tbody>
                {(anchors.data?.anchors ?? []).map((a) => (
                  <tr key={String(a['id'])}>
                    <td>{String(a['product_name'])}</td>
                    <td className="num">{gbp(Number(a['price_per_tonne']))}</td>
                    <td className="num muted">{shortDate(String(a['as_of']))}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{String(a['source'])}</td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 340 }}>{String(a['basis'])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Advertised but not deliverable">
        <div className="stack">
          {ctx.reference.unfulfillableServices.map((s) => (
            <Callout key={s.id} tone="critical" title={s.name}>{s.note}</Callout>
          ))}
        </div>
      </Panel>

      <Panel title="Margin floors" hint="Below these a line is not worth the handling, the duty or the working capital">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Class</th><th className="num">Floor</th><th>What happens</th></tr></thead>
            <tbody>
              {Object.entries(ctx.reference.marginFloors).map(([cls, bps]) => (
                <tr key={cls}>
                  <td>{cls}</td>
                  <td className="num">{pct(bps, 0)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {cls === 'specialty'
                      ? 'A specialty line below its floor blocks the quote. It means the pricing has gone wrong, not that specialty is thin.'
                      : cls === 'commodity'
                        ? 'Warns rather than blocks. Ammonium nitrate genuinely runs at 2 to 6 per cent.'
                        : 'Warns.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
