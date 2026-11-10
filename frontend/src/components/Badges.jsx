import { CASE_STATUS, SOURCE_MODES } from '../constants.js';

// Chip that tells the user where a piece of information came from.
// Driven by the API's source_mode value (never inferred in the UI).
export function SourceChip({ mode, children }) {
  const meta = SOURCE_MODES[mode] ?? { label: 'Unknown source', tone: 'unverified', icon: '?' };
  return (
    <span className={`chip chip-${meta.tone}`} title={meta.label}>
      <span aria-hidden="true">{meta.icon}</span> {children ?? meta.label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const meta = CASE_STATUS[status] ?? { label: status, tone: 'neutral' };
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>;
}
