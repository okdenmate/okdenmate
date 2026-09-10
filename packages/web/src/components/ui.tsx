import type { ReactNode } from 'react';
import { TAG_MEANING } from '../format';

export function Panel({
  title,
  hint,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type Severity = 'good' | 'warn' | 'critical' | 'neutral' | 'info';

/**
 * Status is never carried by colour alone. Every chip has a glyph and a word,
 * because the green and red in this palette cannot be told apart under
 * deuteranopia and roughly one man in twelve has it.
 */
const GLYPH: Record<string, string> = {
  good: '●',
  warn: '▲',
  critical: '■',
  neutral: '○',
  info: '○',
  specialty: '◆',
  commodity: '●',
};

export function Chip({ tone = 'neutral', children }: { tone?: Severity | 'specialty' | 'commodity'; children: ReactNode }) {
  return (
    <span className={`chip ${tone}`}>
      <span className="glyph" aria-hidden="true">{GLYPH[tone] ?? GLYPH['neutral']}</span>
      {children}
    </span>
  );
}

/** The provenance tag. Hover gives the legend; the letter alone means nothing. */
export function Tag({ tag }: { tag: string | null | undefined }) {
  if (!tag) return null;
  return (
    <abbr className={`tag ${tag}`} title={TAG_MEANING[tag] ?? tag}>
      {tag}
    </abbr>
  );
}

export function Stat({
  label,
  value,
  note,
  hero = false,
  tag,
  unknown = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  hero?: boolean;
  tag?: string | null;
  unknown?: boolean;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${hero ? 'hero' : ''} ${unknown ? 'unknown' : ''}`}>
        {value}
        {tag && <Tag tag={tag} />}
      </div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: Severity;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`callout ${tone}`}>
      <span className="glyph" aria-hidden="true">{GLYPH[tone] ?? GLYPH['info']}</span>
      <div>
        {title && (
          <>
            <strong>{title}</strong>{' '}
          </>
        )}
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="dim" style={{ padding: '18px 0', fontSize: 13.5 }}>{children}</div>;
}

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function Button({
  variant = 'default',
  small = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger'; small?: boolean }) {
  const cls = ['btn', variant === 'default' ? '' : variant, small ? 'small' : '', props.className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button {...props} className={cls} />;
}
