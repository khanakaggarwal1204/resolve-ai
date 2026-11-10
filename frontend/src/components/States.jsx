import { API_MODE } from '../api/client.js';

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorBox({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="state state-error" role="alert">
      <h3>{title}</h3>
      <p>{error?.message || 'Unexpected error. Please try again.'}</p>
      {error?.outcomeUnknown && (
        <p className="small">
          We couldn’t confirm the payment’s current state. That does <strong>not</strong> mean it failed. Check the status before trying again.
        </p>
      )}
      {error?.requestId && <p className="muted small">Reference: {error.requestId}</p>}
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="state state-empty">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

// Always-visible boundary notice required by the plan (section 1 / section 10).
export function BoundaryBanner() {
  return (
    <div className="banner" role="note">
      <strong>Demo notice:</strong> PayPal Resolve is a prototype and is <u>not</u> PayPal’s official Resolution Center.
      Cases here are app-owned. Seeded orders are synthetic and are not live PayPal disputes. No refunds are issued.
      {API_MODE === 'mock' && <> Running on a <strong>mock API</strong>.</>}
      {API_MODE === 'hybrid' && <> Payments are live PayPal <strong>sandbox</strong> data; cases and AI are <strong>mocked</strong>.</>}
    </div>
  );
}
