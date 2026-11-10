// Enums agreed in section 7 of the build plan (Integration contracts).
// Keep these in sync with the backend validators.

export const ISSUE_TYPES = [
  { value: 'not_received', label: 'Item not received', hint: 'The order has not arrived.' },
  { value: 'duplicate_charge', label: 'Duplicate-charge concern', hint: 'I think I was charged more than once.' },
  { value: 'incorrect_amount', label: 'Incorrect amount', hint: 'The amount charged looks wrong.' },
  { value: 'cancelled_order', label: 'Cancelled order', hint: 'I cancelled but was still charged.' },
  { value: 'other', label: 'Other', hint: 'Something else went wrong.' },
];

export const ISSUE_LABELS = Object.fromEntries(ISSUE_TYPES.map((i) => [i.value, i.label]));

export const CASE_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  awaiting_information: { label: 'Awaiting information', tone: 'warn' },
  resolved: { label: 'Resolved', tone: 'good' },
  closed: { label: 'Closed', tone: 'neutral' },
};

export const SOURCE_MODES = {
  paypal_sandbox_verified: { label: 'PayPal sandbox verified', tone: 'verified', icon: '✓' },
  app_owned: { label: 'App-owned', tone: 'app', icon: '◆' },
  synthetic_demo: { label: 'Synthetic demo data', tone: 'synthetic', icon: '⚠' },
  user_provided_unverified: { label: 'User-provided · unverified', tone: 'unverified', icon: '?' },
};

export const EVIDENCE_TYPES = [
  { value: 'order_confirmation', label: 'Order confirmation / receipt' },
  { value: 'tracking_info', label: 'Tracking information' },
  { value: 'merchant_message', label: 'Message with merchant' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'other', label: 'Other' },
];

export const MAX_NARRATIVE = 1000;
