import type { WorkflowCell, WorkflowWorksheetRows } from "../types/workflow";
import { getValidAccessToken } from "./googleAuth";

export type ProjectSearchResult = {
  projectNumber: string;
  folderName: string;
  folderPath: string;
  folderId?: string | null;
  matchReason?: string;
};

export type SellingCustomerFolderOption = {
  folderName: string;
  folderPath: string;
  folderId: string | null;
  matchReason: string;
};

export type GoogleDriveFolderCandidate = {
  folderId: string;
  folderName: string;
  driveId: string | null;
  matchReason: string;
};

export type CreatedGoogleSheetResult = {
  fileId: string;
  fileName: string;
  webUrl: string;
};

export type QueueFolderCreationResult = {
  createdFolders: string[];
  existingFolders: string[];
};

export type CreateSheetKind = "qc" | "quotation" | "presentation";

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  driveId?: string;
  parents?: string[];
  webViewLink?: string;
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
  error?: { message?: string };
};

type SheetGridColor = {
  red?: number;
  green?: number;
  blue?: number;
};

type SheetGridCell = {
  formattedValue?: string;
  hyperlink?: string;
  userEnteredValue?: { formulaValue?: string };
  textFormatRuns?: Array<{ format?: { link?: { uri?: string } } }>;
  effectiveFormat?: {
    backgroundColor?: SheetGridColor;
    backgroundColorStyle?: { rgbColor?: SheetGridColor };
  };
  userEnteredFormat?: {
    backgroundColor?: SheetGridColor;
    backgroundColorStyle?: { rgbColor?: SheetGridColor };
  };
  dataValidation?: {
    condition?: {
      values?: Array<{ userEnteredValue?: string }>;
    };
  };
};

type SheetGridResponse = {
  sheets?: Array<{
    properties?: { title?: string };
    data?: Array<{
      rowData?: Array<{
        values?: SheetGridCell[];
      }>;
    }>;
  }>;
  error?: { message?: string };
};

const destinationCache = new Map<string, GoogleDriveFolderCandidate[]>();

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function normalizeDriveName(value: string) {
  let normalized = "";
  let previousWasSpace = false;

  for (const character of value.trim()) {
    const mapped =
      character === "\u2010" ||
      character === "\u2011" ||
      character === "\u2012" ||
      character === "\u2013" ||
      character === "\u2014" ||
      character === "\u2212"
        ? "-"
        : character === "_"
          ? " "
          : character;

    if (/\s/u.test(mapped)) {
      if (!previousWasSpace) {
        normalized += " ";
        previousWasSpace = true;
      }
      continue;
    }

    previousWasSpace = false;
    normalized += mapped.toLocaleLowerCase();
  }

  return normalized.trim();
}

export function isProjectFolderMatch(folderName: string, projectNumber: string) {
  if (!folderName.startsWith(projectNumber)) {
    return false;
  }

  const nextChar = folderName.slice(projectNumber.length).charAt(0);
  return !nextChar || [".", " ", "-", "_"].includes(nextChar);
}

/** Revision / version subfolders like `4806.2.2` — not the customer project root. */
export function isRevisionStyleProjectFolder(folderName: string, projectNumber: string) {
  if (!folderName.startsWith(projectNumber)) {
    return false;
  }
  const rest = folderName.slice(projectNumber.length);
  return /^\.[\d.]+$/.test(rest);
}

function isTopLevelProjectFolder(folder: DriveFile, projectNumber: string, allMatches: DriveFile[]) {
  if (!folder.name || !isProjectFolderMatch(folder.name, projectNumber)) {
    return false;
  }
  if (isRevisionStyleProjectFolder(folder.name, projectNumber)) {
    return false;
  }

  const matchIds = new Set(allMatches.map((item) => item.id).filter(Boolean));
  const parentIsAlsoMatch = (folder.parents ?? []).some((parentId) => matchIds.has(parentId));
  return !parentIsAlsoMatch;
}

function rankProjectFolder(
  folderName: string,
  projectNumber: string,
  customerName = "",
) {
  const normalizedName = normalizeDriveName(folderName);
  const normalizedCustomer = normalizeDriveName(customerName);
  let score = 10;

  if (normalizedCustomer && normalizedName.includes(normalizedCustomer)) {
    score += 100;
  }
  if (isRevisionStyleProjectFolder(folderName, projectNumber)) {
    score -= 200;
  }
  // Prefer `4806.customer` over short/odd names.
  if (folderName.length > projectNumber.length + 2) {
    score += 5;
  }

  return score;
}

