import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { applyProfile, currentProfile, PROFILES, type ProfileId } from './design';
import type { Product, User } from './types';
import { Button, Callout, Field, Panel } from './components/ui';
import { Dashboard } from './views/Dashboard';
import { Pipeline } from './views/Pipeline';
import { DealDetail } from './views/DealDetail';
import { Accounts } from './views/Accounts';
import { AccountDetail } from './views/AccountDetail';
import { Enquiries } from './views/Enquiries';
import { Compliance } from './views/Compliance';
import { Storage } from './views/Storage';
import { Commission } from './views/Commission';
import { Funnel } from './views/Funnel';
import { MixShift } from './views/MixShift';
import { Questions } from './views/Questions';
import { Catalogue } from './views/Catalogue';

export interface Reference {
  products: Product[];
  sectors: Array<{ id: string; route: { productId: string; rationale: string } }>;
  commissionRates: Array<{ id: string; business: string; line: string; basis: string; bps: number; description: string }>;
  dealStages: string[];
  funnelStages: Array<{ stage: string; label: string; event: string; tells: string; benchmarkBps: number | null; benchmarkNote: string }>;
  storageThresholds: Array<{ id: string; limitKg: number; applies: string; notify: string; basis: string }>;
  marginFloors: Record<string, number>;
  unfulfillableServices: ReadonlyArray<{ id: string; name: string; note: string }>;
}

export interface Ctx {
  user: User;
  reference: Reference;
  navigate: (route: string) => void;
  /** Bump to force dependent views to refetch after a write. */
  refresh: () => void;
  version: number;
}

const NAV = [
  {
    label: 'Today',
    items: [
      { route: 'dashboard', name: 'Command deck' },
      { route: 'enquiries', name: 'Enquiries', badge: 'enquiries' },
      { route: 'pipeline', name: 'Pipeline' },
    ],
  },
  {
    label: 'Book',
    items: [
      { route: 'accounts', name: 'Accounts' },
      { route: 'mix', name: 'Mix shift' },
      { route: 'commission', name: 'Commission' },
    ],
  },
  {
    label: 'Duty',
    items: [
      { route: 'compliance', name: 'Compliance', badge: 'compliance' },
      { route: 'storage', name: 'Storage' },
    ],
  },
  {
    label: 'Instruments',
    items: [
      { route: 'funnel', name: 'Funnel' },
      { route: 'catalogue', name: 'Catalogue' },
      { route: 'questions', name: 'Open questions' },
    ],
  },
] as const;

function useHashRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || 'dashboard');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || 'dashboard');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((r: string) => {
    window.location.hash = r;
    window.scrollTo({ top: 0 });
  }, []);
  return [route, navigate];
}

function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ user: User }>('/api/auth/login', { email, password });
      onSignedIn(data.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <Panel className="rise">
        <div style={{ marginBottom: 18 }}>
          <div className="brand">
            <div className="mark">UK Nitrates</div>
            <div className="sub">Revenue and duty system</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && (
            <div style={{ marginBottom: 12 }}>
              <Callout tone="critical">{error}</Callout>
            </div>
          )}
          <Button variant="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function ProfileSwitch() {
  const [profile, setProfile] = useState<ProfileId>(() => currentProfile());
  const active = PROFILES.find((p) => p.id === profile);
  return (
    <div style={{ padding: '0 10px', marginBottom: 14 }}>
      <div className="nav-group-label" style={{ padding: '0 0 6px' }}>
        Design profile
      </div>
      <div className="row" style={{ gap: 6 }}>
        {PROFILES.map((p) => (
          <Button
            key={p.id}
            small
            variant={p.id === profile ? 'primary' : 'default'}
            title={p.description}
            onClick={() => {
              applyProfile(p.id);
              setProfile(p.id);
            }}
          >
            {p.name}
          </Button>
        ))}
      </div>
      {active && (
        <div className="dim" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
          {active.description}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, navigate] = useHashRoute();
  const [version, setVersion] = useState(0);
  const [badges, setBadges] = useState<{ enquiries: number; compliance: number }>({ enquiries: 0, compliance: 0 });

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api
      .get<{ user: User }>('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.get<Reference>('/api/reference').then(setReference).catch(() => setReference(null));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api
      .get<{ newEnquiryCount: number; compliance: { breaches: Array<{ severity: string }>; suspicious: Array<{ status: string }> } }>(
        '/api/dashboard',
      )
      .then((d) =>
        setBadges({
          enquiries: d.newEnquiryCount,
          compliance:
            d.compliance.breaches.filter((b) => b.severity === 'critical').length +
            d.compliance.suspicious.filter((s) => s.status === 'open').length,
        }),
      )
      .catch(() => undefined);
  }, [user, version]);

  if (loading) return <div className="signin dim">Loading…</div>;
  if (!user) return <SignIn onSignedIn={setUser} />;
  if (!reference) return <div className="signin dim">Loading reference data…</div>;

  const ctx: Ctx = { user, reference, navigate, refresh, version };
  const [head, param] = route.split('/');

  function render() {
    switch (head) {
      case 'dashboard': return <Dashboard ctx={ctx} />;
      case 'pipeline': return <Pipeline ctx={ctx} />;
      case 'deal': return <DealDetail ctx={ctx} dealId={param ?? ''} />;
      case 'accounts': return <Accounts ctx={ctx} />;
      case 'account': return <AccountDetail ctx={ctx} accountId={param ?? ''} />;
      case 'enquiries': return <Enquiries ctx={ctx} />;
      case 'compliance': return <Compliance ctx={ctx} />;
      case 'storage': return <Storage ctx={ctx} />;
      case 'commission': return <Commission ctx={ctx} />;
      case 'funnel': return <Funnel ctx={ctx} />;
      case 'mix': return <MixShift ctx={ctx} />;
      case 'questions': return <Questions ctx={ctx} />;
      case 'catalogue': return <Catalogue ctx={ctx} />;
      default: return <Dashboard ctx={ctx} />;
    }
  }

  async function signOut() {
    await api.post('/api/auth/logout');
    window.location.hash = '';
    window.location.reload();
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="mark">UK Nitrates</div>
          <div className="sub">Revenue and duty system</div>
        </div>
        {NAV.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              const badge = 'badge' in item ? badges[item.badge as keyof typeof badges] : 0;
              return (
                <button
                  key={item.route}
                  className="nav-item"
                  aria-current={head === item.route ? 'page' : undefined}
                  onClick={() => navigate(item.route)}
                >
                  <span>{item.name}</span>
                  {badge > 0 && (
                    <span className={`nav-count ${item.route === 'compliance' ? 'alert' : ''}`}>{badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <div className="divider" />
        <ProfileSwitch />
        <div className="divider" />
        <div style={{ padding: '0 10px' }}>
          <div style={{ fontSize: 13 }}>{user.name}</div>
          <div className="dim" style={{ fontSize: 11.5, marginBottom: 9 }}>
            {user.role.replace(/_/g, ' ')}
          </div>
          <Button small onClick={signOut}>Sign out</Button>
        </div>
      </nav>
      <main className="main">{render()}</main>
    </div>
  );
}
