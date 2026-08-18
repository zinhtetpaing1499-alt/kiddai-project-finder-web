import { CheckCircle2, Cloud, FolderSearch, Sheet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_WORKFLOW_GOOGLE_SHEET_URL,
  KIDDAI2_FOLDER_ID_KEY,
  WORKFLOW_GOOGLE_SHEET_ID_KEY,
  WORKFLOW_GOOGLE_SHEET_URL_KEY,
} from "../constants/storage";
import { useGoogleConnection } from "../contexts/GoogleConnectionContext";
import {
  fetchSpreadsheetMetadata,
  listSellingDesignerRoutes,
  listSharedDrives,
  type SellingDesignerRoute,
  type SharedDriveInfo,
} from "../services/googleApi";

function saveWorkflowSheetUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl.startsWith("https://docs.google.com/spreadsheets/")) {
    return { ok: false as const, error: "Enter a valid Google Sheets URL." };
  }

  const spreadsheetIdMatch = trimmedUrl.match(/\/d\/([^/]+)\//);
  if (!spreadsheetIdMatch?.[1]) {
    return { ok: false as const, error: "Google Sheets URL must include /d/{id}/" };
  }

  window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_URL_KEY, trimmedUrl);
  window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_ID_KEY, spreadsheetIdMatch[1]);
  return { ok: true as const, spreadsheetId: spreadsheetIdMatch[1] };
}