function selectProjectFolders(
  folders: DriveFile[],
  projectNumber: string,
  matchReason: string,
  customerName = "",
): ProjectSearchResult[] {
  const numberMatches = folders.filter(
    (folder) => folder.id && folder.name && isProjectFolderMatch(folder.name, projectNumber),
  );
  const topLevel = numberMatches.filter((folder) =>
    isTopLevelProjectFolder(folder, projectNumber, numberMatches),
  );
  const pool = topLevel.length > 0 ? topLevel : numberMatches.filter(
    (folder) => folder.name && !isRevisionStyleProjectFolder(folder.name, projectNumber),
  );

  const ranked = pool
    .map((folder) => ({
      folder,
      score: rankProjectFolder(folder.name!, projectNumber, customerName),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.folder.name ?? "").localeCompare(right.folder.name ?? ""),
    );

  if (ranked.length === 0) {
    return [];
  }

  const bestScore = ranked[0].score;
  const bestOnly = ranked.filter((item) => item.score === bestScore);
  const toResult = (folder: DriveFile): ProjectSearchResult => ({
    projectNumber,
    folderName: folder.name!,
    folderPath: folder.name!,
    folderId: folder.id ?? null,
    matchReason,
  });

  // Prefer a single main project folder whenever ranking (or customer name) is decisive.
  if (bestOnly.length === 1 || (customerName.trim() && bestScore >= 100)) {
    return [toResult(bestOnly[0].folder)];
  }

  // Still collapse to one folder when every remaining option shares the same best score
  // but customer name is present — pick the longest/most descriptive name.
  if (customerName.trim()) {
    const preferred = [...bestOnly].sort(
      (left, right) => (right.folder.name?.length ?? 0) - (left.folder.name?.length ?? 0),
    )[0];
    return [toResult(preferred.folder)];
  }

  return bestOnly.map(({ folder }) => toResult(folder));
}

function readCellFill(cell: SheetGridCell): WorkflowCell["fill"] {
  const color =
    cell.effectiveFormat?.backgroundColorStyle?.rgbColor ??
    cell.effectiveFormat?.backgroundColor ??
    cell.userEnteredFormat?.backgroundColorStyle?.rgbColor ??
    cell.userEnteredFormat?.backgroundColor;
  if (!color) {
    return null;
  }
  return {
    red: color.red ?? 0,
    green: color.green ?? 0,
    blue: color.blue ?? 0,
  };
}

function buildWorkflowCell(cell: SheetGridCell): WorkflowCell {
  const formula = cell.userEnteredValue?.formulaValue ?? null;
  const text = (cell.formattedValue ?? "").trim();
  const links: Array<{ url: string }> = [];

  if (cell.hyperlink) {
    links.push({ url: cell.hyperlink });
  }

  for (const run of cell.textFormatRuns ?? []) {
    const uri = run.format?.link?.uri?.trim();
    if (uri && !links.some((link) => link.url === uri)) {
      links.push({ url: uri });
    }
  }

  const dropdownOptions = (cell.dataValidation?.condition?.values ?? [])
    .map((item) => item.userEnteredValue?.trim() ?? "")
    .filter((value) => value && !value.startsWith("="));

  return { text, formula, links, fill: readCellFill(cell), dropdownOptions };
}

function buildWorkflowRows(payload: SheetGridResponse): WorkflowCell[][] {
  return (payload.sheets?.[0]?.data ?? []).flatMap((data) =>
    (data.rowData ?? []).map((row) => (row.values ?? []).map(buildWorkflowCell)),
  );
}

function buildWorkflowSheetRows(sheet: NonNullable<SheetGridResponse["sheets"]>[number]) {
  return (sheet.data ?? []).flatMap((data) =>
    (data.rowData ?? []).map((row) => (row.values ?? []).map(buildWorkflowCell)),
  );
}

async function googleFetch<T>(url: string, init?: RequestInit, retried = false): Promise<T> {
  const accessToken = await getValidAccessToken(retried);
  const response = await fetch(url, {
    ...init,
    cache: init?.cache ?? "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; status?: string };
  };

  if (response.status === 401 && !retried) {
    return googleFetch<T>(url, init, true);
  }

  if (!response.ok) {
    throw new Error(payload.error?.message || `Google API request failed (${response.status}).`);
  }

  return payload;
}

type DriveListOptions = {
  /** Shared Drive ID. When set, search is scoped to that Shared Drive. */
  driveId?: string | null;
};

async function listDriveFoldersOnce(
  query: string,
  corpora: "user" | "drive" | "allDrives",
  driveId?: string | null,
) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      corpora,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      fields: "nextPageToken,files(id,name,mimeType,driveId,parents,webViewLink)",
      pageSize: "100",
    });

    // Google docs: `spaces` is not supported with corpora=drive or allDrives.
    if (corpora === "user") {
      params.set("spaces", "drive");
    }
    if (driveId) {
      params.set("driveId", driveId);
    }
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const payload = await googleFetch<DriveListResponse>(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    );
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return files;
}

function dedupeDriveFiles(files: DriveFile[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const id = file.id?.trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

async function listDriveFolders(query: string, options: DriveListOptions = {}) {
  const driveId = options.driveId?.trim() || null;

  if (driveId) {
    return dedupeDriveFiles(await listDriveFoldersOnce(query, "drive", driveId));
  }

  // Include My Drive + Shared Drives the signed-in account can access.
  const [userFiles, sharedDriveFiles] = await Promise.all([
    listDriveFoldersOnce(query, "user"),
    listDriveFoldersOnce(query, "allDrives"),
  ]);

  return dedupeDriveFiles([...userFiles, ...sharedDriveFiles]);
}

async function listChildFolders(parentFolderId: string, driveId?: string | null) {
  const query = `'${escapeDriveQuery(parentFolderId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  return listDriveFolders(query, { driveId });
}

async function findChildFolderByName(
  parentFolderId: string,
  folderName: string,
  driveId?: string | null,
) {
  const query = `'${escapeDriveQuery(parentFolderId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const matches = await listDriveFolders(query, { driveId });
  return matches[0] ?? null;
}

/** Prefer exact name, then normalized match among children (handles spacing/case). */
async function findChildFolderFlexible(
  parentFolderId: string,
  folderName: string,
  driveId?: string | null,
) {
  const exact = await findChildFolderByName(parentFolderId, folderName, driveId);
  if (exact?.id) {
    return exact;
  }

  const children = await listChildFolders(parentFolderId, driveId);
  const wanted = normalizeDriveName(folderName);
  return (
    children.find((folder) => folder.name && normalizeDriveName(folder.name) === wanted) ?? null
  );
}

async function findStillActiveFolder(designerFolderId: string, driveId?: string | null) {
  const candidates = ["Still Active", "Still active", "still active", "STILL ACTIVE"];
  for (const candidate of candidates) {
    const exact = await findChildFolderByName(designerFolderId, candidate, driveId);
    if (exact?.id) {
      return exact;
    }
  }

  const children = await listChildFolders(designerFolderId, driveId);
  const stillActive = children.find(
    (folder) => folder.name && normalizeDriveName(folder.name) === "still active",
  );
  if (stillActive?.id) {
    return stillActive;
  }

  return null;
}

export function parseDriveFolderId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const fromFoldersUrl = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1];
  if (fromFoldersUrl) {
    return fromFoldersUrl;
  }

  // Shared Drive root links look like /drive/shared-drives/{driveId}
  const fromSharedDriveUrl = trimmed.match(/\/shared-drives\/([a-zA-Z0-9_-]+)/)?.[1];
  if (fromSharedDriveUrl) {
    return fromSharedDriveUrl;
  }

  const fromOpenId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1];
  if (fromOpenId) {
    return fromOpenId;
  }

  if (/^[a-zA-Z0-9_-]{10,}$/u.test(trimmed)) {
    return trimmed;
  }

  return "";
}

