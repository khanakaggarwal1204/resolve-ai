import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { ErrorBox } from './States.jsx';
import { copyText, newIdempotencyKey } from '../utils/format.js';

// Editable, neutral buyer-to-merchant message with copy / save / regenerate.
export default function DraftEditor({ caseId, initial, savedDraft, hasBrief }) {
  const baseline = savedDraft ?? initial ?? '';
  const [text, setText] = useState(baseline);
  const [saved, setSaved] = useState(baseline);
  const [status, setStatus] = useState(null); // 'copied' | 'saved' | 'copy_failed'
  const [busy, setBusy] = useState(null); // 'save' | 'regen'
  const [error, setError] = useState(null);
  const keyRef = useRef(newIdempotencyKey());

  // Reset when a new draft arrives from the server (e.g. after regeneration).
  useEffect(() => {
    setText(baseline);
    setSaved(baseline);
  }, [baseline]);

  const dirty = text !== saved;

  async function copy() {
    setStatus((await copyText(text)) ? 'copied' : 'copy_failed');
  }

  async function save() {
    setBusy('save');
    setError(null);
    try {
      await api.recordAction(caseId, {
        action_type: 'save_buyer_draft',
        idempotency_key: keyRef.current, // same key if the user retries the same save
        payload: { draft_message: text },
      });
      keyRef.current = newIdempotencyKey(); // new key for the next, different save
      setSaved(text);
      setStatus('saved');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (dirty && !window.confirm('Regenerating will replace your unsaved edits. Continue?')) return;
    setBusy('regen');
    setError(null);
    try {
      const res = await api.generateDraft(caseId);
      // Show the new draft as an unsaved edit so the buyer can review it first.
      const next = typeof res === 'string' ? res : res?.draft_message ?? res?.message ?? null;
      if (next) { setText(next); setStatus(null); }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (!text && !hasBrief) {
    return <p className="muted">Generate the AI brief first. Your draft message will be based on it.</p>;
  }
  if (!text) {
    return (
      <div>
        <p className="muted">No draft yet. We’ll write a neutral message you can edit.</p>
        <button className="btn" onClick={regenerate} disabled={busy !== null}>
          {busy === 'regen' ? 'Writing draft…' : 'Generate draft message'}
        </button>
        {error && <ErrorBox error={error} title="Couldn’t generate a draft" />}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="draft" className="muted small">
        Neutral message to the merchant. Edit it however you like before sending.
      </label>
      <textarea
        id="draft"
        rows={10}
        value={text}
        onChange={(e) => { setText(e.target.value); setStatus(null); }}
        disabled={busy === 'regen'}
      />
      <div className="row gap wrap">
        <button className="btn" onClick={copy} disabled={!text.trim()}>Copy message</button>
        <button className="btn btn-secondary" onClick={save} disabled={!dirty || busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button className="btn btn-ghost" onClick={regenerate} disabled={busy !== null}>
          {busy === 'regen' ? 'Regenerating…' : 'Regenerate'}
        </button>
        <span className="small muted" role="status" aria-live="polite">
          {status === 'copied' && 'Copied to clipboard.'}
          {status === 'copy_failed' && 'Couldn’t copy. Select the text and copy manually.'}
          {status === 'saved' && !dirty && 'Draft saved.'}
          {dirty && !status && 'Unsaved changes'}
        </span>
      </div>
      <p className="muted small">Saving only stores this draft in the app. It does not send anything or contact PayPal.</p>
      {error && <ErrorBox error={error} title="That didn’t work" />}
    </div>
  );
}
