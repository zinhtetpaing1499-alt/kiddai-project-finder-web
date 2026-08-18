import type { WorkflowCell } from "../types/workflow";
import {
  DEFAULT_LINKS_PRESENT_CELL,
  DEFAULT_LINKS_QC_CELL,
  DEFAULT_LINKS_QUOTATION_CELL,
  DEFAULT_LINKS_STICKER_CELL,
  DEFAULT_LINKS_WORKSHEET_NAME,
  LINKS_CACHE_KEY,
  TEMPLATE_SPREADSHEET_IDS_CACHE_KEY,
} from "../constants/storage";

export type LinkItemKey = "qc" | "quotation" | "present" | "sticker";

export type LinkSourceConfig = {
  worksheetName: string;
  qcCell: string;
  quotationCell: string;
  presentCell: string;
  stickerCell: string;
};

export type WorkspaceLink = {
  key: LinkItemKey;
  title: string;
  displayText: string;
  url: string;
  worksheetName: string;
  cellRef: string;
};

export type TemplateSpreadsheetIds = {
  qc: string;
  quotation: string;
  presentation: string;
};

type TemplateSpreadsheetIdsCachePayload = {
  spreadsheetId: string;
  worksheetName: string;
  qcCell: string;
  quotationCell: string;
  presentCell: string;
  ids: TemplateSpreadsheetIds;
};

type CellCoordinates = {
  rowIndex: number;
  columnIndex: number;
};

export const LINK_TITLES: Record<LinkItemKey, string> = {
  qc: "QC",
  quotation: "Quotation",
  present: "Present",
  sticker: "Sticker",
};

export function getStoredLinkSourceConfig(): LinkSourceConfig {
  return {
    worksheetName: DEFAULT_LINKS_WORKSHEET_NAME,
    qcCell: DEFAULT_LINKS_QC_CELL,
    quotationCell: DEFAULT_LINKS_QUOTATION_CELL,
    presentCell: DEFAULT_LINKS_PRESENT_CELL,
    stickerCell: DEFAULT_LINKS_STICKER_CELL,
  };
}