export type ResolvedDriveFolder = {
  folderId: string;
  folderName: string;
  driveId: string | null;
  isSharedDrive: boolean;
  webUrl: string;
};

export async function resolveDriveFolder(folderIdOrUrl: string): Promise<ResolvedDriveFolder> {
  const folderId = parseDriveFolderId(folderIdOrUrl);
  if (!folderId) {
    throw new Error("Paste a Google Drive folder URL or folder ID.");
  }

  const payload = await googleFetch<DriveFile>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,driveId,webViewLink`,
  );

  if (!payload.id) {
    throw new Error("Google Drive did not return this folder. Check the URL and account access.");
  }

  if (payload.mimeType && payload.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("That link is a file, not a folder. Open the folder in Google Drive and copy its URL.");
  }

  const driveId = payload.driveId?.trim() || null;
  const isSharedDriveRoot = !driveId && folderId.startsWith("0A");
  return {
    folderId: payload.id,
    folderName: payload.name?.trim() || folderId,
    driveId: driveId || (isSharedDriveRoot ? payload.id : null),
    isSharedDrive: Boolean(driveId) || isSharedDriveRoot,
    webUrl:
      payload.webViewLink?.trim() || `https://drive.google.com/drive/folders/${payload.id}`,
  };
}

export async function resolveSharedDriveScope(folderIdOrUrl: string) {
  const resolved = await resolveDriveFolder(folderIdOrUrl);
  return {
    ...resolved,
    searchDriveId: resolved.driveId,
  };
}

export type SharedDriveInfo = {
  id: string;
  name: string;
  rangeStart: number | null;
  rangeEnd: number | null;
};

let sharedDrivesCache: { fetchedAt: number; drives: SharedDriveInfo[] } | null = null;

/** Parse ranges like "2001 - 2300" or "2001-2300" from Shared Drive names. */
export function extractNumberRange(value: string): { start: number; end: number } | null {
  const match = value.match(/(\d+)\s*[-–—]\s*(\d+)/u);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return start <= end ? { start, end } : { start: end, end: start };
}

export function projectNumberForRangeMatch(projectNumber: string) {
  const match = projectNumber.trim().match(/^(\d+)/u);
  return match ? Number(match[1]) : null;
}

export async function listSharedDrives(forceRefresh = false): Promise<SharedDriveInfo[]> {
  if (
    !forceRefresh &&
    sharedDrivesCache &&
    Date.now() - sharedDrivesCache.fetchedAt < 10 * 60_000
  ) {
    return sharedDrivesCache.drives;
  }

  const drives: SharedDriveInfo[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      fields: "nextPageToken,drives(id,name)",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const payload = await googleFetch<{
      drives?: Array<{ id?: string; name?: string }>;
      nextPageToken?: string;
    }>(`https://www.googleapis.com/drive/v3/drives?${params.toString()}`);

    for (const drive of payload.drives ?? []) {
      if (!drive.id || !drive.name?.trim()) {
        continue;
      }
      const range = extractNumberRange(drive.name);
      drives.push({
        id: drive.id,
        name: drive.name.trim(),
        rangeStart: range?.start ?? null,
        rangeEnd: range?.end ?? null,
      });
    }

    pageToken = payload.nextPageToken;
  } while (pageToken);

  drives.sort((left, right) => {
    const leftStart = left.rangeStart ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.rangeStart ?? Number.MAX_SAFE_INTEGER;
    return leftStart - rightStart || left.name.localeCompare(right.name);
  });

  sharedDrivesCache = { fetchedAt: Date.now(), drives };
  return drives;
}

export async function findSharedDriveForProject(projectNumber: string) {
  const projectValue = projectNumberForRangeMatch(projectNumber);
  const drives = await listSharedDrives();

  if (projectValue == null) {
    return null;
  }

  const rangedMatches = drives.filter(
    (drive) =>
      drive.rangeStart != null &&
      drive.rangeEnd != null &&
      drive.rangeStart <= projectValue &&
      projectValue <= drive.rangeEnd,
  );

  if (rangedMatches.length === 1) {
    return rangedMatches[0];
  }

  if (rangedMatches.length > 1) {
    // Prefer the narrowest matching range if overlaps exist.
    return [...rangedMatches].sort(
      (left, right) =>
        (left.rangeEnd! - left.rangeStart!) - (right.rangeEnd! - right.rangeStart!) ||
        left.name.localeCompare(right.name),
    )[0];
  }

  return null;
}

async function resolveSearchDriveId(
  projectNumber: string,
  sharedDriveFolderId?: string | null,
) {
  if (sharedDriveFolderId?.trim()) {
    const scope = await resolveSharedDriveScope(sharedDriveFolderId);
    return {
      driveId: scope.searchDriveId,
      matchReason: `Using configured Shared Drive folder (${scope.folderName})`,
    };
  }

  const matchedDrive = await findSharedDriveForProject(projectNumber);
  if (matchedDrive) {
    return {
      driveId: matchedDrive.id,
      matchReason: `Auto-matched Shared Drive “${matchedDrive.name}”`,
    };
  }

  return {
    driveId: null,
    matchReason: "Searched all Shared Drives",
  };
}

