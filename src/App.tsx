import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  DEFAULT_LINKS_PRESENT_CELL,
  DEFAULT_LINKS_QC_CELL,
  DEFAULT_LINKS_QUOTATION_CELL,
  DEFAULT_LINKS_WORKSHEET_NAME,
  DEFAULT_WORKFLOW_GOOGLE_SHEET_ID,
  DEFAULT_WORKFLOW_GOOGLE_SHEET_URL,
  LINKS_PRESENT_CELL_KEY,
  LINKS_QC_CELL_KEY,
  LINKS_QUOTATION_CELL_KEY,
  LINKS_WORKSHEET_NAME_KEY,
  WORKFLOW_GOOGLE_SHEET_ID_KEY,
  WORKFLOW_GOOGLE_SHEET_URL_KEY,
} from "./constants/storage";
import { GoogleConnectionProvider } from "./contexts/GoogleConnectionContext";
import { MessagingNotificationsProvider } from "./contexts/MessagingNotificationsContext";
import { AppShell } from "./layouts/AppShell";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { CustomerWorkspacePage } from "./pages/CustomerWorkspacePage";
import { SettingsPage } from "./pages/SettingsPage";

function App() {
  useEffect(() => {
    const savedWorkflowSheetUrl =
      window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_URL_KEY)?.trim() ?? "";
    const savedWorkflowSheetId =
      window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";

    if (!savedWorkflowSheetUrl) {
      window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_URL_KEY, DEFAULT_WORKFLOW_GOOGLE_SHEET_URL);
    }

    if (!savedWorkflowSheetId) {
      window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_ID_KEY, DEFAULT_WORKFLOW_GOOGLE_SHEET_ID);
    }

    if (!window.localStorage.getItem(LINKS_WORKSHEET_NAME_KEY)?.trim()) {
      window.localStorage.setItem(LINKS_WORKSHEET_NAME_KEY, DEFAULT_LINKS_WORKSHEET_NAME);
    }

    if (!window.localStorage.getItem(LINKS_QC_CELL_KEY)?.trim()) {
      window.localStorage.setItem(LINKS_QC_CELL_KEY, DEFAULT_LINKS_QC_CELL);
    }

    if (!window.localStorage.getItem(LINKS_QUOTATION_CELL_KEY)?.trim()) {
      window.localStorage.setItem(LINKS_QUOTATION_CELL_KEY, DEFAULT_LINKS_QUOTATION_CELL);
    }

    if (!window.localStorage.getItem(LINKS_PRESENT_CELL_KEY)?.trim()) {
      window.localStorage.setItem(LINKS_PRESENT_CELL_KEY, DEFAULT_LINKS_PRESENT_CELL);
    }
  }, []);

  return (
    <GoogleConnectionProvider>
      <MessagingNotificationsProvider>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/deposit-customers" replace />} />
            <Route path="/deposit-customers" element={<CustomerWorkspacePage mode="deposit" />} />
            <Route path="/selling-customers" element={<CustomerWorkspacePage mode="selling" />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/deposit-customers" replace />} />
          </Route>
        </Routes>
      </MessagingNotificationsProvider>
    </GoogleConnectionProvider>
  );
}

export default App;
