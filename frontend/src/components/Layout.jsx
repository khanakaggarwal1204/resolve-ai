import { Link, Outlet } from 'react-router-dom';
import { BoundaryBanner } from './States.jsx';

export default function Layout() {
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">PayPal Resolve</Link>
          <span className="muted small">Buyer view</span>
        </div>
      </header>
      <main className="container">
        <BoundaryBanner />
        <Outlet />
      </main>
      <footer className="container muted small footer">
        Hackathon prototype · AI explains and drafts only; people decide.
      </footer>
    </>
  );
}
