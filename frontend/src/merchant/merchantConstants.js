// Merchant-portal constants. Enums that the whole app shares live in ../constants.js (build plan section 7).

export const PRIORITY = {
  high: { label: 'High priority', tone: 'warn' },
  normal: { label: 'Normal', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
};

// Same values as the backend's duplicateService reason codes.
export const DUPLICATE_REASON_LABELS = {
  same_payment_reference: 'Same payment',
  same_issue_type: 'Same buyer, same issue type',
  similar_narrative: 'Similar wording',
};

// Audit event_type -> plain-language label.
export const AUDIT_LABELS = {
  case_created: 'Case created',
  analysis_generated: 'AI brief generated',
  draft_generated: 'AI draft generated',
  buyer_draft_saved: 'Buyer saved a draft message',
  evidence_added: 'Evidence added',
  merchant_draft_saved: 'Merchant saved a response draft',
  merchant_reviewed: 'Merchant marked the case under review',
  merchant_requested_information: 'Merchant requested more information',
  case_resolved: 'Case marked resolved (app record only)',
  case_closed: 'Case closed (app record only)',
  action_approved: 'Action approved',
};

export const STATUS_FILTERS = [
  { value: '', label: 'All open and closed' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'awaiting_information', label: 'Awaiting information' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export const MAX_MERCHANT_DRAFT = 4000;