export async function fetchWorkflowWorksheetRows(
  spreadsheetId: string,
  worksheetName: string,
): Promise<WorkflowWorksheetRows> {
  const encodedRange = encodeURIComponent(worksheetName.trim());
  const fields = encodeURIComponent(
    "sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue,textFormatRuns.format.link.uri,effectiveFormat.backgroundColor,effectiveFormat.backgroundColorStyle,userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle,dataValidation.condition.values.userEnteredValue)",
  );
  const payload = await googleFetch<SheetGridResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}?includeGridData=true&ranges=${encodedRange}&fields=${fields}`,
  );

  return {
    worksheetName: worksheetName.trim(),
    rows: buildWorkflowRows(payload),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchWorkflowWorksheetsRows(
  spreadsheetId: string,
  worksheetNames: string[],
): Promise<WorkflowWorksheetRows[]> {
  const names = [...new Set(worksheetNames.map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) {
    return [];
  }

  const ranges = names.map((name) => `ranges=${encodeURIComponent(name)}`).join("&");
  const fields = encodeURIComponent(
    "sheets(properties(title),data.rowData.values(formattedValue,hyperlink,userEnteredValue,textFormatRuns.format.link.uri,effectiveFormat.backgroundColor,effectiveFormat.backgroundColorStyle,userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle,dataValidation.condition.values.userEnteredValue))",
  );
  const payload = await googleFetch<SheetGridResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}?includeGridData=true&${ranges}&fields=${fields}`,
  );
  const fetchedAt = new Date().toISOString();

  return (payload.sheets ?? []).map((sheet, index) => ({
    worksheetName: sheet.properties?.title?.trim() || names[index],
    rows: buildWorkflowSheetRows(sheet),
    fetchedAt,
  }));
}

export async function updateWorkflowWorksheetCell(
  spreadsheetId: string,
  worksheetName: string,
  cellAddress: string,
  value: string,
) {
  const escapedWorksheetName = worksheetName.trim().replace(/'/gu, "''");
  const range = `'${escapedWorksheetName}'!${cellAddress.trim().toUpperCase()}`;
  const encodedRange = encodeURIComponent(range);
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}/values/${encodedRange}`;

  if (!value.trim()) {
    await googleFetch(`${baseUrl}:clear`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return "";
  }

  const response = await googleFetch<{
    updatedData?: { values?: Array<Array<string | number | boolean>> };
  }>(
    `${baseUrl}?valueInputOption=USER_ENTERED&includeValuesInResponse=true&responseValueRenderOption=FORMATTED_VALUE`,
    {
      method: "PUT",
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [[value]],
      }),
    },
  );

  const updatedValue = response.updatedData?.values?.[0]?.[0];
  return updatedValue === undefined || updatedValue === null ? value : String(updatedValue);
}

export async function fetchSpreadsheetMetadata(spreadsheetId: string) {
  const payload = await googleFetch<{
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}?fields=properties.title,sheets.properties.sheetId,sheets.properties.title`,
  );

  return {
    title: payload.properties?.title ?? "Untitled spreadsheet",
    sheetCount: payload.sheets?.length ?? 0,
    worksheetNames:
      payload.sheets
        ?.map((sheet) => sheet.properties?.title?.trim() ?? "")
        .filter((title) => title.length > 0) ?? [],
  };
}

export async function searchProjectFolders(
  projectNumber: string,
  sharedDriveFolderId?: string | null,
  customerName = "",
): Promise<ProjectSearchResult[]> {
  const query = `name contains '${escapeDriveQuery(projectNumber)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const scope = await resolveSearchDriveId(projectNumber, sharedDriveFolderId);
  const folders = await listDriveFolders(query, { driveId: scope.driveId });
  const matches = selectProjectFolders(folders, projectNumber, scope.matchReason, customerName);

  if (matches.length > 0 || scope.driveId) {
    return matches;
  }

  // No range match and no configured folder: broad Shared Drive search.
  const broadFolders = await listDriveFoldersOnce(query, "allDrives");
  return selectProjectFolders(
    broadFolders,
    projectNumber,
    "Matched project number across Shared Drives",
    customerName,
  );
}

export async function findQcDestinationFolders(
  projectNumber: string,
  customerName: string,
  localFolderName = "",
  sharedDriveFolderId?: string | null,
): Promise<GoogleDriveFolderCandidate[]> {
  const cacheKey = `${projectNumber}::${customerName}::${localFolderName}::${sharedDriveFolderId ?? ""}`;
  const cached = destinationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const scope = await resolveSearchDriveId(projectNumber, sharedDriveFolderId);
  const query = `name contains '${escapeDriveQuery(projectNumber)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  let folders = await listDriveFolders(query, { driveId: scope.driveId });
  if (folders.length === 0 && !scope.driveId) {
    folders = await listDriveFoldersOnce(query, "allDrives");
  }

  const normalizedLocal = normalizeDriveName(localFolderName);
  const normalizedCustomer = normalizeDriveName(customerName);

  const numberMatches = folders.filter(
    (folder) => folder.id && folder.name && isProjectFolderMatch(folder.name, projectNumber),
  );
  const topLevel = numberMatches.filter((folder) =>
    isTopLevelProjectFolder(folder, projectNumber, numberMatches),
  );
  const pool = topLevel.length > 0 ? topLevel : numberMatches.filter(
    (folder) => folder.name && !isRevisionStyleProjectFolder(folder.name, projectNumber),
  );

  const scored = pool
    .map((folder) => {
      const folderName = folder.name!;
      const normalizedName = normalizeDriveName(folderName);
      let score = 10;
      const reasons: string[] = [scope.matchReason];

      if (normalizedLocal && normalizedName === normalizedLocal) {
        score += 100;
        reasons.push("exact folder name");
      }
      if (normalizedCustomer && normalizedName.includes(normalizedCustomer)) {
        score += 40;
        reasons.push("customer name");
      }
      if (folder.driveId) {
        score += 15;
        reasons.push("shared drive");
      }

      return {
        score,
        candidate: {
          folderId: folder.id!,
          folderName,
          driveId: folder.driveId ?? null,
          matchReason: reasons.join(", "),
        } satisfies GoogleDriveFolderCandidate,
      };
    })
    .sort((left, right) => right.score - left.score || left.candidate.folderName.localeCompare(right.candidate.folderName));

  const exactMatches = scored
    .filter(({ candidate }) => normalizedLocal && normalizeDriveName(candidate.folderName) === normalizedLocal)
    .map(({ candidate }) => candidate);

  let candidates = exactMatches.length > 0 ? exactMatches : scored.map(({ candidate }) => candidate);
  if (candidates.length > 1 && scored.length > 1 && scored[0].score > scored[1].score) {
    candidates = [scored[0].candidate];
  }
  if (candidates.length === 0) {
    throw new Error(
      `Unable to find a Google Drive folder matching project '${projectNumber}' and customer '${customerName}'. ` +
        "Connect the Google account that can open Shared drives named like “มัดจำแล้ว 2001 - 2300”. " +
        "When you add a new Shared Drive for a new range, the app will pick it up automatically.",
    );
  }

  destinationCache.set(cacheKey, candidates);
  return candidates;
}

