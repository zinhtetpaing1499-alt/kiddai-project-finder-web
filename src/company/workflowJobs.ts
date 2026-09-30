import { useCallback, useEffect, useRef, useState } from "react";
import { WORKFLOW_GOOGLE_SHEET_ID_KEY } from "../constants/storage";
import { useGoogleConnection } from "../contexts/GoogleConnectionContext";
import { cellAt, fetchPublishedSheet } from "../services/publishedSheet";

export type SheetJob = {
  id: string;
  designer: string;
  stage: "Selling" | "Deposit" | "Estimate";
  refKind: "estimate" | "queue";
  jobRef: string;
  projectNumber: string;
  queueNumber: string;
  customerName: string;
  deadline: string;
  installDate: string;
  amount: string;
  notes: string;
};

type SheetLoad = {
  title: string;
  jobs: SheetJob[];
};

function isProjectNumber(value: string) {
  return /^\d+(?:\.\d+)*$/u.test(value.trim());
}

function isQueueNumber(value: string) {
  return /^\d{3,}$/u.test(value.trim());
}

function readDeposit(rows: string[][]) {
  const jobs: SheetJob[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const projectNumber = cellAt(row, 0);
    const customerName = cellAt(row, 2);
    const designer = cellAt(row, 3);
    if (!isProjectNumber(projectNumber) || !customerName || customerName.includes("ชื่อลูกค้า")) continue;
    jobs.push({
      id: `deposit-${projectNumber}-${rowIndex}`,
      designer: designer || "—",
      stage: "Deposit",
      refKind: "queue",
      jobRef: projectNumber,
      projectNumber,
      queueNumber: projectNumber,
      customerName,
      deadline: cellAt(row, 5),
      installDate: cellAt(row, 6),
      amount: cellAt(row, 4),
      notes: [cellAt(row, 8), cellAt(row, 9)].filter(Boolean).join(" · "),
    });
  }
  return jobs;
}

function readSelling(rows: string[][]) {
  const jobs: SheetJob[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const projectNumber = cellAt(row, 0);
    const customerName = cellAt(row, 2);
    const designer = cellAt(row, 7);
    const queueNumber = [cellAt(row, 1), cellAt(row, 10)].find(isQueueNumber) ?? "";
    if (!isProjectNumber(projectNumber) || !customerName || customerName.includes("ชื่อลูกค้า")) continue;
    if (queueNumber) continue;
    jobs.push({
      id: `selling-${projectNumber}-${rowIndex}`,
      designer: designer || "—",
      stage: "Selling",
      refKind: "estimate",
      jobRef: projectNumber,
      projectNumber,
      queueNumber: "",
      customerName,
      deadline: cellAt(row, 4),
      installDate: cellAt(row, 6),
      amount: cellAt(row, 3),
      notes: cellAt(row, 8),
    });
  }
  return jobs;
}

function readEstimate(rows: string[][]) {
  const jobs: SheetJob[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const projectNumber = cellAt(row, 0);
    const customerName = cellAt(row, 2);
    if (!isProjectNumber(projectNumber) || !customerName) continue;
    jobs.push({
      id: `estimate-${projectNumber}-${rowIndex}`,
      designer: cellAt(row, 4) || "—",
      stage: "Estimate",
      refKind: "estimate",
      jobRef: projectNumber,
      projectNumber,
      queueNumber: "",
      customerName,
      deadline: cellAt(row, 10),
      installDate: cellAt(row, 11),
      amount: cellAt(row, 5),
      notes: cellAt(row, 12),
    });
  }
  return jobs;
}

function preferQueue(jobs: SheetJob[]) {
  const deposited = new Set(
    jobs
      .filter((job) => job.stage === "Deposit")
      .flatMap((job) => [job.queueNumber, job.projectNumber].filter(Boolean)),
  );
  return jobs.filter(
    (job) =>
      job.stage !== "Selling" ||
      (!deposited.has(job.projectNumber) && !deposited.has(job.jobRef)),
  );
}

let cached: { at: number; value: SheetLoad } | null = null;

/** Reads designer tabs only. No Sheets write methods are called. */
export async function loadWorkflowJobs(): Promise<SheetLoad> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;

  const spreadsheetId = window.localStorage.getItem(WORKFLOW_GOOGLE_SHEET_ID_KEY)?.trim() ?? "";
  if (!spreadsheetId) {
    throw new Error("The Workflow Sheet is not set.");
  }

  const [depositRows, sellingRows, estimateRows] = await Promise.all([
    fetchPublishedSheet(spreadsheetId, "Deposit Stage"),
    fetchPublishedSheet(spreadsheetId, "Selling Stage"),
    fetchPublishedSheet(spreadsheetId, "ประเมิณ"),
  ]);
  const jobs = preferQueue([
    ...readDeposit(depositRows),
    ...readSelling(sellingRows),
    ...readEstimate(estimateRows),
  ]);

  const value = { title: "Workflow 2026", jobs };
  cached = { at: Date.now(), value };
  return value;
}

export function findSheetJob(jobs: SheetJob[], jobRef: string | null | undefined) {
  const needle = jobRef?.trim() ?? "";
  if (!needle) return null;
  return (
    jobs.find(
      (job) => job.queueNumber === needle || job.projectNumber === needle || job.jobRef === needle,
    ) ?? null
  );
}

export function useSheetJobs() {
  const { connectGoogle } = useGoogleConnection();
  const [jobs, setJobs] = useState<SheetJob[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "signed-out">("loading");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setPhase("loading");
    setError("");
    try {
      const result = await loadWorkflowJobs();
      if (requestId.current !== id) return;
      setJobs(result.jobs);
      setTitle(result.title);
      setPhase("ready");
    } catch (reason) {
      if (requestId.current !== id) return;
      setJobs([]);
      setPhase("ready");
      setError(reason instanceof Error ? reason.message : "The Workflow Sheet could not be read.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { jobs, title, error, phase, connectGoogle, reload: load };
}
