import { SourceChip } from './Badges.jsx';

// Renders the validated AI JSON fields. Never parses free-form prose.
// Fields: summary, verified_facts[{statement, source_field, source_mode}],
// unknowns[], evidence_gaps[], suggested_next_step, caution, confidence_label.
export default function AIBrief({ rec }) {
  return (
    <div className="brief">
      {rec.is_fallback && (
        <div className="notice notice-warn" role="status">
          The AI service was unavailable or returned an unusable answer, so this is a safe, basic summary.
        </div>
      )}

      <h3>Summary</h3>
      <p>{rec.summary}</p>

      <h3>Verified facts</h3>
      {rec.verified_facts?.length ? (
        <ul className="facts">
          {rec.verified_facts.map((f, i) => (
            <li key={i}>
              <span>{f.statement}</span>
              <span className="row gap">
                <code className="source-field" title="Field this claim is based on">{f.source_field}</code>
                {f.source_mode && <SourceChip mode={f.source_mode} />}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No facts could be tied to a source field.</p>
      )}

      {rec.unverified_claims?.length > 0 && (
        <>
          <h3>Claims we couldn’t verify</h3>
          <ul>
            {rec.unverified_claims.map((c, i) => (
              <li key={i}>
                {c.claim} <SourceChip mode="user_provided_unverified" />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>What we don’t know yet</h3>
      {rec.unknowns?.length ? (
        <ul>{rec.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
      ) : (
        <p className="muted">{rec.evidence_gaps?.length ? 'See the evidence checklist for what is missing.' : 'Nothing flagged.'}</p>
      )}

      {rec.contradictions?.length > 0 && (
        <>
          <h3>Possible inconsistencies</h3>
          <ul>{rec.contradictions.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <p className="muted small">These are flags for a person to check, not conclusions.</p>
        </>
      )}

      <h3>Suggested next step</h3>
      <p>{rec.suggested_next_step}</p>
      {rec.recommended_actions?.length > 1 && (
        <ul>
          {rec.recommended_actions.map((a, i) => (
            <li key={i}>
              {a.description}
              {a.requires_human_approval && <span className="badge badge-warn"> Needs human approval</span>}
            </li>
          ))}
        </ul>
      )}
      {rec.urgency?.level && (
        <p className="small muted">
          Urgency: <strong>{rec.urgency.level}</strong>
          {rec.urgency.reasons?.length ? ` · ${rec.urgency.reasons.join(' ')}` : ''}
        </p>
      )}
      {rec.human_review?.required && (
        <div className="notice notice-warn" role="note">
          A person should review this case{rec.human_review.reasons?.length ? `: ${rec.human_review.reasons.join(' ')}` : '.'}
        </div>
      )}

      {rec.caution && <div className="notice notice-caution" role="note"><strong>Caution:</strong> {rec.caution}</div>}

      <p className="muted small">
        Confidence: {rec.confidence_label ?? 'n/a'} · Model: {rec.model_version ?? 'n/a'}
      </p>
    </div>
  );
}
