import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import { formatMoney } from '../utils/format.js';

const UNKNOWN_CODES = ['TIMEOUT', 'NETWORK_ERROR'];

// PayPal sends the buyer here after approval: /checkout/return?token=<ORDER_ID>&PayerID=...
// We capture exactly once (stable Idempotency-Key per order), then show what PayPal says.
export function CheckoutReturn() {
  const [params] = useSearchParams();
  const orderId = params.get('token');
  const capture = useAsync((signal) => (orderId ? api.captureOrder(orderId, { signal }) : Promise.resolve(null)), [orderId]);

  if (!orderId) {
    return <Empty title="No order to confirm" action={<Link className="btn" to="/">Go home</Link>}>This page is opened by PayPal after you approve a payment.</Empty>;
  }
  if (capture.loading) return <Loading label="Confirming your payment with PayPal…" />;

  if (capture.error) {
    const err = capture.error;
    if (err.code === 'ORDER_NOT_APPROVED') {
      return (
        <section className="card">
          <h1>Payment not approved yet</h1>
          <p>PayPal says this order has not been approved, so nothing was charged. Go back and approve it on PayPal, then return here.</p>
          <p className="row gap"><button className="btn" onClick={capture.reload}>Check again</button><Link className="btn btn-secondary" to="/">Back to orders</Link></p>
        </section>
      );
    }
    if (err.code === 'PAYMENT_DECLINED' || err.code === 'PAYMENT_FAILED') {
      return (
        <section className="card">
          <h1>Payment was not completed</h1>
          <p>{err.message}</p>
          <p className="muted small">You were not charged. Try a different PayPal funding source.</p>
          <Link className="btn" to="/">Back to orders</Link>
        </section>
      );
    }
    if (err.outcomeUnknown || UNKNOWN_CODES.includes(err.code)) {
      return (
        <section className="card">
          <h1>We’re not sure yet</h1>
          <p>We couldn’t confirm the result with PayPal. The payment may or may not have gone through, so please don’t pay again.</p>
          <p className="muted small">Order {orderId}. Checking again is safe: it will never charge twice.</p>
          <button className="btn" onClick={capture.reload}>Check status</button>
        </section>
      );
    }
    return <ErrorBox error={err} onRetry={capture.reload} title="Couldn’t confirm your payment" />;
  }

  const { outcome, verified, captureId, payment } = capture.data;

  if (outcome === 'captured' && verified) {
    return (
      <section className="card">
        <h1>Payment received</h1>
        <p><span className="badge badge-good">Captured · verified by PayPal</span></p>
        <p className="amount">{formatMoney(payment.amount, payment.currency)}</p>
        <p className="muted small">Order {payment.paypal_order_id} · Capture {captureId}</p>
        <p className="row gap">
          <Link className="btn" to="/">Back to orders</Link>
          <Link className="btn btn-secondary" to={`/orders/${encodeURIComponent(payment.id)}/report`}>Report a problem</Link>
        </p>
      </section>
    );
  }

  if (outcome === 'pending') {
    return (
      <section className="card">
        <h1>Payment pending</h1>
        <p><span className="badge badge-warn">Pending at PayPal</span></p>
        <p>PayPal accepted the payment but hasn’t finished processing it. It is not confirmed yet.</p>
        <p className="muted small">Order {payment.paypal_order_id}{captureId ? ` · Capture ${captureId}` : ''}</p>
        <p className="row gap"><button className="btn" onClick={capture.reload}>Check again</button><Link className="btn btn-secondary" to="/">Back to orders</Link></p>
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Payment status unclear</h1>
      <p><span className="badge badge-neutral">PayPal status: {payment.verified_status}</span></p>
      <p>PayPal did not confirm a completed payment. Check again in a moment before trying anything else.</p>
      <p className="row gap"><button className="btn" onClick={capture.reload}>Check again</button><Link className="btn btn-secondary" to="/">Back to orders</Link></p>
    </section>
  );
}

export function CheckoutCancel() {
  return (
    <Empty title="Payment cancelled" action={<Link className="btn" to="/">Back to orders</Link>}>
      You left PayPal without approving, so nothing was charged.
    </Empty>
  );
}
