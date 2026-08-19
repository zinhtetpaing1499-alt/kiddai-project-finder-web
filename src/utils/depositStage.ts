import type { WorkflowCell } from "../types/workflow";

export const DEPOSIT_STAGE_SHEET_HINT = "Deposit Stage";

const FALLBACK_COLUMNS = {
  project: 1,
  customer: 2,
  owner: 3,
  amount: 4,
  deadline: 5,
  installation: 6,
  woodColor: 8,
  confirmation: 9,
  queueNumber: 10,
  qc: 11,
  pieces: 12,
  finished: 13,
};

export type DepositStageRecord = {
  id: string;
  worksheetRow: number;
  owner: string;
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
  finishedAt: string;
};

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

function headerValue(rows: WorkflowCell[][], rowIndex: number, columnIndex: number) {
  return getCellText(rows, rowIndex, columnIndex).toLocaleLowerCase();
}

function findColumn(rows: WorkflowCell[][], headerRow: number, needles: string[]) {
  const row = rows[headerRow] ?? [];
  return row.findIndex((_, columnIndex) => {
    const value = headerValue(rows, headerRow, columnIndex);
    return needles.some((needle) => value.includes(needle));
  });
}

function findHeaderRow(rows: WorkflowCell[][]) {
  const limit = Math.min(rows.length, 20);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const joined = (rows[rowIndex] ?? [])
      .map((cell) => cell.text.trim().toLocaleLowerCase())
      .join(" | ");
    const hasFinished = joined.includes("finished") || joined.includes("เสร็จ");
    const hasOwner = joined.includes("owner") || joined.includes("ช่าง");
    const hasName = joined.includes("name") || joined.includes("ชื่อ");
    if (hasFinished && (hasOwner || hasName)) {
      return rowIndex;
    }
  }
  return -1;
}

export function resolveDepositStageWorksheetName(worksheetNames: string[]) {
  const exact = worksheetNames.find(
    (name) => name.trim().toLocaleLowerCase() === DEPOSIT_STAGE_SHEET_HINT.toLocaleLowerCase(),
  );
  if (exact) {
    return exact;
  }
  return (
    worksheetNames.find((name) => /deposit\s*stage/i.test(name)) ??
    worksheetNames.find((name) => /deposit/i.test(name) && /stage/i.test(name)) ??
    null
  );
}

export function parseDepositStageFinished(
  rows: WorkflowCell[][],
  worksheetName: string,
): DepositStageRecord[] {
  const headerRow = findHeaderRow(rows);
  const columns = {
    project: headerRow >= 0 ? findColumn(rows, headerRow, ["project"]) : -1,
    customer:
      headerRow >= 0 ? findColumn(rows, headerRow, ["customer", "name", "ชื่อ"]) : -1,
    owner: headerRow >= 0 ? findColumn(rows, headerRow, ["owner", "ช่างแบบ", "ช่าง"]) : -1,
    amount: headerRow >= 0 ? findColumn(rows, headerRow, ["amount", "ยอด", "price"]) : -1,
    deadline: headerRow >= 0 ? findColumn(rows, headerRow, ["deadline", "กำหนด"]) : -1,
    installation:
      headerRow >= 0 ? findColumn(rows, headerRow, ["install", "ติดตั้ง"]) : -1,
    woodColor: headerRow >= 0 ? findColumn(rows, headerRow, ["color", "สีไม้"]) : -1,
    confirmation:
      headerRow >= 0 ? findColumn(rows, headerRow, ["confirm", "คอนเฟิร์ม"]) : -1,
    queueNumber: headerRow >= 0 ? findColumn(rows, headerRow, ["que", "queue", "คิว"]) : -1,
    qc: headerRow >= 0 ? findColumn(rows, headerRow, ["qc"]) : -1,
    pieces:
      headerRow >= 0 ? findColumn(rows, headerRow, ["pieces", "จำนวน"]) : -1,
    finished:
      headerRow >= 0 ? findColumn(rows, headerRow, ["finished", "เสร็จ"]) : -1,
  };

  const projectColumn = columns.project >= 0 ? columns.project : FALLBACK_COLUMNS.project;
  const customerColumn = columns.customer >= 0 ? columns.customer : FALLBACK_COLUMNS.customer;
  const ownerColumn = columns.owner >= 0 ? columns.owner : FALLBACK_COLUMNS.owner;
  const amountColumn = columns.amount >= 0 ? columns.amount : FALLBACK_COLUMNS.amount;
  const deadlineColumn = columns.deadline >= 0 ? columns.deadline : FALLBACK_COLUMNS.deadline;
  const installationColumn =
    columns.installation >= 0 ? columns.installation : FALLBACK_COLUMNS.installation;
  const woodColorColumn = columns.woodColor >= 0 ? columns.woodColor : FALLBACK_COLUMNS.woodColor;
  const confirmationColumn =
    columns.confirmation >= 0 ? columns.confirmation : FALLBACK_COLUMNS.confirmation;
  const queueColumn = columns.queueNumber >= 0 ? columns.queueNumber : FALLBACK_COLUMNS.queueNumber;
  const qcColumn = columns.qc >= 0 ? columns.qc : FALLBACK_COLUMNS.qc;
  const piecesColumn = columns.pieces >= 0 ? columns.pieces : FALLBACK_COLUMNS.pieces;
  const finishedColumn = columns.finished >= 0 ? columns.finished : FALLBACK_COLUMNS.finished;

  const startRow = headerRow >= 0 ? headerRow + 1 : 0;
  const records: DepositStageRecord[] = [];

  for (let rowIndex = startRow; rowIndex < rows.length; rowIndex += 1) {
    const projectNumber = getCellText(rows, rowIndex, projectColumn);
    const customerName = getCellText(rows, rowIndex, customerColumn);
    const owner = getCellText(rows, rowIndex, ownerColumn);
    const finishedAt = getCellText(rows, rowIndex, finishedColumn);

    if (!isProjectNumber(projectNumber) || !customerName || !owner || !finishedAt) {
      continue;
    }

    records.push({
      id: `deposit-stage-${worksheetName}-${rowIndex + 1}-${projectNumber}`,
      worksheetRow: rowIndex + 1,
      owner,
      projectNumber,
      customerName,
      customerUrl: getCellUrl(rows, rowIndex, customerColumn),
      amount: getCellText(rows, rowIndex, amountColumn),
      deadline: getCellText(rows, rowIndex, deadlineColumn),
      installation: getCellText(rows, rowIndex, installationColumn),
      woodColor: getCellText(rows, rowIndex, woodColorColumn),
      confirmation: getCellText(rows, rowIndex, confirmationColumn),
      queueNumber: getCellText(rows, rowIndex, queueColumn),
      qc: getCellText(rows, rowIndex, qcColumn),
      pieces: getCellText(rows, rowIndex, piecesColumn),
      sendCnc: "",
      finishedAt,
    });
  }

  return records;
}

export function matchDepositStageOwner(owner: string, designerName: string) {
  return owner.trim().toLocaleLowerCase() === designerName.trim().toLocaleLowerCase();
}
