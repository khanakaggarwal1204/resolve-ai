import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, HAS_LIVE_PAYMENTS } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import { SourceChip, StatusBadge } from '../components/Badges.jsx';
import PayWithPayPal from '../components/PayWithPayPal.jsx';
import { ISSUE_LABELS } from '../constants.js';
import { formatDateTime, formatMoney } from '../utils/format.js';

// Lets a buyer open a real PayPal sandbox order by ID (the backend has no "list orders" endpoint yet).
function OrderLookup() {
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function lookup(e) {
    e.preventDefault();
    const id = orderId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.getPayment(id); // server fetches the facts from PayPal
      navigate(`/orders/${encodeURIComponent(p.id)}/report`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={lookup}>
      <label htmlFor="order-id"><strong>Have a PayPal sandbox order ID?</strong></label>
      <p className="muted small">Paste the order ID from a sandbox checkout. We’ll fetch its verified details from PayPal.</p>
      <div className="row gap">
        <input id="order-id" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="e.g. 5O190127TN364715T" disabled={busy} />
        <button className="btn" disabled={busy || !orderId.trim()}>{busy ? 'Looking up…' : 'Look up'}</button>
      </div>
      {error && <ErrorBox error={error} title="Couldn’t find that order" />}
    </form>
  );
}

// Demo product so the sandbox checkout can be tried end to end. Amount is validated again by the backend.
function SandboxCheckout() {
  return (
    <div className="card order">
      <div>
        <h3>Sandbox product</h3>
        <p className="amount">{formatMoney('50.00', 'USD')}</p>
        <p className="muted small">Creates a PayPal sandbox order. Log in with a sandbox buyer account to approve it.</p>
      </div>
      <PayWithPayPal amount="50.00" currency="USD" description="Sandbox product" />
    </div>
  );
}

export default function BuyerHome() {
  const orders = useAsync((signal) => api.listPayments({ signal }), []);
  const cases = useAsync((signal) => api.listMyCases({ signal }), []);

  return (
    <>
      <section>
        <h1>Your orders</h1>
        <p className="muted">Pick an order if something went wrong. Payment details come from the server, not from this page.</p>

        {HAS_LIVE_PAYMENTS && <SandboxCheckout />}
        {HAS_LIVE_PAYMENTS && <OrderLookup />}

        {orders.loading && <Loading label="Loading your orders…" />}
        {orders.error && <ErrorBox error={orders.error} onRetry={orders.reload} title="Couldn’t load orders" />}
        {!orders.loading && !orders.error && (orders.data?.length ? (
          <ul className="card-list">
            {orders.data.map((p) => (
              <li key={p.id} className="card order">
                <div>
                  <h3>{p.merchant_label}</h3>
                  <p className="amount">{formatMoney(p.amount, p.currency)}</p>
                  <p className="muted small">
                    Order {p.paypal_order_id} · {formatDateTime(p.created_at)}
                  </p>
                  <p className="row gap">
                    <span className="badge badge-neutral">PayPal status: {p.verified_status}</span>
                    <SourceChip mode={p.source_mode} />
                  </p>
                </div>
                <Link className="btn" to={`/orders/${encodeURIComponent(p.id)}/report`}>
                  Report a problem
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No orders yet">
            Complete a sandbox checkout, or turn on DEMO_MODE, to see orders here.
          </Empty>
        ))}
      </section>

      <section>
        <h2>Your cases</h2>
        {cases.loading && <Loading label="Loading your cases…" />}
        {cases.error && <ErrorBox error={cases.error} onRetry={cases.reload} title="Couldn’t load cases" />}
        {!cases.loading && !cases.error && (cases.data?.length ? (
          <ul className="card-list">
            {cases.data.map((c) => (
              <li key={c.id} className="card order">
                <div>
                  <h3>{ISSUE_LABELS[c.issue_type] ?? c.issue_type}</h3>
                  <p className="muted small">Case {c.id} · opened {formatDateTime(c.created_at)}</p>
                  <p className="row gap">
                    <StatusBadge status={c.status} />
                    <SourceChip mode={c.source_mode} />
                  </p>
                </div>
                <Link className="btn btn-secondary" to={`/cases/${encodeURIComponent(c.id)}`}>
                  View case
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No cases yet">When you report a problem with an order, the case will show up here.</Empty>
        ))}
      </section>
    </>
  );
}
