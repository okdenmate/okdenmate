import { useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../api';
import { useApi } from '../hooks';
import { Button, Callout, Chip, Empty, Panel, Stat } from '../components/ui';
import { shortDate } from '../format';

interface Question {
  id: string;
  tier: 1 | 2 | 3;
  business: string;
  question: string;
  whyItMatters: string;
  howToAnswer: string;
  consequenceIfUnanswered: string;
  owner: string;
  blocks: string[];
  status: string;
  answer: string | null;
  answeredAt: string | null;
}

export function Questions({ ctx }: { ctx: Ctx }) {
  const { data, loading, reload } = useApi<{ questions: Question[]; prioritised: Array<{ questionId: string; weight: number }> }>(
    '/api/questions',
    [ctx.version],
  );
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Empty>Loading…</Empty>;
  if (!data) return null;

  const weight = (id: string) => data.prioritised.find((p) => p.questionId === id)?.weight ?? 0;
  const sorted = [...data.questions].sort((a, b) => {
    if ((a.status === 'answered') !== (b.status === 'answered')) return a.status === 'answered' ? 1 : -1;
    return weight(b.id) - weight(a.id);
  });
  const open = sorted.filter((q) => q.status === 'open' || q.status === 'chasing');

  async function update(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    try {
      await api.patch(`/api/questions/${id}`, patch);
      reload();
      ctx.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Open questions</div>
        <h1>What would turn assumptions into numbers</h1>
        <p>
          Half the figures in this system carry an Assumed tag, and these are the reasons why. Each one
          names the screens that would firm up if it were answered.
        </p>
      </div>

      <div className="grid cols-3 rise" style={{ marginBottom: 16 }}>
        <Panel><Stat label="Still open" value={String(open.length)} hero /></Panel>
        <Panel>
          <Stat
            label="Tier one"
            value={String(open.filter((q) => q.tier === 1).length)}
            note="The forecast does not work at all without these."
          />
        </Panel>
        <Panel>
          <Stat label="Answered" value={String(data.questions.filter((q) => q.status === 'answered').length)} />
        </Panel>
      </div>

      <div className="stack">
        {sorted.map((q) => (
          <Panel key={q.id}>
            <div className="row between" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
              <div>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 15 }}>{q.id}</strong>
                  <Chip tone={q.tier === 1 ? 'critical' : q.tier === 2 ? 'warn' : 'neutral'}>Tier {q.tier}</Chip>
                  <Chip tone="neutral">{q.business === 'BOTH' ? 'Both businesses' : q.business === 'UKN' ? 'UK Nitrates' : 'Reeve Wood'}</Chip>
                  <Chip tone={q.status === 'answered' ? 'good' : q.status === 'chasing' ? 'warn' : 'neutral'}>{q.status}</Chip>
                </div>
                <h2 style={{ fontSize: 16, marginBottom: 6 }}>{q.question}</h2>
              </div>
              <div className="dim" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Owner: {q.owner}</div>
            </div>

            <p className="muted" style={{ fontSize: 13.5 }}>{q.whyItMatters}</p>

            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <div>
                <div className="dim" style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 4 }}>
                  How to answer it
                </div>
                <div style={{ fontSize: 13 }}>{q.howToAnswer}</div>
              </div>
              <div>
                <div className="dim" style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 4 }}>
                  If it stays open
                </div>
                <div style={{ fontSize: 13 }}>{q.consequenceIfUnanswered}</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="dim" style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 5 }}>
                Blocks
              </div>
              <div className="row" style={{ gap: 6 }}>
                {q.blocks.map((b) => <Chip key={b} tone="neutral">{b}</Chip>)}
              </div>
            </div>

            {q.answer && (
              <div style={{ marginTop: 12 }}>
                <Callout tone="good" title={`Answered${q.answeredAt ? ` ${shortDate(q.answeredAt)}` : ''}.`}>{q.answer}</Callout>
              </div>
            )}

            {q.status !== 'answered' && (
              <div className="row" style={{ marginTop: 14 }}>
                {q.status !== 'chasing' && (
                  <Button small disabled={busy === q.id} onClick={() => update(q.id, { status: 'chasing' })}>
                    Chasing it
                  </Button>
                )}
                <Button
                  small
                  variant="primary"
                  disabled={busy === q.id}
                  onClick={() => {
                    const answer = window.prompt(`Answer to ${q.id}`);
                    if (answer) void update(q.id, { status: 'answered', answer });
                  }}
                >
                  Record the answer
                </Button>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
