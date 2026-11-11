import { Link, NavLink, Outlet } from 'react-router-dom';
import DemoUserSwitcher from '../merchant/DemoUserSwitcher.jsx';
import '../merchant/merchant.css';
import { BoundaryBanner } from './States.jsx';

export default function Layout() {
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">PayPal Resolve</Link>
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end>Buyer</NavLink>
            <NavLink to="/merchant">Merchant</NavLink>
            <DemoUserSwitcher />
          </nav>
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
