import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import { SourceChip, StatusBadge } from '../components/Badges.jsx';
import { CASE_STATUS, ISSUE_LABELS, ISSUE_TYPES } from '../constants.js';
import { formatDateTime, formatMoney } from '../utils/format.js';
import { DuplicateBadge, PriorityBadge } from './MerchantBits.jsx';
import { STATUS_FILTERS } from './merchantConstants.js';
import './merchant.css';

export default function MerchantInbox() {
  const [filters, setFilters] = useState({ status: '', priority: '', issue_type: '' });
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const inbox = useAsync((signal) => api.listMerchantCases({ ...filters, q }, { signal }), [filters.status, filters.priority, filters.issue_type, q]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const filtered = Boolean(filters.status || filters.priority || filters.issue_type || q);
  const clear = () => { setFilters({ status: '', priority: '', issue_type: '' }); setSearch(''); setQ(''); };

  return (
    <>
      <h1>Case inbox</h1>
      <p className="muted">Cases buyers opened about your orders. Actions here update this app’s case record only; nothing here refunds money or opens a PayPal dispute.</p>

      <form className="card filters" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); }} role="search">
        <div className="filter-grid">
          <label>Status
            <select value={filters.status} onChange={set('status')}>
              {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={filters.priority} onChange={set('priority')}>
              <option value="">Any</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
            </select>
          </label>
          <label>Issue type
            <select value={filters.issue_type} onChange={set('issue_type')}>
              <option value="">Any</option>
              {ISSUE_TYPES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </label>
          <label>Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Case ID, order ID or item" maxLength={80} />
          </label>
        </div>
        <div className="row gap">
          <button className="btn btn-secondary">Search</button>
          {filtered && <button type="button" className="btn btn-ghost" onClick={clear}>Clear filters</button>}
        </div>
      </form>

      {inbox.loading && !inbox.data && <Loading label="Loading cases…" />}
      {inbox.error && <ErrorBox error={inbox.error} onRetry={inbox.reload} title="Couldn’t load the inbox" />}

      {inbox.data && (
        <>
          <p className="muted small" aria-live="polite">
            {inbox.data.total} case{inbox.data.total === 1 ? '' : 's'}
            {Object.entries(inbox.data.counts ?? {}).map(([s, n]) => ` · ${n} ${(CASE_STATUS[s]?.label ?? s).toLowerCase()}`).join('')}
            {inbox.loading && ' · refreshing…'}
          </p>
          {inbox.data.items.length === 0 ? (
            <Empty title={filtered ? 'No cases match these filters' : 'No cases yet'} action={filtered ? <button className="btn btn-secondary" onClick={clear}>Clear filters</button> : null}>
              {filtered ? 'Try widening the filters.' : 'When a buyer reports a problem with one of your orders, it will appear here.'}
            </Empty>
          ) : (
            <ul className="card-list">
              {inbox.data.items.map((c) => (
                <li key={c.id} className="card inbox-item">
                  <div className="row gap wrap between">
                    <h3 className="inbox-title"><Link to={`/merchant/cases/${encodeURIComponent(c.id)}`}>{ISSUE_LABELS[c.issue_type] ?? c.issue_type}</Link></h3>
                    <span className="row gap wrap"><PriorityBadge priority={c.priority} /><StatusBadge status={c.status} /></span>
                  </div>
                  <p className="inbox-order">
                    <strong>{c.payment?.merchant_label ?? 'Order'}</strong> · {c.payment ? formatMoney(c.payment.amount, c.payment.currency) : '—'}
                    {' '}<code className="source-field" title="Payment reference">{c.payment?.paypal_order_id}</code>
                  </p>
                  <div className="row gap wrap">
                    <SourceChip mode={c.source_mode} />
                    <DuplicateBadge hint={c.possible_duplicate} />
                    <span className="muted small">{c.evidence_count} evidence item{c.evidence_count === 1 ? '' : 's'}</span>
                    <span className="muted small">{c.has_recommendation ? 'AI brief ready' : 'No AI brief yet'}</span>
                  </div>
                  <p className="muted small">{c.buyer?.display_name} · {c.id} · updated {formatDateTime(c.updated_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
