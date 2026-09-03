import {
  Bell,
  CheckCircle2,
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
  type CreateSheetKind,
  type CreatedGoogleSheetResult,
  type GoogleDriveFolderCandidate,
  type ProjectSearchResult,
  type SellingCustomerFolderOption,
} from "../services/googleApi";
import {
  getStoredLinkSourceConfig,
  readCachedWorkspaceLinks,
  readCachedTemplateSpreadsheetIds,
  resolveTemplateSpreadsheetIdsFromRows,
  resolveWorkspaceLinkFromCell,
  writeCachedWorkspaceLinks,
  writeCachedTemplateSpreadsheetIds,
} from "../utils/linksSheet";

const DESIGNERS = ["Tod", "Do", "Kram", "Rung", "Han", "Steve", "Ton"] as const;
const CUSTOMER_CACHE_VERSION = 1;
const CUSTOMER_AUTO_SYNC_MS = 15_000;
const MESSAGING_NOTI_POLL_MS = 12_000;

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
};

type CustomerCachePayload = {
  version: number;
  mode: CustomerMode;
  designer: DesignerName;
  fetchedAt: string;
  records: CustomerRecord[];
};

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

function getCell(rows: WorkflowCell[][], rowIndex: number, columnIndex: number) {
  return rows[rowIndex]?.[columnIndex] ?? { text: "", formula: null, links: [] };
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

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved data";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

/** Distinct customers in the designer list with ≥1 matched unread (channel-gated by `line@`). */
function countDistinctCustomersWithUnread(
  records: CustomerRecord[],
  notifications: MessagingNotification[],
) {
  if (records.length === 0 || notifications.length === 0) {
    return 0;
  }
  let count = 0;
  for (const record of records) {
    if (
      notifications.some((item) =>
        notificationAppliesToCustomer(item.senderName, record.customerName, item.source),
      )
    ) {
      count += 1;
    }
  }
  return count;
}

function designerUnreadCount(
  mode: CustomerMode,
  designerName: DesignerName,
  notifications: MessagingNotification[],
  liveRecords: CustomerRecord[],
  liveDesigner: DesignerName,
) {
  const records =
    designerName === liveDesigner
      ? liveRecords
      : (readCache(mode, designerName)?.records ?? []);
  return countDistinctCustomersWithUnread(records, notifications);
}

function unreadSourcesForCustomer(unreadForRow: MessagingNotification[]) {
  const hasLine = unreadForRow.some((item) => item.source === "line");
  const hasFacebook = unreadForRow.some((item) => item.source === "facebook");
  return { hasLine, hasFacebook };
}

export function CustomerWorkspacePage({ mode }: { mode: CustomerMode }) {
  const { connection, refreshGoogleConnection } = useGoogleConnection();
  const [designer, setDesigner] = useState<DesignerName>("Tod");
  const [records, setRecords] = useState<CustomerRecord[]>([]);
  const [query, setQuery] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isBackgroundUpdating, setIsBackgroundUpdating] = useState(false);
  const [loadWarning, setLoadWarning] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyActionKey, setBusyActionKey] = useState("");
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
  const requestSequenceRef = useRef(0);
  const requestsInFlightRef = useRef(new Set<string>());
  const templateIdsCacheRef = useRef<{ ids: TemplateSpreadsheetIds; fetchedAt: number } | null>(null);
  const destinationCacheRef = useRef(new Map<string, GoogleDriveFolderCandidate[]>());
  const sellingFolderCacheRef = useRef(new Map<string, ProjectSearchResult[]>());
  const [designerCacheEpoch, setDesignerCacheEpoch] = useState(0);

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
      if (background) {
        setIsBackgroundUpdating(true);
      } else {
        setIsInitialLoading(true);
      }
      setLoadWarning("");

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

        const worksheetRows = await fetchWorkflowWorksheetRows(spreadsheetId, designer);
        const nextRecords = parseDesignerCustomers(worksheetRows.rows, mode);
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
        setFetchedAt(worksheetRows.fetchedAt);
      } catch (error) {
        if (requestId !== requestSequenceRef.current) {
          return;
        }
        setLoadWarning(
          (readCache(mode, designer)?.records.length ?? 0) > 0
            ? "Live update delayed. Showing saved data and retrying automatically."
            : getErrorMessage(error),
        );
      } finally {
        requestsInFlightRef.current.delete(requestKey);
        if (requestId === requestSequenceRef.current) {
          setIsInitialLoading(false);
          setIsBackgroundUpdating(false);
        }
      }
    },
    [connection.status, designer, mode, refreshGoogleConnection],
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    setQuery("");
    setActionMessage("");
    setActionError("");
    const cachedValue = readCache(mode, designer);
    if (cachedValue) {
      setRecords(cachedValue.records);
      setFetchedAt(cachedValue.fetchedAt);
      setIsInitialLoading(false);
      void loadDesignerData(true);
    } else {
      setRecords([]);
      setFetchedAt("");
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
  }, [designer, loadDesignerData, mode]);

  useEffect(() => {
    let cancelled = false;

    async function warmOtherDesignerCaches() {
      const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
      if (!spreadsheetId || connection.status !== "Connected") {
        return;
      }

      await Promise.all(
        DESIGNERS.filter((designerName) => designerName !== designer).map(async (designerName) => {
          const requestKey = `warm:${mode}:${designerName}`;
          if (requestsInFlightRef.current.has(requestKey)) {
            return;
          }
          requestsInFlightRef.current.add(requestKey);
          try {
            const worksheetRows = await fetchWorkflowWorksheetRows(spreadsheetId, designerName);
            if (cancelled) {
              return;
            }
            writeCache({
              version: CUSTOMER_CACHE_VERSION,
              mode,
              designer: designerName,
              fetchedAt: worksheetRows.fetchedAt,
              records: parseDesignerCustomers(worksheetRows.rows, mode),
            });
          } catch {
            /* keep any existing cache for unread badges */
          } finally {
            requestsInFlightRef.current.delete(requestKey);
          }
        }),
      );

      if (!cancelled) {
        setDesignerCacheEpoch((value) => value + 1);
      }
    }

    void warmOtherDesignerCaches();
    return () => {
      cancelled = true;
    };
  }, [connection.status, designer, mode]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMessagingNotifications() {
      const [facebookResult, lineResult] = await Promise.all([
        fetchFacebookNotifications(),
        fetchLineNotifications(),
      ]);
      if (!cancelled) {
        setFacebookNotifications(facebookResult.notifications);
        setLineNotifications(lineResult.notifications);
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

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return records;
    }
    return records.filter((record) =>
      `${record.projectNumber} ${record.customerName}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query, records]);

  const matchedUnreadCount = useMemo(
    () => countDistinctCustomersWithUnread(records, messagingNotifications),
    [messagingNotifications, records],
  );

  const matchedUnreadHasLine = useMemo(
    () =>
      records.some((record) =>
        messagingNotifications.some(
          (item) =>
            item.source === "line" &&
            notificationAppliesToCustomer(item.senderName, record.customerName, item.source),
        ),
      ),
    [messagingNotifications, records],
  );

  const designerUnreadCounts = useMemo(() => {
    void designerCacheEpoch;
    return Object.fromEntries(
      DESIGNERS.map((designerName) => [
        designerName,
        designerUnreadCount(mode, designerName, messagingNotifications, records, designer),
      ]),
    ) as Record<DesignerName, number>;
  }, [designer, designerCacheEpoch, messagingNotifications, mode, records]);

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

  async function openStickerLink(record: CustomerRecord) {
    const actionKey = `${record.id}:sticker`;
    setBusyActionKey(actionKey);
    setActionMessage("");
    setActionError("");

    try {
      const source = getStoredLinkSourceConfig();
      const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
      if (!spreadsheetId) {
        throw new Error("Save the Workflow Google Sheet in Settings first.");
      }

      const cachedSticker = readCachedWorkspaceLinks()?.links.find((link) => link.key === "sticker");
      let stickerUrl = cachedSticker?.url ?? "";
      try {
        if (connection.status !== "Connected") {
          const restored = await refreshGoogleConnection();
          if (restored.errorMessage || restored.connection?.status !== "Connected") {
            throw new Error(restored.errorMessage || "Connect Google in Settings first.");
          }
        }
        const rows = await fetchWorkflowWorksheetRows(spreadsheetId, source.worksheetName);
        const stickerLink = resolveWorkspaceLinkFromCell(
          "sticker",
          source.worksheetName,
          source.stickerCell,
          rows.rows,
        );
        const cachedLinks = readCachedWorkspaceLinks()?.links ?? [];
        writeCachedWorkspaceLinks(
          [...cachedLinks.filter((link) => link.key !== "sticker"), stickerLink],
          source.worksheetName,
          rows.fetchedAt,
        );
        stickerUrl = stickerLink.url;
      } catch (error) {
        if (!stickerUrl) {
          throw error;
        }
      }

      openExternalUrl(stickerUrl);
      setActionMessage(`Opened Sticker for project ${record.projectNumber}.`);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyActionKey("");
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

  function stickerButton(record: CustomerRecord) {
    const isBusy = busyActionKey === `${record.id}:sticker`;
    return (
      <button
        className={`customer-action customer-action--sticker${isBusy ? " customer-action--busy" : ""}`}
        type="button"
        onClick={() => void openStickerLink(record)}
        disabled={Boolean(busyActionKey)}
        aria-busy={isBusy}
      >
        {isBusy ? <LoaderCircle className="customer-action__spinner" size={14} /> : <ExternalLink size={14} />}
        {isBusy ? "Working…" : "Sticker"}
      </button>
    );
  }

  return (
    <div className="customer-workspace">
      <section className="designer-picker" aria-label="Designers">
        <div className="designer-picker__tabs">
          {DESIGNERS.map((designerName) => {
            const unread = designerUnreadCounts[designerName];
            return (
              <button
                key={designerName}
                className={`designer-picker__tab${designer === designerName ? " designer-picker__tab--active" : ""}${unread > 0 ? " designer-picker__tab--unread" : ""}`}
                type="button"
                onClick={() => setDesigner(designerName)}
              >
                <span className="designer-picker__name">
                  {designerName}
                  {unread > 0 ? (
                    <span className="designer-picker__bell" aria-label="New messages">
                      <Bell size={10} strokeWidth={2.6} />
                    </span>
                  ) : null}
                </span>
                {unread > 0 ? <span className="designer-picker__badge">{unread > 9 ? "9+" : unread}</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="customer-list-panel">
        <div className="customer-list-toolbar">
          <div>
            <div className="customer-list-toolbar__title-row">
              <h2>
                {designer} · {mode === "deposit" ? "Deposit & Clearing" : "Selling"}
              </h2>
              <span className="customer-count">{filteredRecords.length} customers</span>
              {matchedUnreadCount > 0 ? (
                <span
                  className={`customer-noti-pill${matchedUnreadHasLine ? " customer-noti-pill--line" : ""}`}
                  title="New LINE or Facebook messages for customers in this list"
                >
                  <Bell size={13} strokeWidth={2.2} />
                  {matchedUnreadCount} new
                </span>
              ) : null}
            </div>
          </div>
          <div className={`customer-sync${loadWarning ? " customer-sync--warning" : ""}`}>
            {isBackgroundUpdating ? (
              <LoaderCircle className="customer-action__spinner" size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            <span>
              {isBackgroundUpdating
                ? "Updating…"
                : fetchedAt
                  ? `Updated ${formatUpdatedAt(fetchedAt)}`
                  : "Waiting for data"}
            </span>
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

        {isInitialLoading && records.length === 0 ? (
          <div className="customer-empty-state">
            <LoaderCircle className="customer-action__spinner" size={28} />
            <strong>Loading {designer} customer data</strong>
            <span>The list will be saved locally after this first load.</span>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="customer-empty-state">
            <strong>{query ? "No customers match this search" : "No customer rows found"}</strong>
            <span>
              {query
                ? "Try a different project number or customer name."
                : `Check the ${designer} worksheet layout in Settings.`}
            </span>
          </div>
        ) : (
          <div className="customer-table-wrap">
            <table className={`customer-table customer-table--${mode}`}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>{mode === "selling" ? "Estimate Price" : "Amount"}</th>
                  <th>{mode === "selling" ? "Measurement" : "Deadline"}</th>
                  <th>Installation</th>
                  {mode === "deposit" ? (
                    <>
                      <th>Wood Color</th>
                      <th>Confirm</th>
                      <th>Queue</th>
                      <th>QC</th>
                      <th>Pieces</th>
                      <th>Send CNC</th>
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
                  const { hasLine, hasFacebook } = unreadSourcesForCustomer(unreadForRow);
                  const hasUnread = unreadForRow.length > 0;
                  const latestPreview = unreadForRow[0]?.preview;
                  const rowUnreadClass = hasLine
                    ? "customer-row--unread customer-row--unread-line"
                    : hasFacebook
                      ? "customer-row--unread"
                      : undefined;
                  const nameUnreadClass = hasLine
                    ? " customer-name--unread customer-name--unread-line"
                    : hasFacebook
                      ? " customer-name--unread"
                      : "";
                  return (
                  <tr key={record.id} className={rowUnreadClass}>
                    <td>
                      <span className="customer-project-number">{record.projectNumber}</span>
                    </td>
                    <td>
                      <button
                        className={`customer-name${nameUnreadClass}`}
                        type="button"
                        onClick={() => void openCustomerContact(record)}
                        title={latestPreview ? `New message: ${latestPreview}` : undefined}
                      >
                        {hasLine ? (
                          <span
                            className="customer-name__bell customer-name__bell--on customer-name__bell--line"
                            aria-label="New LINE message"
                          >
                            <Bell size={14} strokeWidth={2.5} />
                          </span>
                        ) : null}
                        {hasFacebook ? (
                          <span
                            className="customer-name__bell customer-name__bell--on"
                            aria-label="New Facebook message"
                          >
                            <Bell size={14} strokeWidth={2.5} />
                          </span>
                        ) : null}
                        {!hasUnread ? (
                          <span className="customer-name__bell" aria-hidden>
                            <Bell size={14} strokeWidth={2.5} />
                          </span>
                        ) : null}
                        <span className="customer-name__text">{record.customerName}</span>
                        <ExternalLink size={13} />
                      </button>
                    </td>
                    <td className="customer-table__amount">{statusLabel(record.amount)}</td>
                    <td>{statusLabel(record.deadline)}</td>
                    <td>{statusLabel(record.installation)}</td>
                    {mode === "deposit" ? (
                      <>
                        {[
                          record.woodColor,
                          record.confirmation,
                          record.queueNumber,
                          record.qc,
                          record.pieces,
                          record.sendCnc,
                        ].map((value, index) => (
                          <td key={`${record.id}-status-${index}`}>
                            <span
                              className={`customer-status${isPositiveStatus(value) ? " customer-status--done" : ""}`}
                            >
                              {statusLabel(value)}
                            </span>
                          </td>
                        ))}
                      </>
                    ) : null}
                    <td className="customer-table__actions">
                      <div className="customer-actions">
                        {actionButton(record, "open", "Folder", "folder")}
                        {mode === "deposit" ? (
                          <>
                            {actionButton(record, "qc", "QC", "sheet")}
                            {actionButton(record, "queue", "Queue", "folder")}
                            {actionButton(record, "presentation", "Present", "presentation")}
                            {stickerButton(record)}
                          </>
                        ) : (
                          <>
                            {actionButton(record, "quotation", "Quotation", "sheet")}
                            {actionButton(record, "presentation", "Present", "presentation")}
                          </>
                        )}
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
