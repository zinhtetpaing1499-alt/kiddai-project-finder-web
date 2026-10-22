import { Box, CheckCircle2, Cloud, FolderSearch, Sheet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DEFAULT_WORKFLOW_GOOGLE_SHEET_URL,
  KIDDAI2_FOLDER_ID_KEY,
  WORKFLOW_GOOGLE_SHEET_ID_KEY,
  WORKFLOW_GOOGLE_SHEET_URL_KEY,
} from "../constants/storage";
import { useGoogleConnection } from "../contexts/GoogleConnectionContext";
import { sketchupHelperIsRunning } from "../services/sketchupHelper";
import {
  fetchSpreadsheetMetadata,
  listSellingDesignerRoutes,
  listSharedDrives,
  type SellingDesignerRoute,
  type SharedDriveInfo,
} from "../services/googleApi";

const WORKFLOW_DATA_CACHE_PREFIXES = [
  "kiddai.customerWorkspace.",
  "kiddai.depositStageFinished.",
] as const;

function clearWorkflowDataCaches() {
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && WORKFLOW_DATA_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
}

function saveWorkflowSheetUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl.startsWith("https://docs.google.com/spreadsheets/")) {
    return { ok: false as const, error: "Enter a valid Google Sheets URL." };
  }

  const spreadsheetIdMatch = trimmedUrl.match(/\/d\/([^/]+)\//);
  if (!spreadsheetIdMatch?.[1]) {
    return { ok: false as const, error: "Google Sheets URL must include /d/{id}/" };
  }

  const spreadsheetId = spreadsheetIdMatch[1];
  const previousSpreadsheetId =
    window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
  if (previousSpreadsheetId && previousSpreadsheetId !== spreadsheetId) {
    clearWorkflowDataCaches();
  }
  window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_URL_KEY, trimmedUrl);
  window.localStorage.setItem(WORKFLOW_GOOGLE_SHEET_ID_KEY, spreadsheetId);
  return { ok: true as const, spreadsheetId };
}

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { connection, errorMessage, isBusy, connectGoogle, disconnectGoogle } = useGoogleConnection();
  const [callbackError, setCallbackError] = useState("");
  const [workflowGoogleSheetUrl, setWorkflowGoogleSheetUrl] = useState("");
  const [sharedDrives, setSharedDrives] = useState<SharedDriveInfo[]>([]);
  const [sellingRoutes, setSellingRoutes] = useState<SellingDesignerRoute[]>([]);
  const [kiddai2Name, setKiddai2Name] = useState("");
  const [sheetTitle, setSheetTitle] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [installCopied, setInstallCopied] = useState(false);
  const [windowsInstallCopied, setWindowsInstallCopied] = useState(false);
  const [helperStatus, setHelperStatus] = useState<"checking" | "running" | "offline">("checking");
  async function checkHelper() {
    setHelperStatus("checking");
    setHelperStatus(await sketchupHelperIsRunning() ? "running" : "offline");
  }
  const macInstallScript = `curl -fsSL "https://kiddai.netlify.app/sketchup-helper/Install-Kiddai-SketchUp-Helper.command" -o /tmp/kiddai-sketchup-install.command && bash /tmp/kiddai-sketchup-install.command`;
  const windowsInstallScript = `curl.exe -fSL -o "$env:TEMP\\k.ps1" "https://kiddai.netlify.app/sketchup-helper/Install-Kiddai-SketchUp-Helper.ps1"
if ($LASTEXITCODE -eq 0) { Unblock-File "$env:TEMP\\k.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\k.ps1" }`;
  const sheetSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const running = await sketchupHelperIsRunning();
      if (active) setHelperStatus(running ? "running" : "offline");
    };
    void check();
    const timer = window.setInterval(() => void check(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const fromCallback =
      location.state && typeof location.state === "object" && "googleError" in location.state
        ? String((location.state as { googleError?: unknown }).googleError ?? "")
        : "";
    if (fromCallback) {
      setCallbackError(fromCallback);
    }
  }, [location.state]);

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

        <section className="settings-section settings-section--compact settings-section--full">
          <div className="settings-section__header">
            <div className="settings-section__icon">
              <Box size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="panel__label">SketchUp</p>
              <h3 className="panel__title settings-title">Install helper</h3>
            </div>
          </div>
          <p className="settings-muted">
            Install once on each computer. A save updates the same Drive file, so the rest of the company sees it in Drive.
          </p>
          <p className="settings-muted" role="status" aria-live="polite">
            {helperStatus === "checking" ? "Checking helper on this computer..."
              : helperStatus === "running" ? "Helper is running on this computer."
              : "Helper is not reachable on this computer. Install it below, or use the installer again to repair startup. Allow local network access if your browser asks."}
          </p>
          <div className="settings-section__actions">
            <button className="search-form__button settings-button" type="button" disabled={helperStatus === "checking"} onClick={() => void checkHelper()}>Check helper</button>
          </div>
          <p className="settings-muted">After installation, you can close Terminal. The helper starts in the background when you sign in after a restart. Each computer needs its own installation.</p>
          <p className="settings-muted">Mac, one time</p>
          <p className="settings-muted">Python 3 is required on Mac. If it is not installed, download and install it first, then run the helper installer below.</p>
          <div className="settings-section__actions">
            <a className="search-form__button settings-button" href="https://www.python.org/downloads/macos/" target="_blank" rel="noreferrer">Download Python 3 for Mac</a>
          </div>
          <ol className="settings-steps">
            <li>Open Terminal.</li>
            <li>Copy the script.</li>
            <li>Paste it and press Return.</li>
            <li>Wait for the installed message, then close Terminal. After restarting, the helper starts automatically when you sign in.</li>
          </ol>
          <pre className="settings-install-script">{macInstallScript}</pre>
          <div className="settings-section__actions">
            <button
              className="search-form__button settings-button"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(macInstallScript).then(() => {
                  setInstallCopied(true);
                  window.setTimeout(() => setInstallCopied(false), 2000);
                });
              }}
            >
              {installCopied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="settings-muted">Windows, one time</p>
          <p className="settings-muted">Windows uses the built-in PowerShell, so Python 3 is optional for this helper.</p>
          <div className="settings-section__actions">
            <a className="search-form__button settings-button" href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Download Python 3 for Windows</a>
          </div>
          <ol className="settings-steps">
            <li>Press the Windows key, type PowerShell, and open Windows PowerShell. The prompt starts with PS.</li>
            <li>If a long line is stuck, press Ctrl+C.</li>
            <li>Paste the first line and press Enter. Wait until a new PS line appears.</li>
            <li>Paste the second line and press Enter. Wait for the installed message, then press Enter to close. After restarting, the helper starts automatically when you sign in.</li>
          </ol>
          <pre className="settings-install-script">{windowsInstallScript}</pre>
          <div className="settings-section__actions">
            <button
              className="search-form__button settings-button"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(windowsInstallScript).then(() => {
                  setWindowsInstallCopied(true);
                  window.setTimeout(() => setWindowsInstallCopied(false), 2000);
                });
              }}
            >
              {windowsInstallCopied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>

        <section className="settings-section settings-section--compact settings-section--full">
          <div className="settings-section__header">
            <div className="settings-section__icon">
              <Sheet size={16} strokeWidth={2} />
            </div>
            <div>
              <p className="panel__label">Company</p>
              <h3 className="panel__title settings-title">Company portal</h3>
            </div>
          </div>
          <p className="panel__text">
            Opens the company inbox with the Google account and Workflow Sheet already on this page.
          </p>
          <div className="settings-section__actions">
            <button
              className="search-form__button settings-button"
              type="button"
              onClick={() => navigate("/company/inbox")}
            >
              Open company portal
            </button>
          </div>
        </section>
      </section>

      {errorMessage || errorText || callbackError ? (
        <p className="panel__text">{errorMessage || errorText || callbackError}</p>
      ) : null}
      {statusMessage ? (
        <div className="settings-success" role="status" aria-live="polite">
          <CheckCircle2 size={14} strokeWidth={2.2} />
          <span>{statusMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
