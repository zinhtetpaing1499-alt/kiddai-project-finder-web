import type { SheetJob } from "./workflowJobs";

export function SheetNotice({
  phase,
  error,
  title,
  onConnect,
}: {
  phase: "loading" | "ready" | "signed-out";
  error: string;
  title: string;
  onConnect: () => void;
}) {
  if (phase === "loading") return <p className="company-note">Reading the Workflow Sheet…</p>;
  if (phase === "signed-out") {
    return (
      <div className="company-note">
        <p>Connect Google to read the Workflow Sheet. This does not change the sheet.</p>
        <button type="button" className="company-primary" onClick={onConnect}>
          Connect Google
        </button>
      </div>
    );
  }
  if (error) return <p className="company-error">{error}</p>;
  return <p className="company-note">Read only from {title || "the Workflow Sheet"}. Nothing is written back.</p>;
}

export function SheetJobList({ jobs }: { jobs: SheetJob[] }) {
  if (jobs.length === 0) return <p className="company-empty">No rows in this list.</p>;
  return (
    <ul className="company-sheetjobs">
      {jobs.map((job) => (
        <li key={job.id}>
          <strong>{job.customerName}</strong>
          <span>{job.designer}</span>
          <span>{job.refKind === "queue" ? `Queue ${job.jobRef}` : `Estimate ${job.jobRef}`}</span>
          <span className="company-pill">{job.stage}</span>
          <span>{job.installDate || job.deadline || ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function filterJobs(jobs: SheetJob[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return jobs;
  return jobs.filter((job) =>
    [job.customerName, job.designer, job.jobRef, job.projectNumber, job.queueNumber, job.stage]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

export function jobsForDepartment(jobs: SheetJob[], stageSlug: string) {
  if (stageSlug === "selling") return jobs.filter((job) => job.stage === "Selling");
  if (stageSlug === "deposit") return jobs.filter((job) => job.stage === "Deposit");
  if (stageSlug === "estimate") return jobs.filter((job) => job.stage === "Estimate");
  return null;
}
