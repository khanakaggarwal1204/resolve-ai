import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import BuyerHome from './pages/BuyerHome.jsx';
import CaseIntake from './pages/CaseIntake.jsx';
import CaseBrief from './pages/CaseBrief.jsx';
import { CheckoutCancel, CheckoutReturn } from './pages/CheckoutReturn.jsx';
import { Empty } from './components/States.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<BuyerHome />} />
        <Route path="/orders/:paymentId/report" element={<CaseIntake />} />
        <Route path="/cases/:caseId" element={<CaseBrief />} />
        <Route path="/checkout/return" element={<CheckoutReturn />} />
        <Route path="/checkout/cancel" element={<CheckoutCancel />} />
        <Route
          path="*"
          element={<Empty title="Page not found" action={<Link className="btn" to="/">Go home</Link>} />}
        />
      </Route>
    </Routes>
  );
}
