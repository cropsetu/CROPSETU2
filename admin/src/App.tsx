import { Navigate, Route, Routes } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { ConfirmProvider } from './components/confirm';
import { Spinner } from './components/ui';

import LoginPage from './pages/Login';
import Dashboard from './pages/Dashboard';
import { UsersPage, UserDetailPage } from './pages/Users';
import { KycPage, KycDetailPage } from './pages/Kyc';
import { CategoriesPage, ProductsPage, ReviewsPage, LowStockPage } from './pages/Catalog';
import OrdersPage from './pages/Orders';
import ReturnsPage from './pages/Returns';
import FinancePage from './pages/Finance';
import { AnimalsPage, MachineryPage, LabourPage, BookingsPage } from './pages/Listings';
import { PostsPage, CommentsPage, GroupsPage } from './pages/Community';
import { AiUsagePage, AiCreditsPage, FeedbackPage, ReportsPage } from './pages/AiOps';
import { SchemesPage, MspPage, CropMasterPage, PestAlertsPage, MandiSyncPage } from './pages/Cms';
import BroadcastPage from './pages/Broadcast';
import { ModerationPage, FraudPage, IncidentsPage } from './pages/TrustSafety';
import { ConsentsPage, ErasurePage, AuditPage } from './pages/Compliance';
import { FlagsPage, HealthPage, QueuesPage } from './pages/Ops';
import SettingsPage from './pages/Settings';
import TeamPage from './pages/Team';

function FullScreenLoader() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
      <Sprout className="h-8 w-8 text-brand-600" />
      <Spinner />
    </div>
  );
}

export default function App() {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;

  return (
    <ConfirmProvider>
      <Routes>
        <Route path="/login" element={status === 'authed' ? <Navigate to="/" replace /> : <LoginPage />} />

        {status === 'authed' ? (
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/kyc" element={<KycPage />} />
            <Route path="/kyc/:userId" element={<KycDetailPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/low-stock" element={<LowStockPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/returns" element={<ReturnsPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/animals" element={<AnimalsPage />} />
            <Route path="/machinery" element={<MachineryPage />} />
            <Route path="/labour" element={<LabourPage />} />
            <Route path="/bookings" element={<BookingsPage />} />
            <Route path="/posts" element={<PostsPage />} />
            <Route path="/comments" element={<CommentsPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/ai/usage" element={<AiUsagePage />} />
            <Route path="/ai/credits" element={<AiCreditsPage />} />
            <Route path="/ai/feedback" element={<FeedbackPage />} />
            <Route path="/ai/reports" element={<ReportsPage />} />
            <Route path="/schemes" element={<SchemesPage />} />
            <Route path="/msp" element={<MspPage />} />
            <Route path="/crop-master" element={<CropMasterPage />} />
            <Route path="/pest-alerts" element={<PestAlertsPage />} />
            <Route path="/mandi-sync" element={<MandiSyncPage />} />
            <Route path="/broadcast" element={<BroadcastPage />} />
            <Route path="/moderation" element={<ModerationPage />} />
            <Route path="/fraud" element={<FraudPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/consents" element={<ConsentsPage />} />
            <Route path="/erasure" element={<ErasurePage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/flags" element={<FlagsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/queues" element={<QueuesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </ConfirmProvider>
  );
}
