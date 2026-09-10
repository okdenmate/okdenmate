/**
 * Widget styles.
 *
 * These live inside a shadow root, so the host page's stylesheet cannot reach
 * in and this cannot leak out. That matters more than it sounds: a form
 * dropped into an unknown CMS theme is otherwise at the mercy of whatever
 * `input { }` rule that theme happens to carry.
 *
 * The palette is the group design system's, with a light variant for sites
 * that are not ready to run a dark panel.
 */

export const CSS = `
:host {
  --bg: #151109;
  --panel: rgba(244,239,226,.05);
  --panel-2: rgba(244,239,226,.085);
  --line: rgba(244,239,226,.16);
  --text: #f4efe2;
  --text-2: #b3a98f;
  --text-3: #867c66;
  --lime: #cbe93f;
  --lime-ink: #171200;
  --sage: #8c9839;
  --amber: #e8b45c;
  --good: #6fd8ae;
  --radius: 20px;

  all: initial;
  display: block;
  font-family: 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  container-type: inline-size;
}

:host([data-surface="light"]) {
  --bg: #f7f5ef;
  --panel: rgba(21,17,9,.035);
  --panel-2: rgba(21,17,9,.06);
  --line: rgba(21,17,9,.14);
  --text: #211b0f;
  --text-2: #59513f;
  --text-3: #7d7460;
  /* The brand lime fails as a text colour on a light ground, so on this
     surface the call to action carries dark ink on sage instead. */
  --lime: #6f7a2b;
  --lime-ink: #ffffff;
  --good: #1d7a56;
}

* { box-sizing: border-box; }

.card {
  position: relative;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 26px;
}

/* Two diffuse fields, rationed: one behind the tool, one behind the result. */
.blob { position: absolute; border-radius: 50%; filter: blur(78px); pointer-events: none; }
.blob-a { width: 320px; height: 320px; background: var(--sage); opacity: .30; top: -130px; left: -60px; }
.blob-b { width: 260px; height: 260px; background: var(--amber); opacity: .16; bottom: -120px; right: -70px; }
:host([data-surface="light"]) .blob { opacity: .13; }

.grain {
  position: absolute; inset: 0; pointer-events: none; opacity: .055; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
:host([data-surface="light"]) .grain { display: none; }

.inner { position: relative; }

h2 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -.032em; line-height: 1.15; }
p  { margin: 0 0 14px; color: var(--text-2); font-size: 14px; max-width: 58ch; }
p:last-child { margin-bottom: 0; }

.steps { display: flex; gap: 6px; margin-bottom: 18px; }
.step-pip { flex: 1; height: 3px; border-radius: 999px; background: var(--panel-2); }
.step-pip.done { background: var(--lime); }
.step-label { color: var(--text-3); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }

.field { display: block; margin-bottom: 14px; }
.field > span { display: block; color: var(--text-2); font-size: 12.5px; margin-bottom: 5px; }
.hint { color: var(--text-3); font-size: 11.5px; margin-top: 5px; }

input, select, textarea {
  width: 100%; font: inherit; font-size: 14px; color: var(--text);
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 9px 11px; appearance: none;
}
:host([data-surface="light"]) select { background-image: none; }
select option { color: #211b0f; background: #fff; }
textarea { min-height: 76px; resize: vertical; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--lime); outline-offset: 1px; }
input::placeholder, textarea::placeholder { color: var(--text-3); }

.row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
@container (max-width: 460px) { .row { grid-template-columns: 1fr; } }

.chips { display: flex; flex-wrap: wrap; gap: 7px; }
.chip {
  font: inherit; font-size: 13px; cursor: pointer;
  background: var(--panel); color: var(--text-2);
  border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px;
}
.chip:hover { background: var(--panel-2); color: var(--text); }
.chip[aria-pressed="true"] { background: var(--lime); border-color: var(--lime); color: var(--lime-ink); font-weight: 600; }

.btn {
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--text);
  border-radius: 11px; padding: 10px 18px;
}
.btn:hover:not(:disabled) { background: var(--panel-2); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary { background: var(--lime); border-color: var(--lime); color: var(--lime-ink); font-weight: 600; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 18px; }
.spacer { flex: 1; }

.result {
  margin: 18px 0; padding: 16px 18px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
}
.result .figure { font-size: 30px; font-weight: 600; letter-spacing: -.035em; color: var(--lime); line-height: 1.1; }
:host([data-surface="light"]) .result .figure { color: var(--text); }
.result .sub { color: var(--text-2); font-size: 13px; margin-top: 4px; }
.result .lead { color: var(--text-2); font-size: 13px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }

.notice { font-size: 13px; color: var(--text-2); border-radius: 12px; border: 1px solid var(--line); padding: 11px 14px; margin-bottom: 14px; }
.notice strong { color: var(--text); }
.notice.err { border-color: rgba(224,64,90,.5); background: rgba(224,64,90,.1); color: #f5a2b1; }
:host([data-surface="light"]) .notice.err { background: rgba(224,64,90,.08); color: #a3243a; }

.done-mark { font-size: 26px; color: var(--good); line-height: 1; margin-bottom: 10px; }

.soft { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
.soft .row-inline { display: flex; gap: 8px; }
.soft .row-inline input { flex: 1; }
@container (max-width: 460px) { .soft .row-inline { flex-direction: column; } }

.legal { color: var(--text-3); font-size: 11.5px; margin-top: 14px; }

.sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
