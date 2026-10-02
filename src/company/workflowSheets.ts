import { WORKFLOW_GOOGLE_SHEET_ID_KEY } from "../constants/storage";
import { cellAt, fetchPublishedSheet } from "../services/publishedSheet";

export type SheetColumn = {
  label: string;
  index: number;
};

export type WorkflowView = {
  slug: string;
  label: string;
  sheetName: string;
  headerRow: number;
  requiredIndex: number;
  columns: SheetColumn[];
};

/** Columns taken from the live Workflow Sheet. Read only. */
export const WORKFLOW_VIEWS: WorkflowView[] = [
  {
    slug: "estimate",
    label: "ประเมิน",
    sheetName: "ประเมิณ",
    headerRow: 0,
    requiredIndex: 2,
    columns: [
      { label: "ลำดับ", index: 0 },
      { label: "วันที่", index: 1 },
      { label: "ชื่อลูกค้า", index: 2 },
      { label: "ช่องทาง", index: 3 },
      { label: "คนประเมิน", index: 4 },
      { label: "ราคาประเมิน", index: 5 },
      { label: "เรียกวัด", index: 7 },
      { label: "ติดต่อ", index: 8 },
      { label: "โซน", index: 9 },
      { label: "วันนัดวัด", index: 10 },
      { label: "คิวติดตั้ง", index: 11 },
      { label: "หมายเหตุ", index: 12 },
    ],
  },
  {
    slug: "measure",
    label: "วัด",
    sheetName: "วัด",
    headerRow: 0,
    requiredIndex: 1,
    columns: [
      { label: "ลำดับ", index: 0 },
      { label: "ชื่อลูกค้า", index: 1 },
      { label: "ราคาประเมิน", index: 2 },
      { label: "ที่อยู่", index: 3 },
      { label: "โซน", index: 4 },
      { label: "หมายเหตุ", index: 5 },
      { label: "Code", index: 6 },
    ],
  },
  {
    slug: "selling",
    label: "Selling",
    sheetName: "Selling Stage",
    headerRow: 0,
    requiredIndex: 2,
    columns: [
      { label: "No.", index: 0 },
      { label: "ชื่อลูกค้า", index: 2 },
      { label: "ราคา", index: 3 },
      { label: "วันวัด", index: 4 },
      { label: "ส่ง Draft", index: 5 },
      { label: "คิวที่แจ้ง", index: 6 },
      { label: "ช่างแบบ", index: 7 },
      { label: "หมายเหตุ", index: 8 },
      { label: "Freezz", index: 9 },
      { label: "มัดจำ / คิว", index: 10 },
      { label: "ตามครั้งที่ 1", index: 14 },
      { label: "ตามครั้งที่ 2", index: 15 },
      { label: "ตามครั้งที่ 3", index: 16 },
      { label: "หลุด", index: 17 },
      { label: "Note", index: 19 },
    ],
  },
  {
    slug: "deposit",
    label: "Deposit",
    sheetName: "Deposit Stage",
    headerRow: 0,
    requiredIndex: 2,
    columns: [
      { label: "คิว", index: 0 },
      { label: "ชื่อลูกค้า", index: 2 },
      { label: "ช่างแบบ", index: 3 },
      { label: "ยอด", index: 4 },
      { label: "Deadline", index: 5 },
      { label: "Install", index: 6 },
      { label: "ส่งพวงไม้", index: 7 },
      { label: "สีไม้", index: 8 },
      { label: "Confirm", index: 9 },
      { label: "เลขคิว", index: 10 },
      { label: "QC", index: 11 },
      { label: "ชิ้นงาน", index: 12 },
      { label: "เสร็จทั้งหมด", index: 13 },
      { label: "ส่ง CNC", index: 14 },
      { label: "ช่าง CNC", index: 15 },
      { label: "หมายเหตุ CNC", index: 16 },
      { label: "หมายเหตุจัดซื้อ", index: 17 },
    ],
  },
  {
    slug: "confirm",
    label: "Confirm",
    sheetName: "Deposit Stage",
    headerRow: 0,
    requiredIndex: 2,
    columns: [
      { label: "คิว", index: 0 },
      { label: "ชื่อลูกค้า", index: 2 },
      { label: "ช่างแบบ", index: 3 },
      { label: "Confirm", index: 9 },
      { label: "สีไม้", index: 8 },
      { label: "QC", index: 11 },
      { label: "ส่ง CNC", index: 14 },
      { label: "Install", index: 6 },
    ],
  },
  {
    slug: "draftman",
    label: "Draftman",
    sheetName: "Draftman Stage",
    headerRow: 0,
    requiredIndex: 3,
    columns: [
      { label: "คิว", index: 2 },
      { label: "ลูกค้า", index: 3 },
      { label: "ช่างแบบ", index: 4 },
      { label: "ยอด", index: 5 },
      { label: "วันที่", index: 6 },
      { label: "ผู้รับผิดชอบ", index: 1 },
      { label: "หมายเหตุ CNC", index: 7 },
      { label: "+5 cm", index: 8 },
      { label: "เลขตู้", index: 9 },
      { label: "งานไฟ", index: 10 },
      { label: "ระยะ", index: 12 },
      { label: "Tag / Tablet", index: 13 },
    ],
  },
  {
    slug: "purchasing",
    label: "จัดซื้อ",
    sheetName: "จัดซื้อ",
    headerRow: 1,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "อ้างอิง", index: 1 },
      { label: "แผนก", index: 2 },
      { label: "รายละเอียด", index: 3 },
      { label: "คิว", index: 4 },
      { label: "วันที่", index: 6 },
      { label: "ช่างแบบ", index: 12 },
      { label: "หมายเหตุช่างแบบ", index: 13 },
    ],
  },
  {
    slug: "store",
    label: "สโตร์",
    sheetName: "สโตร์",
    headerRow: 1,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "อ้างอิง", index: 1 },
      { label: "แผนก", index: 2 },
      { label: "รายละเอียด", index: 3 },
      { label: "คิว", index: 4 },
      { label: "วันที่", index: 6 },
      { label: "คิวจัดของ", index: 8 },
      { label: "ยอด", index: 9 },
    ],
  },
  {
    slug: "cutting",
    label: "ตัดไม้",
    sheetName: "ตัดไม้",
    headerRow: 1,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "อ้างอิง", index: 1 },
      { label: "แผนก", index: 2 },
      { label: "รายละเอียด", index: 3 },
      { label: "คิว", index: 4 },
      { label: "วันที่", index: 6 },
    ],
  },
  {
    slug: "assembly",
    label: "ประกอบ",
    sheetName: "ประกอบ",
    headerRow: 1,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "อ้างอิง", index: 1 },
      { label: "แผนก", index: 2 },
      { label: "รายละเอียด", index: 3 },
      { label: "คิว", index: 4 },
      { label: "วันที่", index: 6 },
    ],
  },
  {
    slug: "rework",
    label: "แก้",
    sheetName: "แก้",
    headerRow: 0,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "เลขคิว", index: 1 },
      { label: "คิว", index: 2 },
      { label: "CNC", index: 3 },
      { label: "จัดซื้อ", index: 4 },
      { label: "สโตร์", index: 5 },
      { label: "ตัด", index: 6 },
      { label: "ประกอบ", index: 7 },
      { label: "Admin", index: 8 },
      { label: "ช่าง CNC", index: 9 },
      { label: "วันส่ง", index: 11 },
      { label: "แผนก", index: 12 },
      { label: "รายละเอียด", index: 13 },
    ],
  },
  {
    slug: "cnc",
    label: "CNC",
    sheetName: "แก้",
    headerRow: 0,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "คิว", index: 2 },
      { label: "CNC", index: 3 },
      { label: "ช่าง CNC", index: 9 },
      { label: "วันส่ง", index: 11 },
      { label: "รายละเอียด", index: 13 },
    ],
  },
  {
    slug: "admin",
    label: "Admin",
    sheetName: "Admin",
    headerRow: 0,
    requiredIndex: 0,
    columns: [
      { label: "เลขเคส", index: 0 },
      { label: "อ้างอิง", index: 1 },
      { label: "แผนก", index: 2 },
      { label: "รายละเอียด", index: 3 },
      { label: "คิว", index: 4 },
      { label: "วันที่", index: 6 },
      { label: "คิวตาม", index: 8 },
      { label: "ชื่อ", index: 9 },
      { label: "ยอด", index: 10 },
      { label: "ส่งพวงไม้", index: 11 },
      { label: "Deadline", index: 12 },
    ],
  },
];