export async function findSellingCustomerFolders(
  kiddai2FolderId: string,
  designerFolderName: string,
  customerName: string,
): Promise<SellingCustomerFolderOption[]> {
  const route = await resolveSellingDesignerRoute(kiddai2FolderId, designerFolderName);
  // Only list customer folders inside Still Active — never the designer root.
  const children = await listChildFolders(route.stillActiveFolderId, route.driveId);
  const normalizedCustomer = normalizeDriveName(customerName);
  const options = children
    .filter((folder) => folder.id && folder.name)
    .map((folder) => ({
      folderName: folder.name!,
      folderPath: `Kiddai2/ลูกค้ารอเขียนแบบ/${designerFolderName}/Still Active/${folder.name}`,
      folderId: folder.id!,
      matchReason: `Inside ${route.stillActiveFolderName}`,
    }));

  const exact = options.filter((folder) => normalizeDriveName(folder.folderName) === normalizedCustomer);
  if (exact.length > 0) {
    return exact.map((folder) => ({
      ...folder,
      matchReason: `Exact match in ${route.stillActiveFolderName}`,
    }));
  }

  const close = options.filter((folder) => {
    const normalizedName = normalizeDriveName(folder.folderName);
    return normalizedName.includes(normalizedCustomer) || normalizedCustomer.includes(normalizedName);
  });

  if (close.length > 0) {
    return close.map((folder) => ({
      ...folder,
      matchReason: `Similar name in ${route.stillActiveFolderName}`,
    }));
  }

  return [];
}

export const SELLING_DESIGNER_FOLDER_NAMES = {
  Tod: "Tod",
  Do: "Do & Fon",
  Kram: "Kram & Ploy",
  Rung: "Rung",
  Han: "Han",
  Steve: "Steve",
  Ton: "Ton & JOY",
} as const;

export type SellingDesignerName = keyof typeof SELLING_DESIGNER_FOLDER_NAMES;

export type Kiddai2Root = {
  folderId: string;
  folderName: string;
  driveId: string | null;
  isSharedDrive: boolean;
  source: "settings" | "shared-drive-name" | "folder-search";
};

export type SellingDesignerRoute = {
  designer: SellingDesignerName;
  designerFolderName: string;
  designerFolderId: string;
  stillActiveFolderId: string;
  driveId: string | null;
  isSharedDrive: boolean;
  customerCount: number;
  pathUsed: string;
  errorMessage: string;
};

export async function resolveKiddai2Root(configuredFolderId?: string | null): Promise<Kiddai2Root> {
  if (configuredFolderId?.trim()) {
    const resolved = await resolveDriveFolder(configuredFolderId);
    return {
      folderId: resolved.folderId,
      folderName: resolved.folderName,
      driveId: resolved.driveId,
      isSharedDrive: resolved.isSharedDrive,
      source: "settings",
    };
  }

  const sharedDrives = await listSharedDrives();
  const namedDrive = sharedDrives.find(
    (drive) => normalizeDriveName(drive.name) === "kiddai2",
  );
  if (namedDrive) {
    return {
      folderId: namedDrive.id,
      folderName: namedDrive.name,
      driveId: namedDrive.id,
      isSharedDrive: true,
      source: "shared-drive-name",
    };
  }

  const folderMatches = await listDriveFolders(
    "name = 'Kiddai2' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );
  const preferred =
    folderMatches.find((folder) => folder.driveId) ?? folderMatches[0] ?? null;
  if (preferred?.id) {
    return {
      folderId: preferred.id,
      folderName: preferred.name ?? "Kiddai2",
      driveId: preferred.driveId ?? null,
      isSharedDrive: Boolean(preferred.driveId),
      source: "folder-search",
    };
  }

  throw new Error(
    'Could not find Shared drive “Kiddai2” for this Google account. Ask an admin to add them in Google Drive → Shared drives → Kiddai2 → Manage members (same for มัดจำแล้ว Deposit drives).',
  );
}

type SellingPathCandidate = {
  label: string;
  parentIdForDesigners: string;
};

async function resolveDesignerParents(
  root: ResolvedDriveFolder,
): Promise<SellingPathCandidate[]> {
  const driveId = root.driveId;
  const candidates: SellingPathCandidate[] = [];

  // 1) Canonical desktop path: Kiddai2 / ลูกค้ารอเขียนแบบ / {designer} / Still Active
  const waitingRoot = await findChildFolderFlexible(root.folderId, "ลูกค้ารอเขียนแบบ", driveId);
  if (waitingRoot?.id) {
    candidates.push({
      label: `${root.folderName}/ลูกค้ารอเขียนแบบ`,
      parentIdForDesigners: waitingRoot.id,
    });
  }

  // 2) If Settings override already points at ลูกค้ารอเขียนแบบ, designers are direct children.
  if (normalizeDriveName(root.folderName).includes("ลูกค้ารอเขียนแบบ") || !waitingRoot?.id) {
    candidates.push({
      label: root.folderName,
      parentIdForDesigners: root.folderId,
    });
  }

  // 3) Designers directly under Kiddai2 (no intermediate folder)
  if (waitingRoot?.id) {
    candidates.push({
      label: root.folderName,
      parentIdForDesigners: root.folderId,
    });
  }

  // Deduplicate by parent id
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.parentIdForDesigners)) {
      return false;
    }
    seen.add(candidate.parentIdForDesigners);
    return true;
  });
}

