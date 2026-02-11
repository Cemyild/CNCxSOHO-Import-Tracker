import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useEffect } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import DashboardPage from "@/pages/dashboard";
import ProceduresPage from "@/pages/procedures";
import ExpensesPage from "@/pages/expenses";
import ExpenseEntryPage from "@/pages/expense-entry";
import ExpenseDetailsPage from "@/pages/expense-details";
import ProcedureDetailsPage from "@/pages/procedure-details";
import AddProcedurePage from "@/pages/add-procedure";
import EditProcedurePage from "@/pages/edit-procedure";
import PaymentsPage from "@/pages/payments";
import IncomingPaymentsPage from "@/pages/incoming-payments";
import ReportsPage from "@/pages/reports";
import CustomReportPage from "@/pages/customreport";
import AnalyticsPage from "@/pages/analytics";
import TaxReportPage from "@/pages/taxreport";
import SettingsPage from "@/pages/settings";
import UserPage from "@/pages/user";
import LoginPage from "@/pages/login";
import TaxCalculationPage from "@/pages/tax-calculation";
import TaxCalculationNewPage from "@/pages/tax-calculation-new";
import TaxCalculationEditPage from "@/pages/tax-calculation-edit";
import TaxCalculationResultsPage from "@/pages/tax-calculation-results";

function Router() {
  return (
    <Switch>
      <Route path="/">
        {() => <Redirect to="/dashboard" />}
      </Route>
      <Route path="/login" component={LoginPage} />
      <Route path="/dashboard">
        {() => (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/procedures">
        {() => (
          <ProtectedRoute>
            <ProceduresPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/expenses">
        {() => (
          <ProtectedRoute>
            <ExpensesPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/expense-entry">
        {() => (
          <ProtectedRoute>
            <ExpenseEntryPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/expense-details">
        {() => (
          <ProtectedRoute>
            <ExpenseDetailsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/procedure-details">
        {() => (
          <ProtectedRoute>
            <ProcedureDetailsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/add-procedure">
        {() => (
          <ProtectedRoute>
            <AddProcedurePage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/edit-procedure">
        {() => (
          <ProtectedRoute>
            <EditProcedurePage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/payments">
        {() => (
          <ProtectedRoute>
            <PaymentsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/incoming-payments">
        {() => (
          <ProtectedRoute>
            <IncomingPaymentsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/reports">
        {() => (
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/customreport">
        {() => (
          <ProtectedRoute>
            <CustomReportPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/analytics">
        {() => (
          <ProtectedRoute>
            <AnalyticsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/taxreport">
        {() => (
          <ProtectedRoute>
            <TaxReportPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/settings">
        {() => (
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/tax-calculation">
        {() => (
          <ProtectedRoute>
            <TaxCalculationPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/tax-calculation/new">
        {() => (
          <ProtectedRoute>
            <TaxCalculationNewPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/tax-calculation/:id/edit">
        {() => (
          <ProtectedRoute>
            <TaxCalculationEditPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/tax-calculation/:id">
        {() => (
          <ProtectedRoute>
            <TaxCalculationResultsPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/user">
        {() => (
          <ProtectedRoute>
            <UserPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/home">
        {() => (
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.title = "CNC - Soho Import Tracker";
    
    // Set up an interval to keep the title correct
    const titleInterval = setInterval(() => {
      if (document.title !== "CNC - Soho Import Tracker") {
        document.title = "CNC - Soho Import Tracker";
      }
    }, 100);
    
    return () => clearInterval(titleInterval);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
