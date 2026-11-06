import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { ErrorBox, Loading } from '../components/States.jsx';
import { SourceChip } from '../components/Badges.jsx';
import { ISSUE_TYPES, MAX_NARRATIVE } from '../constants.js';
import { formatMoney } from '../utils/format.js';

export default function CaseIntake() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const payment = useAsync((signal) => api.getPayment(paymentId, { signal }), [paymentId]);

  const [issueType, setIssueType] = useState('');
  const [narrative, setNarrative] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [touched, setTouched] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!issueType || narrative.length > MAX_NARRATIVE) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Only the payment reference is sent. Amount/status are never sent by the client.
      const created = await api.createCase({
        payment_reference_id: paymentId,
        issue_type: issueType,
        narrative: narrative.trim() || undefined,
      });
      navigate(`/cases/${encodeURIComponent(created.id)}`);
    } catch (err) {
      setSubmitError(err);
      setSubmitting(false);
    }
  }

  if (payment.loading) return <Loading label="Loading order…" />;
  if (payment.error) return <ErrorBox error={payment.error} onRetry={payment.reload} title="Couldn’t load this order" />;
  const p = payment.data;
  const issueMissing = touched && !issueType;

  return (
    <>
      <p><Link to="/">← Back to orders</Link></p>
      <h1>Report a problem</h1>

      <div className="card">
        <h3>{p.merchant_label}</h3>
        <p className="amount">{formatMoney(p.amount, p.currency)}</p>
        <p className="row gap">
          <span className="badge badge-neutral">PayPal status: {p.verified_status}</span>
          <SourceChip mode={p.source_mode} />
        </p>
      </div>

      {p.state && p.state !== 'completed' && (
        <div className="notice notice-warn" role="status">
          PayPal reports this order as <strong>{p.verified_status}</strong>, not a completed payment.
          {p.state === 'unknown' ? ' We couldn’t determine its state.' : ''} You can still describe your issue, but check the payment status first.
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <fieldset className="card" disabled={submitting}>
          <legend>What went wrong?</legend>
          <div className="radio-grid" role="radiogroup" aria-invalid={issueMissing}>
            {ISSUE_TYPES.map((t) => (
              <label key={t.value} className={`radio ${issueType === t.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="issue_type"
                  value={t.value}
                  checked={issueType === t.value}
                  onChange={() => setIssueType(t.value)}
                />
                <span><strong>{t.label}</strong><br /><span className="muted small">{t.hint}</span></span>
              </label>
            ))}
          </div>
          {issueMissing && <p className="field-error" role="alert">Please choose the issue that best matches.</p>}
        </fieldset>

        <div className="card">
          <label htmlFor="narrative"><strong>Tell us more</strong> <span className="muted">(optional)</span></label>
          <textarea
            id="narrative"
            rows={5}
            value={narrative}
            maxLength={MAX_NARRATIVE + 200}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="What happened, and when? Please don’t include card numbers or other sensitive data."
            disabled={submitting}
          />
          <p className={`small ${narrative.length > MAX_NARRATIVE ? 'field-error' : 'muted'}`}>
            {narrative.length}/{MAX_NARRATIVE}
          </p>
        </div>

        {submitError && <ErrorBox error={submitError} title="Couldn’t create your case" />}

        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? 'Creating case…' : 'Create case'}
        </button>
      </form>
    </>
  );
}
