import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import React, { Suspense, lazy } from "react";

// Simplifying to check for circular dependencies and loading issues
console.log("Loading App.tsx");

// Import essential pages directly
import HomePage from "@/pages/home-page";
import LandingPage from "@/pages/landing-page";
import AuthPage from "@/pages/auth-page";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/use-auth";

// Import authentication pages
const ResetPasswordPage = lazy(() => import("@/pages/reset-password-page"));
const VerifyEmailPage = lazy(() => import("@/pages/verify-email-page"));

// Use lazy loading for other pages to improve performance
const JournalPage = lazy(() => import("@/pages/journal-page"));
const JournalEntryPage = lazy(() => import("@/pages/journal-entry-page"));
const NewJournalEntryPage = lazy(() => import("@/pages/new-journal-entry-page"));
const ChatPage = lazy(() => import("@/pages/chat-page"));
const InsightsPage = lazy(() => import("@/pages/insights-page"));
const GoalsPage = lazy(() => import("@/pages/goals-page"));
const TasksPage = lazy(() => import("@/pages/tasks-page"));
const HabitsPage = lazy(() => import("@/pages/habits-page"));
const SubscriptionPage = lazy(() => import("@/pages/subscription-page"));
const AboutUsPage = lazy(() => import("@/pages/about-us-page"));
const CommunityPage = lazy(() => import("@/pages/community-page"));
const MentalHealthResourcesPage = lazy(() => import("@/pages/mental-health-resources-page"));
const HelpCenterPage = lazy(() => import("@/pages/help-center-page"));
const PrivacyPolicyPage = lazy(() => import("@/pages/privacy-policy-page"));
const TermsOfServicePage = lazy(() => import("@/pages/terms-of-service-page"));

// Settings pages
const SettingsProfilePage = lazy(() => import("@/pages/settings-profile-page"));
const SettingsPasswordPage = lazy(() => import("@/pages/settings-password-page"));
const SettingsNotificationsPage = lazy(() => import("@/pages/settings-notifications-page"));
const SettingsPrivacyPage = lazy(() => import("@/pages/settings-privacy-page"));
const SettingsAppearancePage = lazy(() => import("@/pages/settings-appearance-page"));
const SettingsDataPage = lazy(() => import("@/pages/settings-data-page"));
const SupportPage = lazy(() => import("@/pages/support-page"));

// Admin pages
const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard-page"));
const AdminOAuthPage = lazy(() => import("@/pages/admin-oauth-page"));
const AdminOpenAIPage = lazy(() => import("@/pages/admin-openai-page"));
const AdminPayPalPage = lazy(() => import("@/pages/admin-paypal-page"));
const AdminSupportPage = lazy(() => import("@/pages/admin-support-page"));

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
    <p className="ml-2">Loading Hope Log...</p>
  </div>
);

// Simple router function for debugging
function Router() {
  console.log("Router function executing");
  
  try {
    const { user } = useAuth();
    const [location] = useLocation();
    
    console.log("User state:", user ? "Logged in" : "Not logged in");
    console.log("Current location:", location);
    
    // Complete routing with lazy-loaded components wrapped in Suspense
    return (
      <Switch>
        <Route path="/auth" component={AuthPage} />
        
        {/* Main pages */}
        {/* Protected Routes - Require Authentication */}
        <ProtectedRoute 
          path="/journal" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <JournalPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/journal/new" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <NewJournalEntryPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/journal/:id" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <JournalEntryPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/insights" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <InsightsPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/goals" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <GoalsPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/tasks" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <TasksPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/habits" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <HabitsPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/subscription" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SubscriptionPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/chat" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <ChatPage />
            </Suspense>
          )} 
        />
        
        {/* Public Routes */}
        <Route path="/about-us">
          <Suspense fallback={<LoadingFallback />}>
            <AboutUsPage />
          </Suspense>
        </Route>
        
        <Route path="/community">
          <Suspense fallback={<LoadingFallback />}>
            <CommunityPage />
          </Suspense>
        </Route>
        
        <Route path="/mental-health-resources">
          <Suspense fallback={<LoadingFallback />}>
            <MentalHealthResourcesPage />
          </Suspense>
        </Route>
        
        <Route path="/help-center">
          <Suspense fallback={<LoadingFallback />}>
            <HelpCenterPage />
          </Suspense>
        </Route>
        
        <Route path="/privacy-policy">
          <Suspense fallback={<LoadingFallback />}>
            <PrivacyPolicyPage />
          </Suspense>
        </Route>
        
        <Route path="/terms-of-service">
          <Suspense fallback={<LoadingFallback />}>
            <TermsOfServicePage />
          </Suspense>
        </Route>

        {/* Authentication Routes */}
        <Route path="/reset-password/:token">
          <Suspense fallback={<LoadingFallback />}>
            <ResetPasswordPage />
          </Suspense>
        </Route>
        
        <Route path="/verify-email/:token">
          <Suspense fallback={<LoadingFallback />}>
            <VerifyEmailPage />
          </Suspense>
        </Route>
        
        {/* Protected Settings Pages */}
        <ProtectedRoute 
          path="/settings/profile" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SettingsProfilePage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/settings/password" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SettingsPasswordPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/settings/notifications" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SettingsNotificationsPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/settings/privacy" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SettingsPrivacyPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/settings/appearance" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SettingsAppearancePage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/settings/data" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SettingsDataPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/support" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <SupportPage />
            </Suspense>
          )} 
        />

        {/* Admin Routes - Only accessible to admins (access control in AdminLayout) */}
        <ProtectedRoute 
          path="/admin" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <AdminDashboardPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/admin/oauth" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <AdminOAuthPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/admin/openai" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <AdminOpenAIPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/admin/paypal" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <AdminPayPalPage />
            </Suspense>
          )} 
        />
        <ProtectedRoute 
          path="/admin/support" 
          component={() => (
            <Suspense fallback={<LoadingFallback />}>
              <AdminSupportPage />
            </Suspense>
          )} 
        />
        
        {/* Landing or Home depending on login status */}
        <Route path="/" component={user ? HomePage : LandingPage} />
        
        {/* Fallback for unknown routes */}
        <Route component={NotFound} />
      </Switch>
    );
  } catch (error) {
    console.error("Error in Router:", error);
    return <LoadingFallback />;
  }
}

function App() {
  console.log("Starting application rendering...");
  
  // Get the root element to check if it exists
  const rootElement = document.getElementById("root");
  if (rootElement) {
    console.log("Root element found, rendering application");
    // Add a small delay to log when rendering is actually completed
    setTimeout(() => {
      console.log("Application rendered successfully");
    }, 0);
  }
  
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={<LoadingFallback />}>
            <Router />
          </Suspense>
          <div id="app-loaded" style={{ display: 'none' }}></div>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
