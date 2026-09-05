import {
  Bell,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Presentation,
  Search,
  Sheet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KIDDAI2_FOLDER_ID_KEY,
  SHARED_DRIVE_FOLDER_ID_KEY,
  WORKFLOW_GOOGLE_SHEET_ID_KEY,
} from "../constants/storage";
import { useGoogleConnection } from "../contexts/GoogleConnectionContext";
import type { WorkflowCell } from "../types/workflow";
import {
  fetchFacebookNotifications,
  markFacebookNotificationsRead,
  notificationAppliesToCustomer,
  type FacebookNotification,
} from "../services/facebookNotifications";
import {
  fetchLineNotifications,
  markLineNotificationsRead,
  type LineNotification,
} from "../services/lineNotifications";
import {
  createProjectSheet,
  createQueueNumberFolders,
  ensureQcSheet,
  fetchSpreadsheetMetadata,
  fetchWorkflowWorksheetRows,
  findQcDestinationFolders,
  findSellingCustomerFolders,
  importCsvIntoGoogleSheet,
  isRevisionStyleProjectFolder,
  listQcSheetsInFolder,
  openDriveFolder,
  openExternalUrl,
  pickCsvFile,
  resolveKiddai2Root,
  searchProjectFolders,
  spreadsheetEditUrl,
  SELLING_DESIGNER_FOLDER_NAMES,
  updateWorkflowWorksheetCell,
  type CreateSheetKind,
  type CreatedGoogleSheetResult,
  type GoogleDriveFolderCandidate,
  type ProjectSearchResult,
  type SellingCustomerFolderOption,
} from "../services/googleApi";
import {
  getStoredLinkSourceConfig,
  readCachedTemplateSpreadsheetIds,
  resolveTemplateSpreadsheetIdsFromRows,
  writeCachedTemplateSpreadsheetIds,
} from "../utils/linksSheet";
import {
  customerReminderKey,
  hasCustomerCheckReminder,
  toggleCustomerCheckReminder,
} from "../utils/customerCheckReminders";
import {
  classifyDepositInstallStatus,
  matchDepositStageOwner,
  parseDepositStageFinished,
  readDepositStageCncTeamOptions,
  readDepositStageProjectValues,
  resolveDepositStageEditTarget,
  resolveDepositStageWorksheetName,
} from "../utils/depositStage";

const DESIGNERS = ["Tod", "Do", "Kram", "Rung", "Han", "Steve", "Ton"] as const;
const CUSTOMER_CACHE_VERSION = 1;
const FINISHED_CACHE_VERSION = 3;
const CUSTOMER_AUTO_SYNC_MS = 3_000;
// Messenger and LINE already push incoming messages to our webhooks. This poll
// only reads the stored unread state, so once per minute keeps bells current
// without running paid Netlify Functions thousands of times per browser/day.
const MESSAGING_NOTI_POLL_MS = 60_000;

/** Shared shape for FB + LINE unread matching / bell UI. */
type MessagingNotification = {
  id: string;
  channelKey: string;
  senderName: string;
  preview: string;
  receivedAt: string;
  source: "facebook" | "line";
};

type CustomerMode = "deposit" | "selling";
type DesignerName = (typeof DESIGNERS)[number];
type CustomerAction = "open" | "queue" | CreateSheetKind;

type CustomerRecord = {
  id: string;
  worksheetRow: number;
  projectNumber: string;
  customerName: string;
  customerUrl: string;
  amount: string;
  deadline: string;
  installation: string;
  woodColor: string;
  confirmation: string;
  queueNumber: string;
  qc: string;
  pieces: string;
  sendCnc: string;
  cncTeam: string;
  owner: string;
  finishedAt: string;
};

type EditableDepositField =
  | "woodColor"
  | "confirmation"
  | "queueNumber"
  | "qc"
  | "pieces"
  | "sendCnc"
  | "cncTeam";

const EDITABLE_DEPOSIT_FIELDS: EditableDepositField[] = [
  "woodColor",
  "confirmation",
  "queueNumber",
  "qc",
  "pieces",
  "sendCnc",
  "cncTeam",
];

type CustomerCachePayload = {
  version: number;
  mode: CustomerMode;
  designer: DesignerName;
  fetchedAt: string;
  records: CustomerRecord[];
};

type FinishedCachePayload = {
  version: number;
  fetchedAt: string;
  worksheetName: string;
  records: CustomerRecord[];
};

type DepositStageSnapshot = {
  worksheetName: string;
  rows: WorkflowCell[][];
  loadedAt: number;
};

type DepositListView = "active" | "waiting" | "installing" | "finished";

function isDepositStageView(view: DepositListView) {
  return view === "waiting" || view === "installing" || view === "finished";
}

type TemplateSpreadsheetIds = Record<CreateSheetKind, string>;

type PendingLocalFolderChoice = {
  record: CustomerRecord;
  action: CustomerAction;
  folders: ProjectSearchResult[];
};

type PendingDriveFolderChoice = {
  record: CustomerRecord;
  folder: ProjectSearchResult;
  action: "queue" | CreateSheetKind;
  csvText: string | null;
  queueInput: string;
  candidates: GoogleDriveFolderCandidate[];
};

type PendingQueueFolders = {
  record: CustomerRecord;
  folder: ProjectSearchResult;
};

type PendingCreateConfirmation = {
  record: CustomerRecord;
  folder: ProjectSearchResult;
  sheetKind: Exclude<CreateSheetKind, "qc">;
};

type PendingQcAction = {
  record: CustomerRecord;
  folder: ProjectSearchResult;
  step: "menu" | "open-pick-sheet" | "import-pick-sheet";
  destination?: { folderId: string; folderName: string };
  sheets?: CreatedGoogleSheetResult[];
};

type PendingFolderOpen = {
  record: CustomerRecord;
  folder: ProjectSearchResult;
};

type QcResultNotice = {
  projectNumber: string;
  folderName: string;
  sheetName: string;
  status: "opened" | "created" | "imported";
};

type SheetCreateResultNotice = {
  projectNumber: string;
  sheetKind: "quotation" | "presentation";
  sheetName: string;
  sheetUrl: string;
  folderId: string;
  folderName: string;
};

type QueueFolderResultNotice = {
  projectNumber: string;
  folderId: string;
  folderName: string;
  createdFolders: string[];
  existingFolders: string[];
};

const customerMemoryCache = new Map<string, CustomerCachePayload>();

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "The requested action could not be completed.";
}

function cacheKey(mode: CustomerMode, designer: DesignerName) {
  return `kiddai.customerWorkspace.${CUSTOMER_CACHE_VERSION}.${mode}.${designer}`;
}

function readCache(mode: CustomerMode, designer: DesignerName) {
  const key = cacheKey(mode, designer);
  const memoryValue = customerMemoryCache.get(key);
  if (memoryValue) {
    return memoryValue;
  }

  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as CustomerCachePayload;
    if (
      parsedValue.version !== CUSTOMER_CACHE_VERSION ||
      parsedValue.mode !== mode ||
      parsedValue.designer !== designer ||
      !Array.isArray(parsedValue.records)
    ) {
      return null;
    }
    customerMemoryCache.set(key, parsedValue);
    return parsedValue;
  } catch {
    return null;
  }
}

function writeCache(payload: CustomerCachePayload) {
  const key = cacheKey(payload.mode, payload.designer);
  customerMemoryCache.set(key, payload);
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.error("Unable to save the customer-list cache.", error);
  }
}

function finishedCacheKey() {
  return `kiddai.depositStageFinished.${FINISHED_CACHE_VERSION}`;
}

