import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { ErrorBox } from './States.jsx';

// Only ever send the buyer to PayPal itself, even if something upstream returned a strange URL.
function isPayPalUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

const newKey = () => `checkout-${crypto.randomUUID()}`;

/**
 * "Pay with PayPal": asks the backend to create an order, then redirects to PayPal's approval page.
 * One Idempotency-Key per amount/currency, so a double-click or a retry reuses the same order.
 */
export default function PayWithPayPal({ amount, currency = 'USD', description }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyRef = useRef({ signature: '', key: '' });

  async function pay() {
    const signature = `${amount}|${currency}|${description ?? ''}`;
    if (keyRef.current.signature !== signature) keyRef.current = { signature, key: newKey() };

    setBusy(true);
    setError(null);
    try {
      const { approvalUrl } = await api.createOrder({ amount, currency, description, idempotencyKey: keyRef.current.key });
      if (!isPayPalUrl(approvalUrl)) throw new Error('Received an unexpected payment link, so we did not open it.');
      window.location.assign(approvalUrl);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={pay} disabled={busy}>
        {busy ? 'Contacting PayPal…' : 'Pay with PayPal'}
      </button>
      {error && <ErrorBox error={error} title="Couldn’t start the payment" />}
    </>
  );
}