export type SheetTable = {
  label: string;
  columns: string[];
  rows: string[][];
};

const cache = new Map<string, { at: number; value: SheetTable }>();

function blank(value: string) {
  const text = value.trim();
  return !text || text === "#N/A" || text === "#REF!" || text === "FALSE";
}

export function viewBySlug(slug: string | undefined) {
  return WORKFLOW_VIEWS.find((view) => view.slug === slug) ?? WORKFLOW_VIEWS.find((view) => view.slug === "deposit") ?? WORKFLOW_VIEWS[0];
}

export async function loadWorkflowTable(view: WorkflowView): Promise<SheetTable> {
  const hit = cache.get(view.slug);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;

  const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
  if (!spreadsheetId) throw new Error("The Workflow Sheet is not set.");

  const grid = await fetchPublishedSheet(spreadsheetId, view.sheetName);
  const rows: string[][] = [];
  for (let index = view.headerRow + 1; index < grid.length; index += 1) {
    const source = grid[index] ?? [];
    const required = cellAt(source, view.requiredIndex);
    if (blank(required) || /ชื่อลูกค้า|เลขเคส|Name/i.test(required)) continue;
    if (view.slug === "cnc" && cellAt(source, 3).toLowerCase() !== "yes") continue;
    if (view.slug === "confirm" && cellAt(source, 9).toLowerCase() !== "yes") continue;
    const cells = view.columns.map((column) => {
      const value = cellAt(source, column.index);
      return blank(value) ? "" : value;
    });
    if (cells.every((cell) => !cell)) continue;
    rows.push(cells);
  }

  const value = { label: view.label, columns: view.columns.map((column) => column.label), rows };
  cache.set(view.slug, { at: Date.now(), value });
  return value;
}