function readFinishedCache(): FinishedCachePayload | null {
  try {
    const rawValue = window.localStorage.getItem(finishedCacheKey());
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as FinishedCachePayload;
    if (parsed.version !== FINISHED_CACHE_VERSION || !Array.isArray(parsed.records)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeFinishedCache(payload: FinishedCachePayload) {
  try {
    window.localStorage.setItem(finishedCacheKey(), JSON.stringify(payload));
  } catch (error) {
    console.error("Unable to save the finished-customer cache.", error);
  }
}

function getCell(rows: WorkflowCell[][], rowIndex: number, columnIndex: number) {
  return rows[rowIndex]?.[columnIndex] ?? { text: "", formula: null, links: [], fill: null, dropdownOptions: [] };
}

function getCellText(rows: WorkflowCell[][], rowIndex: number, columnIndex: number) {
  return getCell(rows, rowIndex, columnIndex).text.trim();
}

function getCellUrl(rows: WorkflowCell[][], rowIndex: number, columnIndex: number) {
  return getCell(rows, rowIndex, columnIndex).links[0]?.url?.trim() ?? "";
}

function isProjectNumber(value: string) {
  return /^\d+(?:\.\d+)*$/u.test(value.trim());
}

function parseDesignerCustomers(rows: WorkflowCell[][], mode: CustomerMode) {
  const records: CustomerRecord[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const projectColumn = mode === "selling" ? 0 : 6;
    const customerColumn = mode === "selling" ? 1 : 7;
    const projectNumber = getCellText(rows, rowIndex, projectColumn);
    const customerName = getCellText(rows, rowIndex, customerColumn);

    if (!isProjectNumber(projectNumber) || !customerName) {
      continue;
    }

    records.push({
      id: `${mode}-${rowIndex + 1}-${projectNumber}`,
      worksheetRow: rowIndex + 1,
      projectNumber,
      customerName,
      customerUrl: getCellUrl(rows, rowIndex, customerColumn),
      amount: getCellText(rows, rowIndex, mode === "selling" ? 2 : 8),
      deadline: getCellText(rows, rowIndex, mode === "selling" ? 3 : 9),
      installation: getCellText(rows, rowIndex, mode === "selling" ? 4 : 10),
      woodColor: mode === "deposit" ? getCellText(rows, rowIndex, 11) : "",
      confirmation: mode === "deposit" ? getCellText(rows, rowIndex, 12) : "",
      queueNumber: mode === "deposit" ? getCellText(rows, rowIndex, 13) : "",
      qc: mode === "deposit" ? getCellText(rows, rowIndex, 14) : "",
      pieces: mode === "deposit" ? getCellText(rows, rowIndex, 15) : "",
      sendCnc: mode === "deposit" ? getCellText(rows, rowIndex, 16) : "",
      cncTeam: "",
      owner: "",
      finishedAt: "",
    });
  }

  return records;
}

function statusLabel(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue || "—";
}

function isPositiveStatus(value: string) {
  return ["yes", "done", "complete", "completed", "ready"].includes(value.trim().toLowerCase());
}

function dateInputValue(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u);
  if (!match) {
    return "";
  }
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function sheetDateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (isoMatch) {
    return `${Number(isoMatch[3])}.${Number(isoMatch[2])}.${isoMatch[1]}`;
  }
  const displayMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u);
  if (displayMatch) {
    return `${Number(displayMatch[1])}.${Number(displayMatch[2])}.${displayMatch[3]}`;
  }
  return trimmed;
}

function getCustomerName(folderName: string, projectNumber: string, fallback: string) {
  const escapedProjectNumber = projectNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleanedName = folderName
    .replace(new RegExp(`^${escapedProjectNumber}(?:[.\\s_-]+)?`, "i"), "")
    .trim();
  return cleanedName || fallback;
}

function mergeMessagingNotifications(
  facebook: FacebookNotification[],
  line: LineNotification[],
): MessagingNotification[] {
  const merged: MessagingNotification[] = [
    ...facebook.map((item) => ({
      id: `fb:${item.id}`,
      channelKey: item.psid,
      senderName: item.senderName,
      preview: item.preview,
      receivedAt: item.receivedAt,
      source: "facebook" as const,
    })),
    ...line.map((item) => ({
      id: `line:${item.id}`,
      channelKey: item.userId,
      senderName: item.senderName,
      preview: item.preview,
      receivedAt: item.receivedAt,
      source: "line" as const,
    })),
  ];
  merged.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return merged;
}

function notificationsForCustomer(notifications: MessagingNotification[], customerName: string) {
  return notifications.filter((item) =>
    notificationAppliesToCustomer(item.senderName, customerName, item.source),
  );
}

function hasAlertForDesigner(
  mode: CustomerMode,
  designerName: DesignerName,
  notifications: MessagingNotification[],
  liveRecords: CustomerRecord[],
  liveDesigner: DesignerName,
) {
  const designerRecords =
    designerName === liveDesigner
      ? liveRecords
      : (readCache(mode, designerName)?.records ?? []);

  return designerRecords.some((record) => {
    const hasUnread = notifications.some((item) =>
      notificationAppliesToCustomer(item.senderName, record.customerName, item.source),
    );
    const hasReminder = hasCustomerCheckReminder(
      customerReminderKey(mode, designerName, record.projectNumber, record.customerName),
    );
    return hasUnread || hasReminder;
  });
}

function countDistinctCustomersWithAlert(
  mode: CustomerMode,
  designerName: DesignerName,
  records: CustomerRecord[],
  notifications: MessagingNotification[],
) {
  let count = 0;
  for (const record of records) {
    const hasUnread = notifications.some((item) =>
      notificationAppliesToCustomer(item.senderName, record.customerName, item.source),
    );
    const hasRemind = hasCustomerCheckReminder(
      customerReminderKey(mode, designerName, record.projectNumber, record.customerName),
    );
    if (hasUnread || hasRemind) {
      count += 1;
    }
  }
  return count;
}

function formatNotiCount(count: number) {
  return count > 9 ? "9+" : String(count);
}

function tabNotiBadge(count: number) {
  if (count <= 0) {
    return null;
  }
  return (
    <span className="customer-view-switch__notis">
      <span className="customer-view-switch__noti">{formatNotiCount(count)}</span>
    </span>
  );
}

export function CustomerWorkspacePage({ mode }: { mode: CustomerMode }) {
  const { connection, refreshGoogleConnection } = useGoogleConnection();
  const [designer, setDesigner] = useState<DesignerName>("Tod");
  const [depositView, setDepositView] = useState<DepositListView>("active");
  const [records, setRecords] = useState<CustomerRecord[]>([]);
  const [finishedAll, setFinishedAll] = useState<CustomerRecord[]>([]);
  const [query, setQuery] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [loadWarning, setLoadWarning] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyActionKey, setBusyActionKey] = useState("");
  const [reminderRevision, setReminderRevision] = useState(0);
  const [facebookNotifications, setFacebookNotifications] = useState<FacebookNotification[]>([]);
  const [lineNotifications, setLineNotifications] = useState<LineNotification[]>([]);
  const [pendingLocalFolderChoice, setPendingLocalFolderChoice] =
    useState<PendingLocalFolderChoice | null>(null);
  const [pendingDriveFolderChoice, setPendingDriveFolderChoice] =
    useState<PendingDriveFolderChoice | null>(null);
  const [pendingQueueFolders, setPendingQueueFolders] = useState<PendingQueueFolders | null>(null);
  const [pendingCreateConfirmation, setPendingCreateConfirmation] =
    useState<PendingCreateConfirmation | null>(null);
  const [pendingQcAction, setPendingQcAction] = useState<PendingQcAction | null>(null);
  const [pendingFolderOpen, setPendingFolderOpen] = useState<PendingFolderOpen | null>(null);
  const [qcResultNotice, setQcResultNotice] = useState<QcResultNotice | null>(null);
  const [sheetCreateResult, setSheetCreateResult] = useState<SheetCreateResultNotice | null>(null);
  const [queueFolderResult, setQueueFolderResult] = useState<QueueFolderResultNotice | null>(null);
  const [queueInput, setQueueInput] = useState("");
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [cncTeamOptions, setCncTeamOptions] = useState<string[]>([]);
  const requestSequenceRef = useRef(0);
  const requestsInFlightRef = useRef(new Set<string>());
  const designerRefreshFailuresRef = useRef(0);
  const finishedRefreshFailuresRef = useRef(0);
  const templateIdsCacheRef = useRef<{ ids: TemplateSpreadsheetIds; fetchedAt: number } | null>(null);
  const destinationCacheRef = useRef(new Map<string, GoogleDriveFolderCandidate[]>());
  const sellingFolderCacheRef = useRef(new Map<string, ProjectSearchResult[]>());
  const depositStageSnapshotRef = useRef<DepositStageSnapshot | null>(null);
  const depositStageLoadRef = useRef<Promise<DepositStageSnapshot> | null>(null);
  const pendingCellValuesRef = useRef(new Map<string, string>());
  const cellWriteQueuesRef = useRef(new Map<string, Promise<void>>());
  const messagingRefreshInFlightRef = useRef(false);
  const [designerCacheEpoch, setDesignerCacheEpoch] = useState(0);

  const loadDepositStageSnapshot = useCallback(async (spreadsheetId: string, force = false) => {
    const cached = depositStageSnapshotRef.current;
    if (!force && cached && Date.now() - cached.loadedAt < 10_000) {
      return cached;
    }
    if (depositStageLoadRef.current) {
      return depositStageLoadRef.current;
    }

    const request = (async () => {
      let worksheetName = cached?.worksheetName ?? readFinishedCache()?.worksheetName?.trim() ?? "";
      if (!worksheetName) {
        const metadata = await fetchSpreadsheetMetadata(spreadsheetId);
        worksheetName = resolveDepositStageWorksheetName(metadata.worksheetNames) ?? "";
      }
      if (!worksheetName) {
        throw new Error("Could not find the Deposit Stage worksheet.");
      }
      const worksheetRows = await fetchWorkflowWorksheetRows(spreadsheetId, worksheetName);
      const snapshot = {
        worksheetName,
        rows: worksheetRows.rows,
        loadedAt: Date.now(),
      };
      depositStageSnapshotRef.current = snapshot;
      setCncTeamOptions(readDepositStageCncTeamOptions(worksheetRows.rows));
      return snapshot;
    })();

    depositStageLoadRef.current = request;
    try {
      return await request;
    } finally {
      depositStageLoadRef.current = null;
    }
  }, []);

  const loadDesignerData = useCallback(
    async (background: boolean) => {
      const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
      if (!spreadsheetId) {
        setLoadWarning("Save the Workflow Google Sheet in Settings first.");
        return;
      }

      const requestKey = `${mode}:${designer}`;
      if (requestsInFlightRef.current.has(requestKey)) {
        return;
      }
      requestsInFlightRef.current.add(requestKey);

      const requestId = ++requestSequenceRef.current;
      if (!background) {
        setIsInitialLoading(true);
        designerRefreshFailuresRef.current = 0;
        setLoadWarning("");
      }

      try {
        if (connection.status !== "Connected") {
          const restoreResponse = await refreshGoogleConnection();
          if (restoreResponse.errorMessage) {
            throw new Error(restoreResponse.errorMessage);
          }
          if (!restoreResponse.connection || restoreResponse.connection.status !== "Connected") {
            throw new Error("Connect Google in Settings before loading customer data.");
          }
        }

        const [worksheetRows, depositStageSnapshot] = await Promise.all([
          fetchWorkflowWorksheetRows(spreadsheetId, designer),
          mode === "deposit"
            ? loadDepositStageSnapshot(spreadsheetId, background)
            : Promise.resolve(null),
        ]);
        let nextRecords = parseDesignerCustomers(worksheetRows.rows, mode);
        if (depositStageSnapshot) {
          nextRecords = nextRecords.map((record) => {
            const stageValues = readDepositStageProjectValues(
              depositStageSnapshot.rows,
              record.projectNumber,
            );
            return stageValues ? { ...record, ...stageValues } : record;
          });
        }
        if (mode === "deposit") {
          nextRecords = nextRecords.map((record) => {
            let nextRecord = record;
            for (const field of EDITABLE_DEPOSIT_FIELDS) {
              const pendingValue = pendingCellValuesRef.current.get(`${record.id}:${field}`);
              if (pendingValue !== undefined) {
                nextRecord = { ...nextRecord, [field]: pendingValue };
              }
            }
            return nextRecord;
          });
        }
        const nextPayload: CustomerCachePayload = {
          version: CUSTOMER_CACHE_VERSION,
          mode,
          designer,
          fetchedAt: worksheetRows.fetchedAt,
          records: nextRecords,
        };

        if (requestId !== requestSequenceRef.current) {
          return;
        }

        writeCache(nextPayload);
        setRecords(nextRecords);
        designerRefreshFailuresRef.current = 0;
        setLoadWarning("");
      } catch (error) {
        if (requestId !== requestSequenceRef.current) {
          return;
        }
        const hasSavedData = (readCache(mode, designer)?.records.length ?? 0) > 0;
        if (background && hasSavedData) {
          designerRefreshFailuresRef.current += 1;
          if (designerRefreshFailuresRef.current >= 3) {
            setLoadWarning("Live update delayed. Showing saved data and retrying automatically.");
          }
        } else {
          designerRefreshFailuresRef.current = 0;
          setLoadWarning(getErrorMessage(error));
        }
      } finally {
        requestsInFlightRef.current.delete(requestKey);
        if (requestId === requestSequenceRef.current) {
          setIsInitialLoading(false);
        }
      }
    },
    [connection.status, designer, loadDepositStageSnapshot, mode, refreshGoogleConnection],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDesignerNotificationData() {
      const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
      if (!spreadsheetId || connection.status !== "Connected") {
        return;
      }

      await Promise.all(
        DESIGNERS.filter((designerName) => designerName !== designer).map(async (designerName) => {
          const requestKey = `notifications:${mode}:${designerName}`;
          if (requestsInFlightRef.current.has(requestKey)) {
            return;
          }
          requestsInFlightRef.current.add(requestKey);

          try {
            const worksheetRows = await fetchWorkflowWorksheetRows(spreadsheetId, designerName);
            if (!cancelled) {
              let nextRecords = parseDesignerCustomers(worksheetRows.rows, mode);
              const stageSnapshot = mode === "deposit" ? depositStageSnapshotRef.current : null;
              if (stageSnapshot) {
                nextRecords = nextRecords.map((record) => {
                  const stageValues = readDepositStageProjectValues(
                    stageSnapshot.rows,
                    record.projectNumber,
                  );
                  return stageValues ? { ...record, ...stageValues } : record;
                });
              }
              writeCache({
                version: CUSTOMER_CACHE_VERSION,
                mode,
                designer: designerName,
                fetchedAt: worksheetRows.fetchedAt,
                records: nextRecords,
              });
            }
          } catch {
            // Keep any saved list so its notification bell can still be calculated.
          } finally {
            requestsInFlightRef.current.delete(requestKey);
          }
        }),
      );

      if (!cancelled) {
        setDesignerCacheEpoch((value) => value + 1);
      }
    }

    void loadDesignerNotificationData();
    return () => {
      cancelled = true;
    };
  }, [connection.status, designer, mode]);

  const loadFinishedDepositStage = useCallback(
    async (background: boolean) => {
      const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
      if (!spreadsheetId) {
        setLoadWarning("Save the Workflow Google Sheet in Settings first.");
        return;
      }

      const requestKey = "deposit:finished:stage";
      if (requestsInFlightRef.current.has(requestKey)) {
        return;
      }
      requestsInFlightRef.current.add(requestKey);

      const requestId = ++requestSequenceRef.current;
      if (!background) {
        setIsInitialLoading(true);
        finishedRefreshFailuresRef.current = 0;
        setLoadWarning("");
      }

      try {
        if (connection.status !== "Connected") {
          const restoreResponse = await refreshGoogleConnection();
          if (restoreResponse.errorMessage) {
            throw new Error(restoreResponse.errorMessage);
          }
          if (!restoreResponse.connection || restoreResponse.connection.status !== "Connected") {
            throw new Error("Connect Google in Settings before loading customer data.");
          }
        }

        let worksheetName = readFinishedCache()?.worksheetName?.trim() ?? "";
        if (!worksheetName) {
          const metadata = await fetchSpreadsheetMetadata(spreadsheetId);
          worksheetName = resolveDepositStageWorksheetName(metadata.worksheetNames) ?? "";
        }
        if (!worksheetName) {
          throw new Error(
            "Could not find the “Deposit Stage” tab. Add that sheet or check the tab name.",
          );
        }

        let worksheetRows;
        try {
          worksheetRows = await fetchWorkflowWorksheetRows(spreadsheetId, worksheetName);
        } catch (error) {
          const metadata = await fetchSpreadsheetMetadata(spreadsheetId);
          const resolvedName = resolveDepositStageWorksheetName(metadata.worksheetNames);
          if (!resolvedName || resolvedName === worksheetName) {
            throw error;
          }
          worksheetName = resolvedName;
          worksheetRows = await fetchWorkflowWorksheetRows(spreadsheetId, worksheetName);
        }
        const nextRecords = parseDepositStageFinished(worksheetRows.rows, worksheetName);
        depositStageSnapshotRef.current = {
          worksheetName,
          rows: worksheetRows.rows,
          loadedAt: Date.now(),
        };
        setCncTeamOptions(readDepositStageCncTeamOptions(worksheetRows.rows));
        const nextPayload: FinishedCachePayload = {
          version: FINISHED_CACHE_VERSION,
          fetchedAt: worksheetRows.fetchedAt,
          worksheetName,
          records: nextRecords,
        };

        if (requestId !== requestSequenceRef.current) {
          return;
        }

        writeFinishedCache(nextPayload);
        setFinishedAll(nextRecords);
        finishedRefreshFailuresRef.current = 0;
        setLoadWarning("");
      } catch (error) {
        if (requestId !== requestSequenceRef.current) {
          return;
        }
        const hasSavedData = (readFinishedCache()?.records.length ?? 0) > 0;
        if (background && hasSavedData) {
          finishedRefreshFailuresRef.current += 1;
          if (finishedRefreshFailuresRef.current >= 3) {
            setLoadWarning(
              "Live update delayed. Showing saved finished customers and retrying automatically.",
            );
          }
        } else {
          finishedRefreshFailuresRef.current = 0;
          setLoadWarning(getErrorMessage(error));
        }
      } finally {
        requestsInFlightRef.current.delete(requestKey);
        if (requestId === requestSequenceRef.current) {
          setIsInitialLoading(false);
        }
      }
    },
    [connection.status, refreshGoogleConnection],
  );

  useEffect(() => {
    if (mode !== "deposit") {
      setDepositView("active");
    }
  }, [mode]);

  useEffect(() => {
    if (!(mode === "deposit" && isDepositStageView(depositView))) {
      return;
    }

    requestSequenceRef.current += 1;
    setQuery("");
    setActionMessage("");
    setActionError("");
    const cachedValue = readFinishedCache();
    if (cachedValue) {
      setFinishedAll(cachedValue.records);
      setIsInitialLoading(false);
      void loadFinishedDepositStage(true);
    } else {
      setFinishedAll([]);
      void loadFinishedDepositStage(false);
    }

    const timer = window.setInterval(() => {
      void loadFinishedDepositStage(true);
    }, CUSTOMER_AUTO_SYNC_MS);
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") {
        void loadFinishedDepositStage(true);
      }
    };
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      requestSequenceRef.current += 1;
    };
  }, [depositView, loadFinishedDepositStage, mode]);

  useEffect(() => {
    if (mode === "deposit" && isDepositStageView(depositView)) {
      return;
    }
    requestSequenceRef.current += 1;
    setQuery("");
    setActionMessage("");
    setActionError("");
    const cachedValue = readCache(mode, designer);
    if (cachedValue) {
      setRecords(cachedValue.records);
      setIsInitialLoading(false);
      void loadDesignerData(true);
    } else {
      setRecords([]);
      void loadDesignerData(false);
    }

    const timer = window.setInterval(() => {
      void loadDesignerData(true);
    }, CUSTOMER_AUTO_SYNC_MS);
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") {
        void loadDesignerData(true);
      }
    };
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      requestSequenceRef.current += 1;
    };
  }, [depositView, designer, loadDesignerData, mode]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMessagingNotifications() {
      if (messagingRefreshInFlightRef.current) {
        return;
      }
      messagingRefreshInFlightRef.current = true;
      try {
        const [facebookResult, lineResult] = await Promise.all([
          fetchFacebookNotifications(),
          fetchLineNotifications(),
        ]);
        if (!cancelled) {
          setFacebookNotifications(facebookResult.notifications);
          setLineNotifications(lineResult.notifications);
        }
      } finally {
        messagingRefreshInFlightRef.current = false;
      }
    }

    void refreshMessagingNotifications();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshMessagingNotifications();
      }
    }, MESSAGING_NOTI_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshMessagingNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const messagingNotifications = useMemo(
    () => mergeMessagingNotifications(facebookNotifications, lineNotifications),
    [facebookNotifications, lineNotifications],
  );

  const designerHasAlert = useMemo(() => {
    void designerCacheEpoch;
    void reminderRevision;
    return Object.fromEntries(
      DESIGNERS.map((designerName) => [
        designerName,
        hasAlertForDesigner(mode, designerName, messagingNotifications, records, designer),
      ]),
    ) as Record<DesignerName, boolean>;
  }, [designer, designerCacheEpoch, messagingNotifications, mode, records, reminderRevision]);

  const sourceRecords = useMemo(() => {
    if (mode === "deposit" && isDepositStageView(depositView)) {
      const owned = finishedAll.filter((record) => matchDepositStageOwner(record.owner, designer));
      const status = depositView === "waiting" ? "waiting" : depositView === "installing" ? "installing" : "finished";
      return owned.filter(
        (record) => classifyDepositInstallStatus(record.installation) === status,
      );
    }
    return records;
  }, [depositView, designer, finishedAll, mode, records]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return sourceRecords;
    }
    return sourceRecords.filter((record) =>
      `${record.projectNumber} ${record.customerName}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query, sourceRecords]);

  const stageAlertCounts = useMemo(() => {
    const empty = { waiting: 0, installing: 0, finished: 0 };
    if (mode !== "deposit") {
      return empty;
    }
    const owned = finishedAll.filter((record) => matchDepositStageOwner(record.owner, designer));
    const grouped = {
      waiting: [] as CustomerRecord[],
      installing: [] as CustomerRecord[],
      finished: [] as CustomerRecord[],
    };
    for (const record of owned) {
      grouped[classifyDepositInstallStatus(record.installation)].push(record);
    }
    void reminderRevision;
    return {
      waiting: countDistinctCustomersWithAlert(mode, designer, grouped.waiting, messagingNotifications),
      installing: countDistinctCustomersWithAlert(mode, designer, grouped.installing, messagingNotifications),
      finished: countDistinctCustomersWithAlert(mode, designer, grouped.finished, messagingNotifications),
    };
  }, [designer, finishedAll, messagingNotifications, mode, reminderRevision]);

  const activeListAlertCount = useMemo(() => {
    void reminderRevision;
    return countDistinctCustomersWithAlert(mode, designer, records, messagingNotifications);
  }, [designer, messagingNotifications, mode, records, reminderRevision]);

  async function resolveTemplateSpreadsheetIds() {
    const memoryValue = templateIdsCacheRef.current;
    if (memoryValue && Date.now() - memoryValue.fetchedAt < 10 * 60_000) {
      return memoryValue.ids;
    }

    const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
    if (!spreadsheetId) {
      throw new Error("Save the Workflow Google Sheet in Settings before creating files.");
    }
    const source = getStoredLinkSourceConfig();
    const savedIds = readCachedTemplateSpreadsheetIds(spreadsheetId, source);
    if (savedIds) {
      templateIdsCacheRef.current = { ids: savedIds, fetchedAt: Date.now() };
      return savedIds;
    }

    if (connection.status !== "Connected") {
      const restored = await refreshGoogleConnection();
      if (restored.errorMessage || restored.connection?.status !== "Connected") {
        throw new Error(restored.errorMessage || "Connect Google in Settings before creating files.");
      }
    }

    const rows = await fetchWorkflowWorksheetRows(spreadsheetId, source.worksheetName);
    const ids = resolveTemplateSpreadsheetIdsFromRows(source, rows.rows);
    writeCachedTemplateSpreadsheetIds(spreadsheetId, source, ids);
    templateIdsCacheRef.current = { ids, fetchedAt: Date.now() };
    return ids;
  }

  async function resolveDestinationCandidates(record: CustomerRecord, folder: ProjectSearchResult) {
    const key = `${record.projectNumber}::${folder.folderId || folder.folderPath}`;
    const cachedValue = destinationCacheRef.current.get(key);
    if (cachedValue) {
      return cachedValue;
    }

    const candidates = await findQcDestinationFolders(
      record.projectNumber,
      getCustomerName(folder.folderName, record.projectNumber, record.customerName),
      folder.folderName,
      window.localStorage.getItem(SHARED_DRIVE_FOLDER_ID_KEY),
    );
    destinationCacheRef.current.set(key, candidates);
    return candidates;
  }

  async function createProjectFile(
    record: CustomerRecord,
    folder: ProjectSearchResult,
    sheetKind: CreateSheetKind,
    destinationFolderId: string | null = null,
    csvText: string | null = null,
  ) {
    const templateIds = await resolveTemplateSpreadsheetIds();
    let selectedFolderId = destinationFolderId ?? folder.folderId ?? null;
    let selectedFolderName = folder.folderName;

    if (!selectedFolderId) {
      const candidates = await resolveDestinationCandidates(record, folder);
      selectedFolderId = candidates[0]?.folderId ?? null;
      selectedFolderName = candidates[0]?.folderName ?? folder.folderName;
    }

    if (!selectedFolderId) {
      throw new Error("No matching Google Drive destination folder was found.");
    }

    const createdSheet = await createProjectSheet({
      templateSpreadsheetId: templateIds[sheetKind],
      projectNumber: record.projectNumber,
      customerName: record.customerName,
      destinationFolderId: selectedFolderId,
      destinationFolderName: selectedFolderName,
      sheetKind,
    });

    if (sheetKind === "qc" && csvText) {
      try {
        await importCsvIntoGoogleSheet(createdSheet.fileId, csvText);
      } catch (error) {
        throw new Error(
          `${getErrorMessage(error)} The QC sheet was created and kept, but the CSV was not imported.`,
        );
      }
    }

    openExternalUrl(spreadsheetEditUrl(createdSheet.fileId, createdSheet.webUrl));

    const label = sheetKind === "qc" ? "QC" : sheetKind === "quotation" ? "Quotation" : "Presentation";
    setActionMessage(`${label} created · ${createdSheet.fileName}`);
    setPendingDriveFolderChoice(null);

    if (sheetKind === "quotation" || sheetKind === "presentation") {
      setSheetCreateResult({
        projectNumber: record.projectNumber,
        sheetKind,
        sheetName: createdSheet.fileName,
        sheetUrl: spreadsheetEditUrl(createdSheet.fileId, createdSheet.webUrl),
        folderId: selectedFolderId,
        folderName: selectedFolderName,
      });
    }
  }

  async function runCustomerAction(
    record: CustomerRecord,
    action: CustomerAction,
    folder: ProjectSearchResult,
  ) {
    if (action === "open") {
      setPendingFolderOpen({ record, folder });
      return;
    }

    if (action === "queue") {
      setPendingQueueFolders({ record, folder });
      setQueueInput(record.pieces.trim());
      return;
    }

    if (mode === "deposit" && action === "qc") {
      setPendingQcAction({ record, folder, step: "menu" });
      return;
    }

    if (
      (mode === "deposit" && action === "presentation") ||
      (mode === "selling" && (action === "quotation" || action === "presentation"))
    ) {
      setPendingCreateConfirmation({ record, folder, sheetKind: action });
      return;
    }

    await createProjectFile(record, folder, action);
  }

  async function resolveSellingCustomerFolders(record: CustomerRecord) {
    // Prefer Shared Drive named Kiddai2; ignore a wrong pasted override ID.
    let kiddai2;
    try {
      kiddai2 = await resolveKiddai2Root(null);
    } catch {
      const configuredKiddai2 = window.localStorage.getItem(KIDDAI2_FOLDER_ID_KEY)?.trim() ?? "";
      kiddai2 = await resolveKiddai2Root(configuredKiddai2 || null);
    }
    window.localStorage.setItem(KIDDAI2_FOLDER_ID_KEY, kiddai2.folderId);

    const designerFolderName = SELLING_DESIGNER_FOLDER_NAMES[designer];
    const key = `${kiddai2.folderId}::${designerFolderName}::${record.customerName.toLocaleLowerCase()}`;
    const cachedValue = sellingFolderCacheRef.current.get(key);
    if (cachedValue) {
      return cachedValue;
    }

    const matches = await findSellingCustomerFolders(
      kiddai2.folderId,
      designerFolderName,
      record.customerName,
    );
    const results = matches.map<ProjectSearchResult>((match: SellingCustomerFolderOption) => ({
      projectNumber: record.projectNumber,
      folderName: match.folderName,
      folderPath: match.folderPath,
      folderId: match.folderId,
      matchReason: match.matchReason,
    }));
    sellingFolderCacheRef.current.set(key, results);
    return results;
  }

  async function openCustomerContact(record: CustomerRecord) {
    setActionMessage("");
    setActionError("");
    if (!record.customerUrl) {
      setActionError(`No Line or Facebook link is attached to ${record.customerName} in the sheet.`);
      return;
    }

    try {
      // Clear unread only when this app opens the customer — never because Inbox/LINE Manager replied.
      const matched = notificationsForCustomer(messagingNotifications, record.customerName);
      const matchedFacebook = matched.filter((item) => item.source === "facebook");
      const matchedLine = matched.filter((item) => item.source === "line");
      const senderNames = [record.customerName, ...matched.map((item) => item.senderName)];

      if (matchedFacebook.length > 0) {
        const result = await markFacebookNotificationsRead({
          ids: matchedFacebook.map((item) => item.id.replace(/^fb:/u, "")),
          psids: matchedFacebook.map((item) => item.channelKey).filter(Boolean),
          senderNames,
        });
        setFacebookNotifications(result.notifications);
      }
      if (matchedLine.length > 0) {
        const result = await markLineNotificationsRead({
          ids: matchedLine.map((item) => item.id.replace(/^line:/u, "")),
          userIds: matchedLine.map((item) => item.channelKey).filter(Boolean),
          senderNames,
        });
        setLineNotifications(result.notifications);
      }
      openExternalUrl(record.customerUrl);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  async function beginCustomerAction(record: CustomerRecord, action: CustomerAction) {
    setActionMessage("");
    setActionError("");

    if (connection.status !== "Connected") {
      setActionError("Connect Google in Settings first.");
      return;
    }

    const actionKey = `${record.id}:${action}`;
    setBusyActionKey(actionKey);
    try {
      const results =
        mode === "selling"
          ? await resolveSellingCustomerFolders(record)
          : await searchProjectFolders(
              record.projectNumber,
              window.localStorage.getItem(SHARED_DRIVE_FOLDER_ID_KEY),
              record.customerName,
            );
      const filteredResults =
        mode === "deposit"
          ? results.filter(
              (result) =>
                !isRevisionStyleProjectFolder(result.folderName, record.projectNumber),
            )
          : results;
      const exactMatches =
        mode === "selling"
          ? filteredResults.filter(
              (result) =>
                result.folderName.trim().toLocaleLowerCase() ===
                record.customerName.trim().toLocaleLowerCase(),
            )
          : filteredResults.filter((result) => {
              const normalizedFolder = result.folderName.toLocaleLowerCase();
              const normalizedCustomer = record.customerName.trim().toLocaleLowerCase();
              const compactCustomer = normalizedCustomer.replace(/\s+/g, "");
              return (
                result.projectNumber === record.projectNumber &&
                (!normalizedCustomer ||
                  normalizedFolder.includes(normalizedCustomer) ||
                  normalizedFolder.replace(/\s+/g, "").includes(compactCustomer))
              );
            });
      const usableResults = exactMatches.length > 0 ? exactMatches : filteredResults;
      if (usableResults.length === 0) {
        throw new Error(
          mode === "selling"
            ? `Customer folder not found. Checked Kiddai2/ลูกค้ารอเขียนแบบ/${SELLING_DESIGNER_FOLDER_NAMES[designer]}/Still Active for “${record.customerName}”.`
            : `No project folder was found for ${record.projectNumber} ${record.customerName}.`,
        );
      }
      // Deposit: always use the best main folder — no multi-folder picker.
      if (mode === "deposit") {
        await runCustomerAction(record, action, usableResults[0]);
        return;
      }
      if (usableResults.length > 1) {
        setPendingLocalFolderChoice({ record, action, folders: usableResults });
        return;
      }
      await runCustomerAction(record, action, usableResults[0]);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function chooseLocalFolder(folder: ProjectSearchResult) {
    if (!pendingLocalFolderChoice) {
      return;
    }
    const { record, action } = pendingLocalFolderChoice;
    setPendingLocalFolderChoice(null);
    setBusyActionKey(`${record.id}:${action}`);
    try {
      await runCustomerAction(record, action, folder);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function chooseDriveFolder(candidate: GoogleDriveFolderCandidate) {
    if (!pendingDriveFolderChoice) {
      return;
    }
    const { record, folder, action, csvText, queueInput: selectedQueueInput } = pendingDriveFolderChoice;
    setBusyActionKey(`${record.id}:${action}`);
    try {
      if (action === "queue") {
        await executeQueueFolderCreation(record, folder, selectedQueueInput, candidate.folderId);
      } else {
        await createProjectFile(record, folder, action, candidate.folderId, csvText);
      }
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function executeQueueFolderCreation(
    record: CustomerRecord,
    folder: ProjectSearchResult,
    requestedQueueInput: string,
    destinationFolderId: string | null,
  ) {
    let selectedFolderId = destinationFolderId;
    if (!selectedFolderId) {
      const candidates = await resolveDestinationCandidates(record, folder);
      if (candidates.length > 1) {
        setPendingDriveFolderChoice({
          record,
          folder,
          action: "queue",
          csvText: null,
          queueInput: requestedQueueInput,
          candidates,
        });
        setPendingQueueFolders(null);
        return;
      }
      selectedFolderId = candidates[0]?.folderId ?? null;
    }

    if (!selectedFolderId) {
      throw new Error("No matching Google Drive destination folder was found.");
    }

    const result = await createQueueNumberFolders({
      projectNumber: record.projectNumber,
      queueInput: requestedQueueInput,
      destinationFolderId: selectedFolderId,
    });
    setQueueFolderResult({
      projectNumber: record.projectNumber,
      folderId: selectedFolderId,
      folderName: folder.folderName,
      createdFolders: result.createdFolders,
      existingFolders: result.existingFolders,
    });
    setPendingQueueFolders(null);
    setPendingDriveFolderChoice(null);
    setQueueInput("");
  }

  async function createQueueFolders() {
    if (!pendingQueueFolders || !queueInput.trim()) {
      return;
    }
    const { record, folder } = pendingQueueFolders;
    setBusyActionKey(`${record.id}:queue`);
    setActionError("");
    try {
      await executeQueueFolderCreation(record, folder, queueInput, null);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function confirmProjectFileCreation() {
    if (!pendingCreateConfirmation) {
      return;
    }
    const { record, folder, sheetKind } = pendingCreateConfirmation;
    setPendingCreateConfirmation(null);
    setBusyActionKey(`${record.id}:${sheetKind}`);
    setActionError("");
    try {
      await createProjectFile(record, folder, sheetKind, null, null);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function confirmOpenFolder() {
    if (!pendingFolderOpen) {
      return;
    }
    const { record, folder } = pendingFolderOpen;
    if (!folder.folderId) {
      setActionError("This folder does not have a Google Drive ID to open in the browser.");
      return;
    }
    setBusyActionKey(`${record.id}:open`);
    setActionError("");
    try {
      openDriveFolder(folder.folderId);
      setPendingFolderOpen(null);
      setActionMessage(
        mode === "selling"
          ? `Opened ${designer} → Still Active → ${folder.folderName} in Google Drive.`
          : `Opened · ${folder.folderName}`,
      );
    } finally {
      setBusyActionKey("");
    }
  }

  async function resolveQcDestination(folder: ProjectSearchResult, record: CustomerRecord) {
    if (folder.folderId) {
      return { folderId: folder.folderId, folderName: folder.folderName };
    }
    const candidates = await resolveDestinationCandidates(record, folder);
    const best = candidates[0];
    if (!best?.folderId) {
      throw new Error("No matching Google Drive destination folder was found.");
    }
    return { folderId: best.folderId, folderName: best.folderName };
  }

  async function openQcNow() {
    if (!pendingQcAction) {
      return;
    }
    const { record, folder } = pendingQcAction;
    setBusyActionKey(`${record.id}:qc`);
    setActionError("");
    try {
      const destination = await resolveQcDestination(folder, record);
      const sheets = await listQcSheetsInFolder(destination.folderId, record.projectNumber);

      if (sheets.length > 1) {
        setPendingQcAction({
          record,
          folder,
          step: "open-pick-sheet",
          destination,
          sheets,
        });
        return;
      }

      if (sheets.length === 1) {
        openExternalUrl(spreadsheetEditUrl(sheets[0].fileId, sheets[0].webUrl));
        setPendingQcAction(null);
        setQcResultNotice({
          projectNumber: record.projectNumber,
          folderName: destination.folderName,
          sheetName: sheets[0].fileName,
          status: "opened",
        });
        setActionMessage(`QC opened · ${sheets[0].fileName}`);
        return;
      }

      const templateIds = await resolveTemplateSpreadsheetIds();
      const { sheet } = await ensureQcSheet({
        templateSpreadsheetId: templateIds.qc,
        projectNumber: record.projectNumber,
        customerName: record.customerName,
        destinationFolderId: destination.folderId,
        destinationFolderName: destination.folderName,
        createIfMissing: true,
        forceNew: true,
      });
      openExternalUrl(spreadsheetEditUrl(sheet.fileId, sheet.webUrl));
      setPendingQcAction(null);
      setQcResultNotice({
        projectNumber: record.projectNumber,
        folderName: destination.folderName,
        sheetName: sheet.fileName,
        status: "created",
      });
      setActionMessage(`QC created · ${sheet.fileName}`);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  function openSelectedQc(sheet: CreatedGoogleSheetResult) {
    if (!pendingQcAction) {
      return;
    }
    const { record, destination, folder } = pendingQcAction;
    openExternalUrl(spreadsheetEditUrl(sheet.fileId, sheet.webUrl));
    setPendingQcAction(null);
    setQcResultNotice({
      projectNumber: record.projectNumber,
      folderName: destination?.folderName || folder.folderName,
      sheetName: sheet.fileName,
      status: "opened",
    });
    setActionMessage(`QC opened · ${sheet.fileName}`);
  }

  async function createNewQc() {
    if (!pendingQcAction) {
      return;
    }
    const { record, folder } = pendingQcAction;
    setBusyActionKey(`${record.id}:qc`);
    setActionError("");
    try {
      const templateIds = await resolveTemplateSpreadsheetIds();
      const destination = await resolveQcDestination(folder, record);
      const { sheet } = await ensureQcSheet({
        templateSpreadsheetId: templateIds.qc,
        projectNumber: record.projectNumber,
        customerName: record.customerName,
        destinationFolderId: destination.folderId,
        destinationFolderName: destination.folderName,
        createIfMissing: true,
        forceNew: true,
      });
      openExternalUrl(spreadsheetEditUrl(sheet.fileId, sheet.webUrl));
      setPendingQcAction(null);
      setQcResultNotice({
        projectNumber: record.projectNumber,
        folderName: destination.folderName,
        sheetName: sheet.fileName,
        status: "created",
      });
      setActionMessage(`New QC created · ${sheet.fileName}`);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function beginImportCsv() {
    if (!pendingQcAction) {
      return;
    }
    const { record, folder } = pendingQcAction;
    setBusyActionKey(`${record.id}:qc`);
    setActionError("");
    try {
      const destination = await resolveQcDestination(folder, record);
      const sheets = await listQcSheetsInFolder(destination.folderId, record.projectNumber);
      setPendingQcAction({
        record,
        folder,
        step: "import-pick-sheet",
        destination,
        sheets,
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  async function importCsvIntoSelectedQc(target: CreatedGoogleSheetResult | "new") {
    if (!pendingQcAction?.destination) {
      return;
    }
    const { record, folder, destination } = pendingQcAction;
    const selectedFile = await pickCsvFile();
    if (!selectedFile) {
      return;
    }

    setBusyActionKey(`${record.id}:qc`);
    setActionError("");
    try {
      const csvText = await selectedFile.text();
      let sheet: CreatedGoogleSheetResult;
      let created = false;

      if (target === "new") {
        const templateIds = await resolveTemplateSpreadsheetIds();
        const result = await ensureQcSheet({
          templateSpreadsheetId: templateIds.qc,
          projectNumber: record.projectNumber,
          customerName: record.customerName,
          destinationFolderId: destination.folderId,
          destinationFolderName: destination.folderName,
          createIfMissing: true,
          forceNew: true,
        });
        sheet = result.sheet;
        created = true;
      } else {
        sheet = target;
      }

      await importCsvIntoGoogleSheet(sheet.fileId, csvText);
      openExternalUrl(spreadsheetEditUrl(sheet.fileId, sheet.webUrl));
      setPendingQcAction(null);
      setQcResultNotice({
        projectNumber: record.projectNumber,
        folderName: destination.folderName || folder.folderName,
        sheetName: sheet.fileName,
        status: "imported",
      });
      setActionMessage(
        created
          ? `New QC · CSV imported · ${sheet.fileName}`
          : `QC complete · CSV imported · ${sheet.fileName}`,
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
    }
  }

  function depositCellKey(record: CustomerRecord, field: EditableDepositField) {
    return `${record.id}:${field}`;
  }

  function saveDepositCell(
    record: CustomerRecord,
    field: EditableDepositField,
    nextValue: string,
  ) {
    if (mode !== "deposit" || depositView !== "active") {
      return;
    }

    const normalizedValue = field === "sendCnc" ? sheetDateValue(nextValue) : nextValue.trim();
    const cellKey = depositCellKey(record, field);
    const currentValue = field === "sendCnc" ? sheetDateValue(record[field]) : record[field].trim();
    if (normalizedValue === currentValue) {
      setCellDrafts((current) => {
        const next = { ...current };
        delete next[cellKey];
        return next;
      });
      return;
    }
    if (field === "pieces" && normalizedValue && !/^\d+$/u.test(normalizedValue)) {
      setActionError("Pieces must be a whole number.");
      return;
    }

    const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
    if (!spreadsheetId) {
      setActionError("Save the Workflow Google Sheet in Settings first.");
      return;
    }

    setActionError("");
    setActionMessage("");
    requestSequenceRef.current += 1;
    const previousValue = record[field];
    const updateLocalValue = (value: string) => {
      setRecords((currentRecords) => {
        const nextRecords = currentRecords.map((item) =>
          item.id === record.id ? { ...item, [field]: value } : item,
        );
        writeCache({
          version: CUSTOMER_CACHE_VERSION,
          mode,
          designer,
          fetchedAt: new Date().toISOString(),
          records: nextRecords,
        });
        return nextRecords;
      });
    };
    pendingCellValuesRef.current.set(cellKey, normalizedValue);
    updateLocalValue(normalizedValue);

    const previousWrite = cellWriteQueuesRef.current.get(cellKey) ?? Promise.resolve();
    const writeTask = previousWrite.catch(() => undefined).then(async () => {
      try {
        if (connection.status !== "Connected") {
          const restored = await refreshGoogleConnection();
          if (restored.errorMessage || restored.connection?.status !== "Connected") {
            throw new Error(restored.errorMessage || "Connect Google in Settings first.");
          }
        }

        const depositStageSnapshot = await loadDepositStageSnapshot(spreadsheetId);
        const target = resolveDepositStageEditTarget(
          depositStageSnapshot.rows,
          record.projectNumber,
          field,
        );
        if (!target) {
          throw new Error(`Project ${record.projectNumber} was not found in Deposit Stage.`);
        }

        const savedValue = await updateWorkflowWorksheetCell(
          spreadsheetId,
          depositStageSnapshot.worksheetName,
          target.cellAddress,
          normalizedValue,
        );
        const targetCell = depositStageSnapshot.rows[target.worksheetRow - 1]?.[target.columnIndex];
        if (targetCell) {
          targetCell.text = savedValue;
        }
        if (pendingCellValuesRef.current.get(cellKey) === normalizedValue) {
          pendingCellValuesRef.current.delete(cellKey);
          updateLocalValue(savedValue);
          setCellDrafts((current) => {
            const next = { ...current };
            delete next[cellKey];
            return next;
          });
        }
      } catch (error) {
        if (pendingCellValuesRef.current.get(cellKey) === normalizedValue) {
          pendingCellValuesRef.current.delete(cellKey);
          updateLocalValue(previousValue);
          setActionError(`Could not update the sheet: ${getErrorMessage(error)}`);
        }
      }
    });
    cellWriteQueuesRef.current.set(cellKey, writeTask);
    void writeTask.finally(() => {
      if (cellWriteQueuesRef.current.get(cellKey) === writeTask) {
        cellWriteQueuesRef.current.delete(cellKey);
      }
    });
  }

  function editableYesCell(
    record: CustomerRecord,
    field: "confirmation" | "queueNumber" | "qc",
    label: string,
  ) {
    const value = record[field];
    const isYes = isPositiveStatus(value);
    return (
      <td key={field} data-label={label}>
        <button
          className={`customer-cell-toggle${isYes ? " customer-cell-toggle--yes" : ""}`}
          type="button"
          onClick={() => void saveDepositCell(record, field, isYes ? "" : "Yes")}
          aria-label={`${label}: ${statusLabel(value)}. Tap to ${isYes ? "clear" : "set Yes"}.`}
        >
          {statusLabel(value)}
        </button>
      </td>
    );
  }

  function editableTextCell(
    record: CustomerRecord,
    field: "pieces" | "sendCnc",
    label: string,
  ) {
    const cellKey = depositCellKey(record, field);
    const rawValue = cellDrafts[cellKey] ?? record[field];
    const value = field === "sendCnc" ? dateInputValue(rawValue) : rawValue;
    return (
      <td key={field} data-label={label}>
        <div className="customer-cell-input-wrap">
          <input
            className="customer-cell-input"
            type={field === "sendCnc" ? "date" : "text"}
            inputMode={field === "pieces" ? "numeric" : undefined}
            value={value}
            placeholder="—"
            aria-label={label}
            onChange={(event) => {
              const inputValue = event.currentTarget.value;
              setCellDrafts((current) => ({ ...current, [cellKey]: inputValue }));
            }}
            onBlur={(event) => void saveDepositCell(record, field, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      </td>
    );
  }

  function editableCncTeamCell(record: CustomerRecord) {
    const options = record.cncTeam && !cncTeamOptions.includes(record.cncTeam)
      ? [record.cncTeam, ...cncTeamOptions]
      : cncTeamOptions;
    return (
      <td key="cncTeam" data-label="ช่าง CNC">
        <select
          className="customer-cell-select"
          value={record.cncTeam}
          aria-label="ช่าง CNC"
          onChange={(event) => saveDepositCell(record, "cncTeam", event.currentTarget.value)}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </td>
    );
  }

  function actionButton(
    record: CustomerRecord,
    action: CustomerAction,
    label: string,
    icon: "folder" | "sheet" | "presentation",
  ) {
    const isBusy = busyActionKey === `${record.id}:${action}`;
    const Icon = icon === "folder" ? FolderOpen : icon === "presentation" ? Presentation : Sheet;
    return (
      <button
        className={`customer-action customer-action--${action}${isBusy ? " customer-action--busy" : ""}`}
        type="button"
        onClick={() => void beginCustomerAction(record, action)}
        disabled={Boolean(busyActionKey)}
        aria-busy={isBusy}
      >
        {isBusy ? <LoaderCircle className="customer-action__spinner" size={14} /> : <Icon size={14} />}
        {isBusy ? "Working…" : label}
      </button>
    );
  }

  function reminderKeyFor(record: CustomerRecord, designerName: DesignerName = designer) {
    return customerReminderKey(mode, designerName, record.projectNumber, record.customerName);
  }

  function toggleReminder(record: CustomerRecord) {
    toggleCustomerCheckReminder(reminderKeyFor(record));
    setReminderRevision((value) => value + 1);
  }

  return (
    <div className="customer-workspace">
      <section className="customer-list-panel">
        <div className="customer-workspace__chrome">
          <div className="designer-picker" aria-label="Designers">
            <div className="designer-picker__tabs">
              {DESIGNERS.map((designerName) => {
                const hasAlert = designerHasAlert[designerName];
                return (
                  <button
                    key={designerName}
                    className={`designer-picker__tab${designer === designerName ? " designer-picker__tab--active" : ""}`}
                    type="button"
                    onClick={() => setDesigner(designerName)}
                    aria-label={`${designerName}${hasAlert ? ", items to check" : ""}`}
                  >
                    {designerName}
                    {hasAlert ? (
                      <span className="designer-picker__bell" aria-hidden>
                        <Bell size={12} strokeWidth={2.5} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="customer-list-toolbar">
            <div className="customer-list-toolbar__title-row">
              {mode === "deposit" ? (
                <>
                  <h2 className="customer-list-toolbar__identity">{designer}</h2>
                  <div className="customer-view-switch customer-view-switch--solo" role="tablist" aria-label="Deposit list">
                    <button
                      className={`customer-view-switch__tab${depositView === "active" ? " customer-view-switch__tab--active" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={depositView === "active"}
                      onClick={() => setDepositView("active")}
                    >
                      Deposit & Clearing
                      {tabNotiBadge(activeListAlertCount)}
                    </button>
                  </div>
                  <span className="customer-count">{filteredRecords.length} customers</span>
                </>
              ) : (
                <>
                  <h2 className="customer-list-toolbar__identity">
                    {designer}
                    <span className="customer-list-toolbar__dot">·</span>
                    <span className="customer-list-toolbar__mode">
                      Selling
                      {tabNotiBadge(activeListAlertCount)}
                    </span>
                  </h2>
                  <span className="customer-count">{filteredRecords.length} customers</span>
                </>
              )}
            </div>
            {mode === "deposit" ? (
              <div className="customer-view-switch customer-view-switch--stage" role="tablist" aria-label="Install lists">
                <button
                  className={`customer-view-switch__tab${depositView === "waiting" ? " customer-view-switch__tab--active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={depositView === "waiting"}
                  onClick={() => setDepositView("waiting")}
                >
                  Waiting to install
                  {tabNotiBadge(stageAlertCounts.waiting)}
                </button>
                <button
                  className={`customer-view-switch__tab${depositView === "installing" ? " customer-view-switch__tab--active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={depositView === "installing"}
                  onClick={() => setDepositView("installing")}
                >
                  Installing now
                  {tabNotiBadge(stageAlertCounts.installing)}
                </button>
                <button
                  className={`customer-view-switch__tab${depositView === "finished" ? " customer-view-switch__tab--active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={depositView === "finished"}
                  onClick={() => setDepositView("finished")}
                >
                  Finished
                  {tabNotiBadge(stageAlertCounts.finished)}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="customer-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search project number or customer name…"
            aria-label="Search customers"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              Clear
            </button>
          ) : null}
        </div>

        {loadWarning ? <div className="customer-notice customer-notice--warning">{loadWarning}</div> : null}
        {actionMessage ? <div className="customer-notice customer-notice--success">{actionMessage}</div> : null}
        {actionError ? <div className="customer-notice customer-notice--error">{actionError}</div> : null}

        {isInitialLoading &&
        (isDepositStageView(depositView) ? finishedAll.length === 0 : records.length === 0) ? (
          <div className="customer-empty-state">
            <LoaderCircle className="customer-action__spinner" size={28} />
            <strong>
              {isDepositStageView(depositView)
                ? "Loading customers from Deposit Stage"
                : `Loading ${designer} customer data`}
            </strong>
            <span>The list will be saved locally after this first load.</span>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="customer-empty-state">
            <strong>
              {query
                ? "No customers match this search"
                : depositView === "waiting"
                  ? `No customers waiting to install for ${designer}`
                  : depositView === "installing"
                    ? `No customers currently installing for ${designer}`
                    : depositView === "finished"
                      ? `No finished customers for ${designer}`
                      : "No customer rows found"}
            </strong>
            <span>
              {query
                ? "Try a different project number or customer name."
                : depositView === "waiting"
                  ? "Green Deposit Stage rows whose Install date is still in the future."
                  : depositView === "installing"
                    ? "Green Deposit Stage rows from Install date through 5 days after."
                    : depositView === "finished"
                      ? "Green Deposit Stage rows whose Install date was more than 5 days ago."
                      : `Check the ${designer} worksheet layout in Settings.`}
            </span>
          </div>
        ) : (
          <div className={`customer-table-wrap customer-table-wrap--${mode}`}>
            <table
              className={`customer-table customer-table--${mode}${
                mode === "deposit"
                  ? depositView === "active"
                    ? " customer-table--deposit-active"
                    : " customer-table--deposit-stage"
                  : ""
              }`}
            >
              {mode === "deposit" ? (
                <colgroup>
                  <col className="customer-col--project" />
                  <col className="customer-col--name" />
                  <col className="customer-col--amount" />
                  <col className="customer-col--deadline" />
                  <col className="customer-col--installation" />
                  {depositView === "finished" ? <col className="customer-col--finished" /> : null}
                  <col className="customer-col--wood" />
                  <col className="customer-col--confirm" />
                  <col className="customer-col--queue" />
                  <col className="customer-col--qc" />
                  <col className="customer-col--pieces" />
                  <col className="customer-col--cnc" />
                  <col className="customer-col--cnc-team" />
                  <col className="customer-col--actions" />
                </colgroup>
              ) : null}
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>{mode === "selling" ? "Estimate Price" : "Amount"}</th>
                  <th>{mode === "selling" ? "Measurement" : "Deadline"}</th>
                  <th>Installation</th>
                  {mode === "deposit" && depositView === "finished" ? <th>Finished</th> : null}
                  {mode === "deposit" ? (
                    <>
                      <th>Wood Color</th>
                      <th>Confirm</th>
                      <th>Queue</th>
                      <th>QC</th>
                       <th>Pieces</th>
                       <th>Send CNC</th>
                       <th>ช่าง CNC</th>
                    </>
                  ) : null}
                  <th className="customer-table__actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const unreadForRow = notificationsForCustomer(
                    messagingNotifications,
                    record.customerName,
                  );
                  const hasRemind = hasCustomerCheckReminder(reminderKeyFor(record));
                  const hasUnread = unreadForRow.length > 0;
                  const hasAlert = hasUnread || hasRemind;
                  const latestPreview = unreadForRow[0]?.preview;
                  const rowClass = hasAlert ? "customer-row--unread" : undefined;
                  const nameUnreadClass = hasAlert ? " customer-name--unread" : "";
                  return (
                  <tr key={record.id} className={rowClass}>
                    <td data-label="Project">
                      <button
                        className="customer-project-number"
                        type="button"
                        onMouseDown={(event) => {
                          if (event.detail === 3) {
                            event.preventDefault();
                          }
                        }}
                        onClick={(event) => {
                          if (event.detail === 3) {
                            toggleReminder(record);
                          }
                        }}
                        title="Triple-click to show or hide the reminder"
                      >
                        {record.projectNumber}
                      </button>
                    </td>
                    <td data-label="Customer">
                      <div className="customer-name-row">
                        {hasRemind ? (
                          <button
                            className="customer-name__bell customer-name__bell--on customer-name__bell--remind"
                            type="button"
                            onClick={() => toggleReminder(record)}
                            title="Hide reminder"
                            aria-label="Hide reminder"
                          >
                            <Bell size={14} strokeWidth={2.5} />
                          </button>
                        ) : null}
                        <button
                          className={`customer-name${nameUnreadClass}`}
                          type="button"
                          onClick={() => void openCustomerContact(record)}
                          title={
                            hasRemind
                              ? "Check this customer again"
                              : latestPreview
                                ? `New message: ${latestPreview}`
                                : undefined
                          }
                        >
                          {hasUnread && !hasRemind ? (
                            <span
                              className="customer-name__bell customer-name__bell--on"
                              aria-label="New message"
                            >
                              <Bell size={14} strokeWidth={2.5} />
                            </span>
                          ) : null}
                          {!hasAlert ? (
                            <span className="customer-name__bell" aria-hidden>
                              <Bell size={14} strokeWidth={2.5} />
                            </span>
                          ) : null}
                          <span className="customer-name__text">{record.customerName}</span>
                          <ExternalLink size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="customer-table__amount" data-label={mode === "selling" ? "Estimate Price" : "Amount"}>{statusLabel(record.amount)}</td>
                    <td data-label={mode === "selling" ? "Measurement" : "Deadline"}>{statusLabel(record.deadline)}</td>
                    <td data-label="Installation">{statusLabel(record.installation)}</td>
                    {mode === "deposit" && depositView === "finished" ? (
                      <td data-label="Finished">{statusLabel(record.finishedAt)}</td>
                    ) : null}
                    {mode === "deposit" ? (
                      <>
                        {depositView === "active" ? (
                          <>
                            <td data-label="Wood Color">
                              <span
                                className={`customer-status${isPositiveStatus(record.woodColor) ? " customer-status--done" : ""}`}
                              >
                                {statusLabel(record.woodColor)}
                              </span>
                            </td>
                            {editableYesCell(record, "confirmation", "Confirm")}
                            {editableYesCell(record, "queueNumber", "Queue")}
                            {editableYesCell(record, "qc", "QC")}
                            {editableTextCell(record, "pieces", "Pieces")}
                            {editableTextCell(record, "sendCnc", "Send CNC date")}
                            {editableCncTeamCell(record)}
                          </>
                        ) : (
                          [
                            record.woodColor,
                            record.confirmation,
                            record.queueNumber,
                            record.qc,
                            record.pieces,
                            record.sendCnc,
                            record.cncTeam,
                          ].map((value, index) => (
                            <td
                              key={`${record.id}-status-${index}`}
                              data-label={["Wood Color", "Confirm", "Queue", "QC", "Pieces", "Send CNC", "ช่าง CNC"][index]}
                            >
                              <span
                                className={`customer-status${isPositiveStatus(value) ? " customer-status--done" : ""}`}
                              >
                                {statusLabel(value)}
                              </span>
                            </td>
                          ))
                        )}
                      </>
                    ) : null}
                    <td className="customer-table__actions" data-label="Actions">
                      <div className="customer-actions">
                        {actionButton(record, "open", "Folder", "folder")}
                        {mode === "deposit" && depositView === "active" ? (
                          <>
                            {actionButton(record, "qc", "QC", "sheet")}
                            {actionButton(record, "presentation", "Present", "presentation")}
                          </>
                        ) : null}
                        {mode === "selling" ? (
                          <>
                            {actionButton(record, "quotation", "Quotation", "sheet")}
                            {actionButton(record, "presentation", "Present", "presentation")}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pendingFolderOpen ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog qc-action-dialog">
            <p className="panel__label">Folder</p>
            <h3 className="panel__title">Project {pendingFolderOpen.record.projectNumber}</h3>
            <p className="qc-action-dialog__folder">{pendingFolderOpen.folder.folderName}</p>
            <div className="qc-action-dialog__actions">
              <button
                className="search-form__button"
                type="button"
                onClick={() => void confirmOpenFolder()}
                disabled={Boolean(busyActionKey)}
              >
                {busyActionKey === `${pendingFolderOpen.record.id}:open` ? "Opening…" : "Open"}
              </button>
              <button
                className="search-form__button search-form__button--secondary"
                type="button"
                onClick={() => setPendingFolderOpen(null)}
                disabled={Boolean(busyActionKey)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingLocalFolderChoice ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-selection-dialog">
            <p className="panel__label">Choose Folder</p>
            <h3 className="panel__title">
              Project {pendingLocalFolderChoice.record.projectNumber}
            </h3>
            <div className="finder-selection-dialog__list">
              {pendingLocalFolderChoice.folders.map((folder) => (
                <button
                  key={folder.folderId || folder.folderPath}
                  className="finder-selection-dialog__item finder-selection-dialog__item--clean"
                  type="button"
                  onClick={() => void chooseLocalFolder(folder)}
                >
                  <strong>{folder.folderName}</strong>
                </button>
              ))}
            </div>
            <button
              className="search-form__button search-form__button--secondary"
              type="button"
              onClick={() => setPendingLocalFolderChoice(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {pendingDriveFolderChoice ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-selection-dialog">
            <p className="panel__label">Choose Google Drive Folder</p>
            <h3 className="panel__title">
              Where should{" "}
              {pendingDriveFolderChoice.action === "queue" ? "the Queue folders" : "this file"} be
              created?
            </h3>
            <div className="finder-selection-dialog__list">
              {pendingDriveFolderChoice.candidates.map((candidate) => (
                  <button
                  key={candidate.folderId}
                  className="finder-selection-dialog__item finder-selection-dialog__item--clean"
                  type="button"
                  onClick={() => void chooseDriveFolder(candidate)}
                >
                  <strong>{candidate.folderName}</strong>
                </button>
              ))}
            </div>
            <button
              className="search-form__button search-form__button--secondary"
              type="button"
              onClick={() => setPendingDriveFolderChoice(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {pendingQueueFolders ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-compact-dialog">
            <p className="panel__label">Create Queue Folders</p>
            <h3 className="panel__title">Project {pendingQueueFolders.record.projectNumber}</h3>
            <p className="panel__text">Enter a total like 8, or exact queue numbers like 1,3,7.</p>
            <input
              className="search-form__input finder-dialog__input"
              value={queueInput}
              onChange={(event) => setQueueInput(event.currentTarget.value)}
              placeholder="8 or 1,3,7"
              autoFocus
            />
            <div className="settings-section__actions">
              <button
                className="search-form__button"
                type="button"
                onClick={() => void createQueueFolders()}
                disabled={!queueInput.trim() || Boolean(busyActionKey)}
              >
                {busyActionKey ? "Creating…" : "Create"}
              </button>
              <button
                className="search-form__button search-form__button--secondary"
                type="button"
                onClick={() => setPendingQueueFolders(null)}
                disabled={Boolean(busyActionKey)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingQcAction ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog qc-action-dialog">
            <p className="panel__label">QC</p>
            <h3 className="panel__title">Project {pendingQcAction.record.projectNumber}</h3>
            <p className="qc-action-dialog__folder">{pendingQcAction.folder.folderName}</p>

            {pendingQcAction.step === "menu" ? (
              <>
                <div className="qc-action-dialog__actions qc-action-dialog__actions--triple">
                  <button
                    className="search-form__button"
                    type="button"
                    onClick={() => void openQcNow()}
                    disabled={Boolean(busyActionKey)}
                  >
                    {busyActionKey === `${pendingQcAction.record.id}:qc` ? "Working…" : "Open QC"}
                  </button>
                  <button
                    className="search-form__button search-form__button--secondary"
                    type="button"
                    onClick={() => void createNewQc()}
                    disabled={Boolean(busyActionKey)}
                  >
                    New QC
                  </button>
                  <button
                    className="search-form__button search-form__button--secondary"
                    type="button"
                    onClick={() => void beginImportCsv()}
                    disabled={Boolean(busyActionKey)}
                  >
                    Import CSV
                  </button>
                </div>
                <button
                  className="search-form__button search-form__button--ghost"
                  type="button"
                  onClick={() => setPendingQcAction(null)}
                  disabled={Boolean(busyActionKey)}
                >
                  Cancel
                </button>
              </>
            ) : pendingQcAction.step === "open-pick-sheet" ? (
              <>
                <p className="panel__text" style={{ margin: 0 }}>
                  Choose QC to open
                </p>
                <div className="finder-selection-dialog__list">
                  {(pendingQcAction.sheets ?? []).map((sheet) => (
                    <button
                      key={sheet.fileId}
                      className="finder-selection-dialog__item finder-selection-dialog__item--clean"
                      type="button"
                      onClick={() => openSelectedQc(sheet)}
                      disabled={Boolean(busyActionKey)}
                    >
                      <strong>{sheet.fileName}</strong>
                    </button>
                  ))}
                </div>
                <button
                  className="search-form__button search-form__button--ghost"
                  type="button"
                  onClick={() =>
                    setPendingQcAction({
                      record: pendingQcAction.record,
                      folder: pendingQcAction.folder,
                      step: "menu",
                    })
                  }
                  disabled={Boolean(busyActionKey)}
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <p className="panel__text" style={{ margin: 0 }}>
                  Choose QC sheet for CSV
                </p>
                <div className="finder-selection-dialog__list">
                  {(pendingQcAction.sheets ?? []).map((sheet) => (
                    <button
                      key={sheet.fileId}
                      className="finder-selection-dialog__item finder-selection-dialog__item--clean"
                      type="button"
                      onClick={() => void importCsvIntoSelectedQc(sheet)}
                      disabled={Boolean(busyActionKey)}
                    >
                      <strong>{sheet.fileName}</strong>
                    </button>
                  ))}
                  <button
                    className="finder-selection-dialog__item finder-selection-dialog__item--clean"
                    type="button"
                    onClick={() => void importCsvIntoSelectedQc("new")}
                    disabled={Boolean(busyActionKey)}
                  >
                    <strong>New QC sheet</strong>
                  </button>
                </div>
                <button
                  className="search-form__button search-form__button--ghost"
                  type="button"
                  onClick={() =>
                    setPendingQcAction({
                      record: pendingQcAction.record,
                      folder: pendingQcAction.folder,
                      step: "menu",
                    })
                  }
                  disabled={Boolean(busyActionKey)}
                >
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {qcResultNotice ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-compact-dialog">
            <p className="panel__label">QC Ready</p>
            <h3 className="panel__title">Project {qcResultNotice.projectNumber}</h3>
            <div
              className={`queue-result ${
                qcResultNotice.status === "opened"
                  ? "queue-result--existing"
                  : "queue-result--created"
              }`}
            >
              <strong>
                {qcResultNotice.status === "opened"
                  ? "Opened existing QC"
                  : qcResultNotice.status === "imported"
                    ? "Complete · CSV imported"
                    : "Created"}
              </strong>
              <span>{qcResultNotice.sheetName}</span>
              <span>{qcResultNotice.folderName}</span>
            </div>
            <button
              className="search-form__button"
              type="button"
              onClick={() => setQcResultNotice(null)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {pendingCreateConfirmation ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-compact-dialog">
            <p className="panel__label">
              {pendingCreateConfirmation.sheetKind === "quotation" ? "Quotation" : "Presentation"}
            </p>
            <h3 className="panel__title">
              Project {pendingCreateConfirmation.record.projectNumber}
            </h3>
            <p className="qc-action-dialog__folder">
              {pendingCreateConfirmation.folder.folderName}
            </p>
            <div className="qc-action-dialog__actions">
              <button
                className="search-form__button"
                type="button"
                onClick={() => void confirmProjectFileCreation()}
                disabled={Boolean(busyActionKey)}
              >
                {busyActionKey ? "Creating…" : "Create"}
              </button>
              <button
                className="search-form__button search-form__button--secondary"
                type="button"
                onClick={() => setPendingCreateConfirmation(null)}
                disabled={Boolean(busyActionKey)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sheetCreateResult ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-compact-dialog">
            <p className="panel__label">
              {sheetCreateResult.sheetKind === "quotation" ? "Quotation Ready" : "Presentation Ready"}
            </p>
            <h3 className="panel__title">Project {sheetCreateResult.projectNumber}</h3>
            <p className="qc-action-dialog__folder">{sheetCreateResult.folderName}</p>
            <div className="queue-result queue-result--created">
              <strong>Created</strong>
              <span>{sheetCreateResult.sheetName}</span>
            </div>
            <div className="qc-action-dialog__actions qc-action-dialog__actions--triple">
              <button
                className="search-form__button"
                type="button"
                onClick={() => {
                  openDriveFolder(sheetCreateResult.folderId);
                  setActionMessage(`Opened folder · ${sheetCreateResult.folderName}`);
                }}
              >
                Open Folder
              </button>
              <button
                className="search-form__button search-form__button--secondary"
                type="button"
                onClick={() => {
                  openExternalUrl(sheetCreateResult.sheetUrl);
                  setActionMessage(`Opened sheet · ${sheetCreateResult.sheetName}`);
                }}
              >
                Open Sheet
              </button>
              <button
                className="search-form__button search-form__button--ghost"
                type="button"
                onClick={() => setSheetCreateResult(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {queueFolderResult ? (
        <div className="workflow-modal-backdrop workflow-modal-backdrop--centered">
          <div className="finder-loading-dialog finder-compact-dialog">
            <p className="panel__label">Queue Folders Ready</p>
            <h3 className="panel__title">Project {queueFolderResult.projectNumber}</h3>
            <p className="qc-action-dialog__folder">{queueFolderResult.folderName}</p>
            {queueFolderResult.createdFolders.length > 0 ? (
              <div className="queue-result queue-result--created">
                <strong>Created</strong>
                <span>{queueFolderResult.createdFolders.join(", ")}</span>
              </div>
            ) : null}
            {queueFolderResult.existingFolders.length > 0 ? (
              <div className="queue-result queue-result--existing">
                <strong>Already existed</strong>
                <span>{queueFolderResult.existingFolders.join(", ")}</span>
              </div>
            ) : null}
            <div className="qc-action-dialog__actions">
              <button
                className="search-form__button"
                type="button"
                onClick={() => {
                  openDriveFolder(queueFolderResult.folderId);
                  setActionMessage(`Opened · ${queueFolderResult.folderName}`);
                }}
              >
                Open Folder
              </button>
              <button
                className="search-form__button search-form__button--secondary"
                type="button"
                onClick={() => setQueueFolderResult(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
