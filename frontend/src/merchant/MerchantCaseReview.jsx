import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import { SourceChip, StatusBadge } from '../components/Badges.jsx';
import Timeline from '../components/Timeline.jsx';
import AIBrief from '../components/AIBrief.jsx';
import { ISSUE_LABELS } from '../constants.js';
import { formatDateTime, formatMoney, newIdempotencyKey } from '../utils/format.js';
import { DuplicateBadge, PriorityBadge, SyntheticNotice } from './MerchantBits.jsx';
import { AUDIT_LABELS, DUPLICATE_REASON_LABELS, MAX_MERCHANT_DRAFT } from './merchantConstants.js';
import './merchant.css';

export default function MerchantCaseReview() {
  const { caseId } = useParams();
  const view = useAsync((signal) => api.getMerchantCase(caseId, { signal }), [caseId]);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(null); // which action is running
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState('');
  const keyRef = useRef({ fingerprint: null, key: null }); // reuse the Idempotency-Key only when retrying the SAME request

  const serverDraft = view.data?.case.merchant_draft ?? '';
  useEffect(() => { setDraft(serverDraft); }, [serverDraft, caseId]);

  if (view.loading && !view.data) return <Loading label="Loading case…" />;
  if (view.error) return <ErrorBox error={view.error} onRetry={view.reload} title="Couldn’t load this case" />;

  const { case: c, payment, evidence, evidence_gaps: gaps, timeline, recommendation: rec, duplicate_hints: dups, audit } = view.data;
  const allowed = c.allowed_transitions ?? [];
  const closed = c.status === 'closed';
  const dirty = draft.trim() !== serverDraft.trim();
  const tooLong = draft.length > MAX_MERCHANT_DRAFT;

  async function run(label, patch, success) {
    setBusy(label); setActionError(null); setNotice('');
    const fingerprint = JSON.stringify(patch);
    if (keyRef.current.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: newIdempotencyKey() };
    try {
      await api.updateMerchantCase(c.id, patch, keyRef.current.key);
      keyRef.current = { fingerprint: null, key: null };
      setNotice(success);
      view.reload();
    } catch (err) {
      // Keep the key only when we could not tell whether the server applied the change.
      if (!(err.code === 'TIMEOUT' || err.code === 'NETWORK_ERROR')) keyRef.current = { fingerprint: null, key: null };
      setActionError(err);
    } finally { setBusy(null); }
  }

  const saveDraft = () => run('save', { merchant_draft: draft }, 'Draft saved.');
  const markReviewed = () => run('review', dirty ? { status: 'under_review', merchant_draft: draft } : { status: 'under_review' }, 'Marked as under review.');
  const requestInfo = () => run('info', { status: 'awaiting_information', merchant_draft: draft }, 'Marked as awaiting information. Your message is saved with the case.');
  const resolve = () => run('resolve', dirty ? { status: 'resolved', merchant_draft: draft } : { status: 'resolved' }, 'Marked as resolved in this app.');
  const closeCase = () => {
    if (window.confirm('Close this case? This only closes the record in this app. It cannot be reopened, and no refund or PayPal action is taken.')) {
      run('close', dirty ? { status: 'closed', merchant_draft: draft } : { status: 'closed' }, 'Case closed.');
    }
  };

  const can = (s) => allowed.includes(s) && !busy;

  return (
    <>
      <p><Link to="/merchant">← Back to inbox</Link></p>
      <div className="row gap wrap between">
        <h1>{ISSUE_LABELS[c.issue_type] ?? c.issue_type}</h1>
        <span className="row gap wrap"><PriorityBadge priority={c.priority} /><StatusBadge status={c.status} /><SourceChip mode={c.source_mode} /></span>
      </div>
      <p className="muted small">Case {c.id} · {c.buyer?.display_name} · opened {formatDateTime(c.created_at)}{c.reviewed_at ? ` · reviewed ${formatDateTime(c.reviewed_at)}` : ''}</p>
      {c.source_mode === 'synthetic_demo' && <SyntheticNotice />}

      <section className="card">
        <h2>Order and payment</h2>
        <p><strong>{payment.merchant_label}</strong> · {formatMoney(payment.amount, payment.currency)}</p>
        <p className="row gap wrap">
          <span className="badge badge-neutral">PayPal status: {payment.verified_status}</span>
          <code className="source-field">{payment.paypal_order_id}</code>
          <SourceChip mode={payment.source_mode} />
        </p>
        <h3>Buyer’s description</h3>
        {c.narrative ? (
          <>
            <p className="quote">{c.narrative}</p>
            <SourceChip mode={c.narrative_source_mode} />
            <p className="muted small">This is the buyer’s own account. It has not been checked.</p>
          </>
        ) : <p className="muted">The buyer didn’t add a description.</p>}
      </section>

      {dups?.items?.length > 0 && (
        <section className="card" aria-labelledby="dup-h">
          <h2 id="dup-h">Possible related cases</h2>
          <p className="muted small">{dups.note}</p>
          <ul className="dup-list">
            {dups.items.map((d) => (
              <li key={d.case_id}>
                <div className="row gap wrap between">
                  <span><strong>{ISSUE_LABELS[d.issue_type] ?? d.issue_type}</strong> · <code className="source-field">{d.case_id}</code></span>
                  <span className="row gap"><StatusBadge status={d.status} /><DuplicateBadge hint={{ count: 1, confidence: d.confidence, reasons: d.reasons.map((r) => r.code) }} /></span>
                </div>
                <ul className="small">{d.reasons.map((r) => <li key={r.code} title={DUPLICATE_REASON_LABELS[r.code]}>{r.label}</li>)}</ul>
                <Link className="small" to={`/merchant/cases/${encodeURIComponent(d.case_id)}`}>Open that case</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Timeline</h2>
        <Timeline items={timeline} />
      </section>

      <section className="card">
        <h2>Evidence</h2>
        {evidence.length ? (
          <ul className="evidence-list">
            {evidence.map((e) => (
              <li key={e.id}>
                <span>{e.description}</span>
                <span className="row gap wrap"><span className="muted small">{e.type.replace(/_/g, ' ')} · {formatDateTime(e.created_at)}</span><SourceChip mode={e.source_mode} /></span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No evidence has been added yet.</p>}
        <h3>Evidence gaps</h3>
        {gaps?.length ? (
          <ul>{gaps.map((g, i) => <li key={g.type ? `${g.type}-${i}` : i}>{g.label ?? String(g)}</li>)}</ul>
        ) : <p className="muted">Nothing expected is missing for this issue type.</p>}
        <p className="muted small">Based on what is usually needed for this issue type. Items the buyer added are unverified unless marked otherwise.</p>
      </section>

      <section className="card">
        <h2>AI case brief</h2>
        {rec ? <AIBrief rec={rec} /> : (
          <Empty title="No AI brief yet">The brief is generated from the case page. Until then, use the timeline and evidence gaps above.</Empty>
        )}
      </section>

      <section className="card">
        <h2>Your response</h2>
        <p className="muted small">Draft the message the buyer will see. Nothing is sent automatically, and nothing here moves money.</p>
        <label htmlFor="merchant-draft" className="visually-hidden">Response draft</label>
        <textarea id="merchant-draft" rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={closed || Boolean(busy)} placeholder="Write a neutral, factual reply…" aria-describedby="draft-help" />
        <div className="row gap wrap between" id="draft-help">
          <span className={`small ${tooLong ? 'field-error' : 'muted'}`}>{draft.length} / {MAX_MERCHANT_DRAFT}{dirty ? ' · unsaved changes' : ''}</span>
          {rec?.draft_message && !closed && (
            <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => setDraft(rec.draft_message)}>
              Insert AI suggestion
            </button>
          )}
        </div>
        {rec?.draft_message && <p className="muted small">The AI suggestion is a starting point written for review. Edit it before you save.</p>}

        {notice && <div className="notice notice-ok" role="status">{notice}</div>}
        {actionError && <ErrorBox error={actionError} title="That didn’t go through" />}

        {closed ? <p className="muted">This case is closed and can no longer be changed.</p> : (
          <div className="row gap wrap actions">
            <button className="btn" disabled={!dirty || tooLong || Boolean(busy)} onClick={saveDraft}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
            {allowed.includes('under_review') && <button className="btn btn-secondary" disabled={!can('under_review') || tooLong} onClick={markReviewed}>{busy === 'review' ? 'Updating…' : 'Mark as reviewed'}</button>}
            {allowed.includes('awaiting_information') && (
              <button className="btn btn-secondary" disabled={!can('awaiting_information') || !draft.trim() || tooLong} onClick={requestInfo} title={!draft.trim() ? 'Write a message to the buyer first' : undefined}>
                {busy === 'info' ? 'Updating…' : 'Request more information'}
              </button>
            )}
            {allowed.includes('resolved') && <button className="btn btn-secondary" disabled={!can('resolved') || tooLong} onClick={resolve}>{busy === 'resolve' ? 'Updating…' : 'Mark resolved'}</button>}
            {allowed.includes('closed') && <button className="btn btn-ghost btn-danger" disabled={!can('closed') || tooLong} onClick={closeCase}>{busy === 'close' ? 'Closing…' : 'Close case'}</button>}
          </div>
        )}
        <p className="muted small">“Resolved” and “Closed” update this app’s record only. They don’t refund, charge or change anything in PayPal.</p>
      </section>

      <section className="card">
        <details>
          <summary><strong>Audit trail</strong> <span className="muted small">({audit?.length ?? 0} events)</span></summary>
          {audit?.length ? (
            <ul className="audit-list">
              {audit.map((a) => (
                <li key={a.id}>
                  <span>{AUDIT_LABELS[a.event_type] ?? a.event_type}</span>
                  <span className="muted small">{formatDateTime(a.timestamp)}{a.actor_id ? ` · ${a.actor_id}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No events recorded.</p>}
        </details>
      </section>
    </>
  );
}
