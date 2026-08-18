import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  restoreGoogleConnection,
} from "../services/googleAuth";
import type {
  GoogleConnectionDiagnostics,
  GoogleConnectionRestoreResponse,
  GoogleConnectionState,
} from "../types/googleConnection";

type GoogleConnectionContextValue = {
  connection: GoogleConnectionState;
  diagnostics: GoogleConnectionDiagnostics;
  errorMessage: string;
  isBusy: boolean;
  connectGoogle: () => Promise<GoogleConnectionState | null>;
  disconnectGoogle: () => Promise<void>;
  refreshGoogleConnection: () => Promise<GoogleConnectionRestoreResponse>;
};

const defaultConnection: GoogleConnectionState = {
  status: "Not Connected",
  email: null,
  lastConnectedAt: null,
};

const defaultDiagnostics: GoogleConnectionDiagnostics = {
  refreshTokenFound: false,
  accessTokenRefreshed: false,
};

const GoogleConnectionContext = createContext<GoogleConnectionContextValue | null>(null);

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Google connection failed.";
}

export function GoogleConnectionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<GoogleConnectionState>(defaultConnection);
  const [diagnostics, setDiagnostics] = useState<GoogleConnectionDiagnostics>(defaultDiagnostics);
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(true);
  const hasRestoredOnStartupRef = useRef(false);

  const refreshGoogleConnection = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage("");

    try {
      const result = await restoreGoogleConnection();
      setConnection(result.connection ?? defaultConnection);
      setDiagnostics(result.diagnostics);
      setErrorMessage(result.errorMessage ?? "");
      return result;
    } catch (error) {
      console.error(error);
      setConnection(defaultConnection);
      setDiagnostics(defaultDiagnostics);
      const fallbackErrorMessage = getErrorMessage(error);
      setErrorMessage(fallbackErrorMessage);
      return {
        connection: null,
        diagnostics: defaultDiagnostics,
        errorMessage: fallbackErrorMessage,
      };
    } finally {
      setIsBusy(false);
    }
  }, []);

  const connectGoogle = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage("");

    try {
      // Redirects the browser to Google; page unloads on success.
      await connectGoogleAccount();
      return null;
    } catch (error) {
      console.error(error);
      setErrorMessage(getErrorMessage(error));
      setIsBusy(false);
      return null;
    }
  }, []);

  const disconnectGoogle = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage("");

    try {
      await disconnectGoogleAccount();
      setConnection(defaultConnection);
      setDiagnostics(defaultDiagnostics);
      setErrorMessage("");
    } catch (error) {
      console.error(error);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    if (hasRestoredOnStartupRef.current) {
      return;
    }

    hasRestoredOnStartupRef.current = true;
    void refreshGoogleConnection();
  }, [refreshGoogleConnection]);

  const value = useMemo(
    () => ({
      connection,
      diagnostics,
      errorMessage,
      isBusy,
      connectGoogle,
      disconnectGoogle,
      refreshGoogleConnection,
    }),
    [
      connection,
      diagnostics,
      errorMessage,
      isBusy,
      connectGoogle,
      disconnectGoogle,
      refreshGoogleConnection,
    ],
  );

  return (
    <GoogleConnectionContext.Provider value={value}>{children}</GoogleConnectionContext.Provider>
  );
}

export function useGoogleConnection() {
  const context = useContext(GoogleConnectionContext);

  if (!context) {
    throw new Error("useGoogleConnection must be used within GoogleConnectionProvider.");
  }

  return context;
}
