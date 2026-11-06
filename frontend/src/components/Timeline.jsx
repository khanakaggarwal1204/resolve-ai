import { SourceChip } from './Badges.jsx';
import { formatDateTime } from '../utils/format.js';

export default function Timeline({ items }) {
  if (!items?.length) return <p className="muted">No events yet.</p>;
  return (
    <ol className="timeline">
      {items.map((t) => (
        <li key={t.id}>
          <div className="timeline-dot" aria-hidden="true" />
          <div>
            <p className="tl-label">{t.label}</p>
            <p className="muted small">{formatDateTime(t.timestamp)}</p>
            <SourceChip mode={t.source_mode} />
          </div>
        </li>
      ))}
    </ol>
  );
}