export function SettingsPage() {
  const { connection, errorMessage, isBusy, connectGoogle, disconnectGoogle } = useGoogleConnection();
  const [workflowGoogleSheetUrl, setWorkflowGoogleSheetUrl] = useState("");
  const [sharedDrives, setSharedDrives] = useState<SharedDriveInfo[]>([]);
  const [sellingRoutes, setSellingRoutes] = useState<SellingDesignerRoute[]>([]);
  const [kiddai2Name, setKiddai2Name] = useState("");
  const [sheetTitle, setSheetTitle] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const sheetSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const savedWorkflowSheetUrl = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_URL_KEY);
    const savedWorkflowSheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY);

    if (
      savedWorkflowSheetUrl &&
      savedWorkflowSheetUrl.startsWith("https://docs.google.com/spreadsheets/d/")
    ) {
      setWorkflowGoogleSheetUrl(savedWorkflowSheetUrl);
    } else if (savedWorkflowSheetId) {
      const normalizedUrl = `https://docs.google.com/spreadsheets/d/${savedWorkflowSheetId}/edit`;
      window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_URL_KEY, normalizedUrl);
      setWorkflowGoogleSheetUrl(normalizedUrl);
    } else {
      setWorkflowGoogleSheetUrl(DEFAULT_WORKFLOW_GOOGLE_SHEET_URL);
    }
  }, []);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => setStatusMessage(""), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  useEffect(() => {
    if (connection.status !== "Connected") {
      setSharedDrives([]);
      setSellingRoutes([]);
      setKiddai2Name("");
      setSheetTitle("");
      return;
    }

    let cancelled = false;

    async function autoSync() {
      setIsSyncing(true);
      setErrorText("");

      try {
        const drivesResult = await listSharedDrives(true).catch(() => [] as SharedDriveInfo[]);
        if (cancelled) {
          return;
        }
        setSharedDrives(drivesResult);

        let sellingError = "";
        try {
          const selling = await listSellingDesignerRoutes(null);
          if (cancelled) {
            return;
          }
          window.localStorage.setItem(KIDDAI2_FOLDER_ID_KEY, selling.kiddai2.folderId);
          setSellingRoutes(selling.routes);
          setKiddai2Name(selling.kiddai2.folderName);

          const readyCount = selling.routes.filter((route) => route.stillActiveFolderId).length;
          setStatusMessage(
            `${drivesResult.length} drives · ${selling.kiddai2.folderName} ${readyCount}/${selling.routes.length}`,
          );

          if (readyCount === 0) {
            sellingError =
              selling.routes.find((route) => route.errorMessage)?.errorMessage ||
              "Still Active not found.";
          }
        } catch (error) {
          setSellingRoutes([]);
          setKiddai2Name("");
          sellingError =
            error instanceof Error
              ? error.message
              : "Could not find Kiddai2 Shared Drive for this Google account.";
          setStatusMessage(`${drivesResult.length} drives · Kiddai2 missing`);
        }

        const rangedCount = drivesResult.filter((drive) => drive.rangeStart != null).length;
        if (rangedCount === 0 && !sellingError.includes("Kiddai2")) {
          setErrorText(
            "This Google account has no Deposit Shared Drives. Ask an admin to add you as a member of the มัดจำแล้ว Shared Drives and Kiddai2 (Google Drive → Shared drives → Manage members).",
          );
        } else if (sellingError) {
          setErrorText(sellingError);
        } else {
          setErrorText("");
        }

        const spreadsheetId =
          window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
        if (spreadsheetId) {
          const metadata = await fetchSpreadsheetMetadata(spreadsheetId);
          if (!cancelled) {
            setSheetTitle(metadata.title);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : "Unable to sync workspace.");
        }
      } finally {
        if (!cancelled) {
          setIsSyncing(false);
        }
      }
    }

    void autoSync();

    return () => {
      cancelled = true;
    };
  }, [connection.status]);

  useEffect(() => {
    if (sheetSaveTimerRef.current) {
      window.clearTimeout(sheetSaveTimerRef.current);
    }

    sheetSaveTimerRef.current = window.setTimeout(() => {
      if (!workflowGoogleSheetUrl.trim()) {
        return;
      }
      const result = saveWorkflowSheetUrl(workflowGoogleSheetUrl);
      if (!result.ok) {
        return;
      }
      setErrorText("");
      if (connection.status === "Connected") {
        void fetchSpreadsheetMetadata(result.spreadsheetId)
          .then((metadata) => setSheetTitle(metadata.title))
          .catch(() => undefined);
      }
    }, 700);

    return () => {
      if (sheetSaveTimerRef.current) {
        window.clearTimeout(sheetSaveTimerRef.current);
      }
    };
  }, [connection.status, workflowGoogleSheetUrl]);

  const readyDesigners = sellingRoutes.filter((route) => route.stillActiveFolderId).length;
  const rangedDrives = sharedDrives.filter((drive) => drive.rangeStart != null);

  return (
    <div className="page settings-page">
      <section className="settings-grid settings-grid--compact">
        <section className="settings-section settings-section--compact">
          <div className="settings-section__header">
            <div className="settings-section__icon">
              <Cloud size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="panel__label">Google</p>
              <h3 className="panel__title settings-title">
                {connection.status === "Connected"
                  ? connection.email ?? "Connected"
                  : "Not connected"}
              </h3>
            </div>
          </div>

          <div className="settings-section__actions">
            {connection.status === "Connected" ? (
              <button
                className="search-form__button search-form__button--secondary"
                type="button"
                onClick={() => void disconnectGoogle()}
                disabled={isBusy}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="search-form__button settings-button settings-button--primary"
                type="button"
                onClick={() => void connectGoogle()}
                disabled={isBusy}
              >
                {isBusy ? "Working..." : "Connect"}
              </button>
            )}
          </div>
        </section>

        <section className="settings-section settings-section--compact">
          <div className="settings-section__header">
            <div className="settings-section__icon">
              <FolderSearch size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="panel__label">Deposit</p>
              <h3 className="panel__title settings-title">
                {isSyncing
                  ? "Syncing…"
                  : rangedDrives.length > 0
                    ? `${rangedDrives.length} Shared Drives`
                    : "Shared Drives"}
              </h3>
            </div>
          </div>

          {rangedDrives.length > 0 ? (
            <section className="settings-connection">
              <dl className="settings-connection__details">
                {rangedDrives.slice(0, 8).map((drive) => (
                  <div className="settings-connection__row" key={drive.id}>
                    <dt className="search-result__term">
                      {drive.rangeStart}–{drive.rangeEnd}
                    </dt>
                    <dd className="search-result__value">{drive.name}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : (
            <p className="settings-muted">
              {connection.status === "Connected"
                ? isSyncing
                  ? "Loading…"
                  : "No Shared Drives for this account — add them as a member in Google Drive"
                : "Connect Google"}
            </p>
          )}
        </section>

        <section className="settings-section settings-section--compact">
          <div className="settings-section__header">
            <div className="settings-section__icon">
              <FolderSearch size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="panel__label">Selling</p>
              <h3 className="panel__title settings-title">
                {kiddai2Name
                  ? `${kiddai2Name} · ${readyDesigners}/${sellingRoutes.length || 7}`
                  : isSyncing
                    ? "Syncing…"
                    : "Kiddai2"}
              </h3>
            </div>
          </div>

          {sellingRoutes.length > 0 ? (
            <section className="settings-connection">
              <dl className="settings-connection__details">
                {sellingRoutes.map((route) => (
                  <div className="settings-connection__row" key={route.designer}>
                    <dt className="search-result__term">{route.designer}</dt>
                    <dd className="search-result__value">
                      {route.stillActiveFolderId ? `Still Active · ${route.customerCount}` : "Missing"}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : (
            <p className="settings-muted">
              {connection.status === "Connected"
                ? isSyncing
                  ? "Loading…"
                  : "Kiddai2 not found — add this Google account to Shared drive “Kiddai2”"
                : "Connect Google"}
            </p>
          )}
        </section>

        <section className="settings-section settings-section--compact settings-section--full">
          <div className="settings-section__header">
            <div className="settings-section__icon">
              <Sheet size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="panel__label">Workflow Sheet</p>
              <h3 className="panel__title settings-title">{sheetTitle || "Google Sheet"}</h3>
            </div>
          </div>

          <div className="settings-field">
            <input
              className="search-form__input"
              type="url"
              value={workflowGoogleSheetUrl}
              onChange={(event) => setWorkflowGoogleSheetUrl(event.currentTarget.value)}
              placeholder="https://docs.google.com/spreadsheets/..."
              aria-label="Workflow Google Sheet URL"
            />
          </div>
        </section>
      </section>

      {errorMessage || errorText ? <p className="panel__text">{errorMessage || errorText}</p> : null}
      {statusMessage ? (
        <div className="settings-success" role="status" aria-live="polite">
          <CheckCircle2 size={14} strokeWidth={2.2} />
          <span>{statusMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
