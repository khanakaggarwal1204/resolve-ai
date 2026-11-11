import { API_MODE, DEMO_USERS, getDemoUser, setDemoUser } from '../api/client.js';

// Demo-only: picks which seeded user the backend should treat us as (sent as X-Demo-User). Not real sign-in.
// Hidden in mock mode, where there is no backend to authenticate against.
export default function DemoUserSwitcher() {
  if (API_MODE === 'mock') return null;
  const current = getDemoUser();
  function onChange(e) {
    const user = DEMO_USERS.find((u) => u.id === e.target.value);
    setDemoUser(user.id);
    window.location.assign(user.role === 'merchant' ? '/merchant' : '/');
  }
  return (
    <label className="small">
      <span className="visually-hidden">Demo user</span>
      <select className="demo-user" value={current} onChange={onChange} aria-label="Demo user (not real sign-in)">
        {DEMO_USERS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
      </select>
    </label>
  );
}