export function readCachedTemplateSpreadsheetIds(
  spreadsheetId: string,
  sourceConfig: LinkSourceConfig,
) {
  const rawValue = window.localStorage.getItem(TEMPLATE_SPREADSHEET_IDS_CACHE_KEY);
  if (!rawValue) {
    const cachedLinks = readCachedWorkspaceLinks();
    if (!cachedLinks || cachedLinks.worksheetName !== sourceConfig.worksheetName) {
      return null;
    }

    const resolveCachedId = (key: LinkItemKey) => {
      const link = cachedLinks.links.find((candidate) => candidate.key === key);
      return link?.url.match(/\/spreadsheets\/d\/([^/?#]+)/i)?.[1] ?? "";
    };
    const migratedIds = {
      qc: resolveCachedId("qc"),
      quotation: resolveCachedId("quotation"),
      presentation: resolveCachedId("present"),
    };
    if (!migratedIds.qc || !migratedIds.quotation || !migratedIds.presentation) {
      return null;
    }

    writeCachedTemplateSpreadsheetIds(spreadsheetId, sourceConfig, migratedIds);
    return migratedIds;
  }

  try {
    const cached = JSON.parse(rawValue) as TemplateSpreadsheetIdsCachePayload;
    const matchesSource =
      cached.spreadsheetId === spreadsheetId &&
      cached.worksheetName === sourceConfig.worksheetName &&
      cached.qcCell === sourceConfig.qcCell &&
      cached.quotationCell === sourceConfig.quotationCell &&
      cached.presentCell === sourceConfig.presentCell;
    const hasAllIds = Boolean(
      cached.ids?.qc?.trim() &&
        cached.ids?.quotation?.trim() &&
        cached.ids?.presentation?.trim(),
    );

    return matchesSource && hasAllIds ? cached.ids : null;
  } catch {
    return null;
  }
}

export function writeCachedTemplateSpreadsheetIds(
  spreadsheetId: string,
  sourceConfig: LinkSourceConfig,
  ids: TemplateSpreadsheetIds,
) {
  window.localStorage.setItem(
    TEMPLATE_SPREADSHEET_IDS_CACHE_KEY,
    JSON.stringify({
      spreadsheetId,
      worksheetName: sourceConfig.worksheetName,
      qcCell: sourceConfig.qcCell,
      quotationCell: sourceConfig.quotationCell,
      presentCell: sourceConfig.presentCell,
      ids,
    } satisfies TemplateSpreadsheetIdsCachePayload),
  );
}

export function resolveTemplateSpreadsheetIdsFromRows(
  sourceConfig: LinkSourceConfig,
  rows: WorkflowCell[][],
): TemplateSpreadsheetIds {
  const resolveId = (key: LinkItemKey, cellRef: string) => {
    const workspaceLink = resolveWorkspaceLinkFromCell(
      key,
      sourceConfig.worksheetName,
      cellRef,
      rows,
    );
    const spreadsheetIdMatch = workspaceLink.url.match(/\/spreadsheets\/d\/([^/?#]+)/i);

    if (!spreadsheetIdMatch?.[1]) {
      throw new Error(`The ${LINK_TITLES[key]} link must point to a Google Sheet template.`);
    }

    return spreadsheetIdMatch[1];
  };

  return {
    qc: resolveId("qc", sourceConfig.qcCell),
    quotation: resolveId("quotation", sourceConfig.quotationCell),
    presentation: resolveId("present", sourceConfig.presentCell),
  };
}

export function readCachedWorkspaceLinks() {
  const rawValue = window.localStorage.getItem(LINKS_CACHE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as {
      links?: WorkspaceLink[];
      fetchedAt?: string;
      worksheetName?: string;
    };

    if (!Array.isArray(parsedValue.links) || typeof parsedValue.fetchedAt !== "string") {
      return null;
    }

    return {
      links: parsedValue.links,
      fetchedAt: parsedValue.fetchedAt,
      worksheetName: parsedValue.worksheetName ?? "",
    };
  } catch {
    return null;
  }
}

export function writeCachedWorkspaceLinks(
  links: WorkspaceLink[],
  worksheetName: string,
  fetchedAt: string,
) {
  window.localStorage.setItem(
    LINKS_CACHE_KEY,
    JSON.stringify({
      links,
      worksheetName,
      fetchedAt,
    }),
  );
}

export function isSupportedExternalUrl(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue.startsWith("https://") || normalizedValue.startsWith("http://");
}

export function getCellDisplayText(cell: WorkflowCell) {
  return cell.text.trim();
}

export function parseCellReference(value: string): CellCoordinates | null {
  const trimmedValue = value.trim().toUpperCase();
  const match = trimmedValue.match(/^([A-Z]+)(\d+)$/u);

  if (!match) {
    return null;
  }

  const [, columnLetters, rowDigits] = match;
  let columnIndex = 0;

  for (const character of columnLetters) {
    columnIndex = columnIndex * 26 + (character.charCodeAt(0) - 64);
  }

  const rowIndex = Number(rowDigits) - 1;

  if (rowIndex < 0 || columnIndex <= 0) {
    return null;
  }

  return {
    rowIndex,
    columnIndex: columnIndex - 1,
  };
}

export function resolveWorkspaceLinkFromCell(
  key: LinkItemKey,
  worksheetName: string,
  cellRef: string,
  rows: WorkflowCell[][],
): WorkspaceLink {
  const parsedCellReference = parseCellReference(cellRef);

  if (!parsedCellReference) {
    throw new Error(`Invalid cell reference: ${cellRef}`);
  }

  const row = rows[parsedCellReference.rowIndex];
  const cell = row?.[parsedCellReference.columnIndex];

  if (!cell) {
    throw new Error(`Cell ${cellRef.toUpperCase()} was not found in worksheet ${worksheetName}.`);
  }

  const displayText = getCellDisplayText(cell);
  const firstLinkedUrl = cell.links.find((link) => isSupportedExternalUrl(link.url))?.url ?? "";
  const plainTextUrl = isSupportedExternalUrl(displayText) ? displayText : "";
  const url = firstLinkedUrl || plainTextUrl;

  if (!url) {
    throw new Error(`Cell ${cellRef.toUpperCase()} does not contain a supported link.`);
  }

  return {
    key,
    title: LINK_TITLES[key],
    displayText: displayText || LINK_TITLES[key],
    url,
    worksheetName,
    cellRef: cellRef.toUpperCase(),
  };
}