async function resolveSellingDesignerRoute(
  kiddai2FolderId: string,
  designerFolderName: string,
) {
  const root = await resolveDriveFolder(kiddai2FolderId);
  const driveId = root.driveId;
  const parents = await resolveDesignerParents(root);
  const attempts: string[] = [];

  for (const parent of parents) {
    const designerFolder = await findChildFolderFlexible(
      parent.parentIdForDesigners,
      designerFolderName,
      driveId,
    );
    if (!designerFolder?.id) {
      attempts.push(`${parent.label}/${designerFolderName} (designer folder not found)`);
      continue;
    }

    const stillActive = await findStillActiveFolder(designerFolder.id, driveId);
    if (!stillActive?.id) {
      const childNames = (await listChildFolders(designerFolder.id, driveId))
        .map((folder) => folder.name)
        .filter(Boolean)
        .slice(0, 8);
      attempts.push(
        `${parent.label}/${designerFolderName}/Still Active missing` +
          (childNames.length > 0 ? ` (found: ${childNames.join(", ")})` : " (designer folder is empty in Drive API)"),
      );
      continue;
    }

    return {
      kiddai2: root,
      driveId,
      isSharedDrive: root.isSharedDrive,
      designerFolderId: designerFolder.id,
      stillActiveFolderId: stillActive.id,
      stillActiveFolderName: stillActive.name ?? "Still Active",
      pathUsed: `${parent.label}/${designerFolderName}/Still Active`,
    };
  }

  throw new Error(
    `Could not resolve Still Active for “${designerFolderName}”. Tried: ${attempts.join(" | ") || "no valid Kiddai2 path"}. ` +
      "Expected: Kiddai2 → ลูกค้ารอเขียนแบบ → designer → Still Active → customers.",
  );
}

export async function listSellingDesignerRoutes(
  configuredKiddai2FolderId?: string | null,
): Promise<{ kiddai2: Kiddai2Root; routes: SellingDesignerRoute[] }> {
  // Prefer the real Shared Drive named Kiddai2. A wrong override ID is a common cause of "Still Active missing".
  let kiddai2: Kiddai2Root;
  try {
    kiddai2 = await resolveKiddai2Root(null);
  } catch (autoError) {
    if (configuredKiddai2FolderId?.trim()) {
      kiddai2 = await resolveKiddai2Root(configuredKiddai2FolderId);
    } else {
      throw autoError;
    }
  }

  // If an override was saved but auto-find found Kiddai2 Shared Drive, use auto-find.
  if (
    configuredKiddai2FolderId?.trim() &&
    kiddai2.source === "shared-drive-name" &&
    configuredKiddai2FolderId.trim() !== kiddai2.folderId
  ) {
    // keep auto-found Shared Drive
  } else if (configuredKiddai2FolderId?.trim() && kiddai2.source === "shared-drive-name") {
    // same id — fine
  }

  const designerNames = Object.keys(SELLING_DESIGNER_FOLDER_NAMES) as SellingDesignerName[];
  const routes: SellingDesignerRoute[] = [];

  for (const designer of designerNames) {
    const designerFolderName = SELLING_DESIGNER_FOLDER_NAMES[designer];
    try {
      const route = await resolveSellingDesignerRoute(kiddai2.folderId, designerFolderName);
      const children = await listChildFolders(route.stillActiveFolderId, route.driveId);
      routes.push({
        designer,
        designerFolderName,
        designerFolderId: route.designerFolderId,
        stillActiveFolderId: route.stillActiveFolderId,
        driveId: route.driveId,
        isSharedDrive: route.isSharedDrive,
        customerCount: children.filter((folder) => folder.id && folder.name).length,
        pathUsed: route.pathUsed,
        errorMessage: "",
      });
    } catch (error) {
      routes.push({
        designer,
        designerFolderName,
        designerFolderId: "",
        stillActiveFolderId: "",
        driveId: kiddai2.driveId,
        isSharedDrive: kiddai2.isSharedDrive,
        customerCount: -1,
        pathUsed: "",
        errorMessage: error instanceof Error ? error.message : "Still Active missing",
      });
    }
  }

  // If everything failed with auto-found root and an override exists, retry override once.
  const allFailed = routes.every((route) => !route.stillActiveFolderId);
  if (allFailed && configuredKiddai2FolderId?.trim() && configuredKiddai2FolderId.trim() !== kiddai2.folderId) {
    return listSellingDesignerRoutesWithRoot(await resolveKiddai2Root(configuredKiddai2FolderId));
  }

  return { kiddai2, routes };
}

