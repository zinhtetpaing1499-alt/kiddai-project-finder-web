export type GoogleConnectionStatus = "Connected" | "Not Connected";

export type GoogleConnectionState = {
  status: GoogleConnectionStatus;
  email: string | null;
  lastConnectedAt: string | null;
};

export type GoogleConnectionDiagnostics = {
  refreshTokenFound: boolean;
  accessTokenRefreshed: boolean;
};

export type GoogleConnectionRestoreResponse = {
  connection: GoogleConnectionState | null;
  diagnostics: GoogleConnectionDiagnostics;
  errorMessage: string | null;
};
