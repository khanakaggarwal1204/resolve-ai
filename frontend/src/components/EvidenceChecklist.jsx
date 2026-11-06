import { useState } from 'react';
import { api } from '../api/client.js';
import { SourceChip } from './Badges.jsx';
import { EVIDENCE_TYPES } from '../constants.js';
import { formatDateTime } from '../utils/format.js';

export default function EvidenceChecklist({ caseId, evidence, gaps, onAdded }) {
  const [type, setType] = useState('order_confirmation');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function add(e) {
    e.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addEvidence(caseId, { type, description: description.trim() });
      setDescription('');
      onAdded?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Missing evidence</h3>
      {gaps?.length ? (
        <ul className="checklist">
          {gaps.map((g, i) => <li key={i}><span aria-hidden="true">☐</span> {g}</li>)}
        </ul>
      ) : (
        <p className="muted">
          {gaps ? 'No gaps flagged.' : 'Generate the AI brief to see which evidence is still missing.'}
        </p>
      )}

      <h3>Evidence you’ve added</h3>
      {evidence?.length ? (
        <ul className="checklist">
          {evidence.map((e) => (
            <li key={e.id}>
              <span aria-hidden="true">☑</span> {e.description}
              <div className="row gap small muted">
                <span>{formatDateTime(e.created_at)}</span>
                {/* Unverified unless the backend says it verified it */}
                <SourceChip mode={e.verified_at ? 'app_owned' : 'user_provided_unverified'}>
                  {e.verified_at ? 'Verified by app' : 'Unverified'}
                </SourceChip>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing added yet.</p>
      )}

      <form onSubmit={add} className="evidence-form">
        <label htmlFor="ev-type" className="small muted">Type</label>
        <select id="ev-type" value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
          {EVIDENCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <label htmlFor="ev-desc" className="small muted">Describe it (metadata only; no files are uploaded)</label>
        <input
          id="ev-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Tracking number sent by merchant on 3 Nov"
          maxLength={300}
          disabled={busy}
        />
        {error && <p className="field-error" role="alert">{error.message}</p>}
        <button className="btn btn-secondary" disabled={busy || !description.trim()}>
          {busy ? 'Adding…' : 'Add evidence'}
        </button>
      </form>
    </div>
  );
}