async function listSellingDesignerRoutesWithRoot(kiddai2: Kiddai2Root) {
  const designerNames = Object.keys(SELLING_DESIGNER_FOLDER_NAMES) as SellingDesignerName[];
  const routes: SellingDesignerRoute[] = [];

  for (const designer of designerNames) {
    const designerFolderName = SELLING_DESIGNER_FOLDER_NAMES[designer];
    try {
      const route = await resolveSellingDesignerRoute(kiddai2.folderId, designerFolderName);
      const children = await listChildFolders(route.stillActiveFolderId, route.driveId);
      routes.push({
        designer,
        designerFolderName,
        designerFolderId: route.designerFolderId,
        stillActiveFolderId: route.stillActiveFolderId,
        driveId: route.driveId,
        isSharedDrive: route.isSharedDrive,
        customerCount: children.filter((folder) => folder.id && folder.name).length,
        pathUsed: route.pathUsed,
        errorMessage: "",
      });
    } catch (error) {
      routes.push({
        designer,
        designerFolderName,
        designerFolderId: "",
        stillActiveFolderId: "",
        driveId: kiddai2.driveId,
        isSharedDrive: kiddai2.isSharedDrive,
        customerCount: -1,
        pathUsed: "",
        errorMessage: error instanceof Error ? error.message : "Still Active missing",
      });
    }
  }

  return { kiddai2, routes };
}

function sheetFileSuffix(sheetKind: CreateSheetKind) {
  if (sheetKind === "qc") {
    return "QC";
  }
  if (sheetKind === "quotation") {
    return "Quotation";
  }
  return "Presentation";
}

function buildProjectFileName(
  sheetKind: CreateSheetKind,
  projectNumber: string,
  customerName: string,
  destinationFolderName?: string | null,
) {
  if (sheetKind === "qc") {
    return `${projectNumber} QC only`;
  }
  if (sheetKind === "presentation") {
    if (destinationFolderName?.trim()) {
      return `${destinationFolderName.trim()} - Presentation`;
    }
    return `${projectNumber} Presentation only`;
  }
  if (destinationFolderName?.trim()) {
    return `${destinationFolderName.trim()} - ${sheetFileSuffix(sheetKind)}`;
  }
  return `${projectNumber} - ${customerName} - ${sheetFileSuffix(sheetKind)}`;
}

async function listSpreadsheetNamesInFolder(folderId: string) {
  const query =
    `'${escapeDriveQuery(folderId)}' in parents and ` +
    `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    corpora: "allDrives",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    fields: "files(id,name)",
    pageSize: "100",
  });
  const payload = await googleFetch<DriveListResponse>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );
  return (payload.files ?? [])
    .map((file) => file.name?.trim() ?? "")
    .filter(Boolean);
}

export async function nextUniqueSheetFileName(
  folderId: string,
  baseName: string,
) {
  const existing = new Set(
    (await listSpreadsheetNamesInFolder(folderId)).map((name) => name.toLocaleLowerCase()),
  );
  const trimmedBase = baseName.trim();
  if (!existing.has(trimmedBase.toLocaleLowerCase())) {
    return trimmedBase;
  }

  let index = 2;
  while (existing.has(`${trimmedBase} ${index}`.toLocaleLowerCase())) {
    index += 1;
  }
  return `${trimmedBase} ${index}`;
}

export async function createProjectSheet(options: {
  templateSpreadsheetId: string;
  projectNumber: string;
  customerName: string;
  destinationFolderId: string;
  destinationFolderName?: string | null;
  sheetKind: CreateSheetKind;
  fileName?: string | null;
}): Promise<CreatedGoogleSheetResult> {
  const baseName =
    options.fileName?.trim() ||
    buildProjectFileName(
      options.sheetKind,
      options.projectNumber.trim(),
      options.customerName.trim(),
      options.destinationFolderName,
    );

  const fileName =
    options.sheetKind === "qc"
      ? baseName
      : await nextUniqueSheetFileName(options.destinationFolderId, baseName);

  const payload = await googleFetch<DriveFile>(
    `https://www.googleapis.com/drive/v3/files/${options.templateSpreadsheetId.trim()}/copy?supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: "POST",
      body: JSON.stringify({
        name: fileName,
        parents: [options.destinationFolderId],
      }),
    },
  );

  const fileId = payload.id?.trim();
  if (!fileId) {
    throw new Error("Google Drive did not return the new spreadsheet ID.");
  }

  return {
    fileId,
    fileName: payload.name?.trim() || fileName,
    webUrl:
      payload.webViewLink?.trim() || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
  };
}

function mapDriveFileToSheet(file: DriveFile): CreatedGoogleSheetResult {
  return {
    fileId: file.id!,
    fileName: file.name!,
    webUrl:
      file.webViewLink?.trim() || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
  };
}

export async function listQcSheetsInFolder(
  folderId: string,
  projectNumber: string,
): Promise<CreatedGoogleSheetResult[]> {
  const query =
    `'${escapeDriveQuery(folderId)}' in parents and ` +
    `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and ` +
    `(name contains 'QC' or name contains 'qc')`;

  const params = new URLSearchParams({
    q: query,
    corpora: "allDrives",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    fields: "files(id,name,webViewLink)",
    pageSize: "50",
  });
  const payload = await googleFetch<DriveListResponse>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );

  const sheets = (payload.files ?? [])
    .filter((file) => file.id && file.name)
    .map(mapDriveFileToSheet);

  const normalizedProject = projectNumber.trim();
  return sheets.sort((left, right) => {
    const leftPreferred = /QC\s*only/i.test(left.fileName) ? 1 : 0;
    const rightPreferred = /QC\s*only/i.test(right.fileName) ? 1 : 0;
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }
    const leftProject = left.fileName.includes(normalizedProject) ? 1 : 0;
    const rightProject = right.fileName.includes(normalizedProject) ? 1 : 0;
    return rightProject - leftProject || left.fileName.localeCompare(right.fileName);
  });
}

