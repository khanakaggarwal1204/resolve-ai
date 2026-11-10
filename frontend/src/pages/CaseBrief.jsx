import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import { SourceChip, StatusBadge } from '../components/Badges.jsx';
import Timeline from '../components/Timeline.jsx';
import AIBrief from '../components/AIBrief.jsx';
import EvidenceChecklist from '../components/EvidenceChecklist.jsx';
import DraftEditor from '../components/DraftEditor.jsx';
import { ISSUE_LABELS } from '../constants.js';
import { formatDateTime, formatMoney } from '../utils/format.js';

export default function CaseBrief() {
  const { caseId } = useParams();
  const view = useAsync((signal) => api.getCase(caseId, { signal }), [caseId]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  async function runAnalysis() {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await api.analyzeCase(caseId);
      view.reload();
    } catch (err) {
      setAnalyzeError(err);
    } finally {
      setAnalyzing(false);
    }
  }

  if (view.loading && !view.data) return <Loading label="Loading your case…" />;
  if (view.error) return <ErrorBox error={view.error} onRetry={view.reload} title="Couldn’t load this case" />;

  const { case: c, payment, evidence, timeline, recommendation: rec } = view.data;

  return (
    <>
      <p><Link to="/">← Back to orders</Link></p>
      <div className="row gap wrap between">
        <h1>{ISSUE_LABELS[c.issue_type] ?? c.issue_type}</h1>
        <span className="row gap"><StatusBadge status={c.status} /><SourceChip mode={c.source_mode} /></span>
      </div>
      <p className="muted small">Case {c.id} · opened {formatDateTime(c.created_at)}</p>

      <section className="card">
        <h2>Order</h2>
        <p><strong>{payment.merchant_label}</strong> · {formatMoney(payment.amount, payment.currency)}</p>
        <p className="row gap">
          <span className="badge badge-neutral">PayPal status: {payment.verified_status}</span>
          <SourceChip mode={payment.source_mode} />
        </p>
        {c.narrative && (
          <>
            <h3>Your description</h3>
            <p className="quote">{c.narrative}</p>
            <SourceChip mode="user_provided_unverified" />
          </>
        )}
      </section>

      <section className="card">
        <h2>Timeline</h2>
        <Timeline items={timeline} />
      </section>

      <section className="card">
        <div className="row gap between wrap">
          <h2>AI case brief</h2>
          {rec && (
            <button className="btn btn-ghost" onClick={runAnalysis} disabled={analyzing}>
              {analyzing ? 'Refreshing…' : 'Refresh brief'}
            </button>
          )}
        </div>
        {analyzing && !rec && <Loading label="Analysing the facts we have. This can take a few seconds…" />}
        {analyzeError && <ErrorBox error={analyzeError} onRetry={runAnalysis} title="Couldn’t generate the brief" />}
        {!analyzing && !rec && !analyzeError && (
          <Empty
            title="No brief yet"
            action={<button className="btn" onClick={runAnalysis}>Generate AI brief</button>}
          >
            The AI only uses the verified payment facts and details you’ve supplied, and points out what’s still unknown.
          </Empty>
        )}
        {rec && <AIBrief rec={rec} />}
      </section>

      <section className="card">
        <h2>Evidence checklist</h2>
        <EvidenceChecklist
          caseId={c.id}
          evidence={evidence}
          gaps={rec?.evidence_gaps}
          onAdded={view.reload}
        />
      </section>

      <section className="card">
        <h2>Draft message</h2>
        <DraftEditor
          caseId={c.id}
          initial={rec?.draft_message}
          savedDraft={c.saved_buyer_draft}
          hasBrief={Boolean(rec)}
        />
      </section>
    </>
  );
}
