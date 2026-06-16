import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from './lib/auth';
import { useKendraStatus } from './lib/useKendra';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import PendingPage from './pages/Pending';
import InboxPage from './pages/Inbox';
import ReportDetailPage from './pages/ReportDetail';

function Splash() {
  return (
    <div className="flex min-h-full items-center justify-center text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function LoadError() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500">
      <AlertTriangle className="h-6 w-6 text-amber-500" />
      <p className="text-sm">Could not load your Kendra status. Please refresh the page.</p>
    </div>
  );
}

/** Routes available once authenticated — gated by the Kendra onboarding stage. */
function AuthedRoutes() {
  const { data, isLoading, isError } = useKendraStatus();
  if (isLoading) return <Splash />;
  if (isError || !data) return <LoadError />;

  const { stage } = data;
  // Where the home route lands for each onboarding stage.
  const home =
    stage === 'APPROVED' ? null
    : (stage === 'UNREGISTERED' || stage === 'REJECTED') ? '/register'
    : '/pending';

  return (
    <Routes>
      <Route
        path="/"
        element={stage === 'APPROVED' ? <InboxPage /> : <Navigate to={home!} replace />}
      />
      <Route
        path="/register"
        element={stage === 'APPROVED' ? <Navigate to="/" replace /> : <RegisterPage status={data} />}
      />
      <Route
        path="/pending"
        element={stage === 'PENDING' ? <PendingPage status={data} /> : <Navigate to={stage === 'APPROVED' ? '/' : '/register'} replace />}
      />
      <Route
        path="/reports/:shareId"
        element={stage === 'APPROVED' ? <ReportDetailPage /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status !== 'authed') {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return <AuthedRoutes />;
}