export async function findQcSheetInFolder(
  folderId: string,
  projectNumber: string,
): Promise<CreatedGoogleSheetResult | null> {
  const sheets = await listQcSheetsInFolder(folderId, projectNumber);
  return sheets[0] ?? null;
}

async function nextQcFileName(folderId: string, projectNumber: string) {
  const sheets = await listQcSheetsInFolder(folderId, projectNumber);
  const base = `${projectNumber.trim()} QC only`;
  const existing = new Set(sheets.map((sheet) => sheet.fileName.trim().toLocaleLowerCase()));
  if (!existing.has(base.toLocaleLowerCase())) {
    return base;
  }
  let index = 2;
  while (existing.has(`${base} ${index}`.toLocaleLowerCase())) {
    index += 1;
  }
  return `${base} ${index}`;
}

export async function ensureQcSheet(options: {
  templateSpreadsheetId: string;
  projectNumber: string;
  customerName: string;
  destinationFolderId: string;
  destinationFolderName?: string | null;
  createIfMissing?: boolean;
  forceNew?: boolean;
}): Promise<{ sheet: CreatedGoogleSheetResult; created: boolean }> {
  if (!options.forceNew) {
    const existing = await findQcSheetInFolder(options.destinationFolderId, options.projectNumber);
    if (existing) {
      return { sheet: existing, created: false };
    }
  }
  if (options.createIfMissing === false) {
    throw new Error(`No QC sheet found in “${options.destinationFolderName || "folder"}”.`);
  }

  const fileName = await nextQcFileName(options.destinationFolderId, options.projectNumber);
  const sheet = await createProjectSheet({
    templateSpreadsheetId: options.templateSpreadsheetId,
    projectNumber: options.projectNumber,
    customerName: options.customerName,
    destinationFolderId: options.destinationFolderId,
    destinationFolderName: options.destinationFolderName,
    sheetKind: "qc",
    fileName,
  });
  return { sheet, created: true };
}

function parseCsvText(csvText: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const next = csvText[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

export async function importCsvIntoGoogleSheet(spreadsheetId: string, csvText: string) {
  const values = parseCsvText(csvText);
  if (values.length === 0) {
    throw new Error("The selected CSV file is empty.");
  }

  const metadata = await googleFetch<{
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}?fields=sheets.properties.title`,
  );
  const worksheetTitle = metadata.sheets?.[0]?.properties?.title?.trim();
  if (!worksheetTitle) {
    throw new Error("The copied QC sheet does not contain a worksheet to import into.");
  }

  const encodedTitle = encodeURIComponent(worksheetTitle);
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}/values/${encodedTitle}:clear`,
    { method: "POST", body: JSON.stringify({}) },
  );

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId.trim()}/values/${encodedTitle}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    },
  );
}

export function parseQueueFolderNumbers(queueInput: string) {
  const normalizedInput = queueInput.trim();
  if (!normalizedInput) {
    throw new Error("Enter a queue number list or total item count first.");
  }

  const singleValue = Number(normalizedInput);
  if (/^\d+$/u.test(normalizedInput) && Number.isFinite(singleValue)) {
    if (singleValue === 0) {
      throw new Error("Total items must be greater than 0.");
    }
    return {
      numbers: Array.from({ length: singleValue }, (_, index) => index + 1),
      totalItems: singleValue,
    };
  }

  const numbers = normalizedInput
    .split(/[,\n\r\t ]+/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!/^\d+$/u.test(value)) {
        throw new Error(
          `Invalid queue number '${value}'. Use a single total like 8 or a list like 1,3,7.`,
        );
      }
      return Number(value);
    })
    .sort((left, right) => left - right)
    .filter((value, index, all) => all.indexOf(value) === index);

  if (numbers.length === 0) {
    throw new Error("Enter at least one queue number.");
  }
  if (numbers[0] === 0) {
    throw new Error("Queue numbers must be greater than 0.");
  }

  return {
    numbers,
    totalItems: numbers[numbers.length - 1],
  };
}

export async function createQueueNumberFolders(options: {
  projectNumber: string;
  queueInput: string;
  destinationFolderId: string;
}): Promise<QueueFolderCreationResult> {
  const { numbers, totalItems } = parseQueueFolderNumbers(options.queueInput);
  const createdFolders: string[] = [];
  const existingFolders: string[] = [];

  for (const queueNumber of numbers) {
    const folderName = `${options.projectNumber.trim()}.${queueNumber}.${totalItems}`;
    const existing = await listDriveFolders(
      `name = '${escapeDriveQuery(folderName)}' and '${escapeDriveQuery(options.destinationFolderId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      {},
    );

    if (existing.length > 0) {
      existingFolders.push(folderName);
      continue;
    }

    await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name", {
      method: "POST",
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [options.destinationFolderId],
      }),
    });
    createdFolders.push(folderName);
  }

  return { createdFolders, existingFolders };
}

const recentExternalOpens = new Map<string, number>();

/** Open one new tab. Do not call window.open twice — Safari/Chrome on some Macs
 *  return null for `noopener` even after the first tab already opened. */
export function openExternalUrl(targetUrl: string) {
  const url = targetUrl.trim();
  if (!url) {
    return;
  }

  const now = Date.now();
  const lastOpen = recentExternalOpens.get(url) ?? 0;
  if (now - lastOpen < 800) {
    return;
  }
  recentExternalOpens.set(url, now);

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function spreadsheetEditUrl(fileId: string, fallbackUrl = "") {
  const id = fileId.trim();
  if (id) {
    return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  }
  return fallbackUrl.trim();
}

export function openDriveFolder(folderId: string) {
  openExternalUrl(`https://drive.google.com/drive/folders/${folderId}`);
}

export function pickCsvFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
