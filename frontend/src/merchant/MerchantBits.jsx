import { DUPLICATE_REASON_LABELS, PRIORITY } from './merchantConstants.js';

export function PriorityBadge({ priority }) {
  const meta = PRIORITY[priority] ?? PRIORITY.normal;
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>;
}

// Always worded as "possible": the hint compares simple fields and is never a verdict.
export function DuplicateBadge({ hint }) {
  if (!hint) return null;
  const reasons = (hint.reasons ?? []).map((r) => DUPLICATE_REASON_LABELS[r] ?? r).join(' · ');
  return (
    <span className="badge badge-warn" title={`Possible duplicate (${hint.confidence} confidence). ${reasons}. This is a hint, not a judgment.`}>
      ⧉ Possible duplicate{hint.count > 1 ? ` (${hint.count})` : ''}
    </span>
  );
}

export function SyntheticNotice() {
  return (
    <div className="notice notice-warn" role="note">
      <strong>Synthetic demo case.</strong> This is seeded sample data. It is not a live PayPal dispute and no real payment is involved.
    </div>
  );
}
