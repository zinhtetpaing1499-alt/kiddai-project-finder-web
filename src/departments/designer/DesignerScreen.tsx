import "./designer.css";

type JobKind = "lead" | "queue";

type DesignerJob = {
  id: string;
  kind: JobKind;
  customer: string;
  price: number;
  installWindow: string;
};

const DESIGNER_NAME = "Han";

/** Sample leads still on Selling Stage. Ids stand in for the estimate row. */
const STILL_SELLING: DesignerJob[] = [
  { id: "2140", kind: "lead", customer: "Dao Prasong", price: 178000, installWindow: "Mid October" },
  { id: "2146", kind: "lead", customer: "Viroj Saelim", price: 96500, installWindow: "End November" },
  { id: "2151", kind: "lead", customer: "Kannika Meechai", price: 452000, installWindow: "Start December" },
];

/** Sample jobs after a deposit. Ids stand in for the deposit queue number. */
const DEPOSITED: DesignerJob[] = [
  { id: "5310", kind: "queue", customer: "Somchai Rattana", price: 265000, installWindow: "Start October" },
  { id: "5317", kind: "queue", customer: "Ladda Wong", price: 142800, installWindow: "Mid November" },
  { id: "5324", kind: "queue", customer: "Teerapat Somsri", price: 389000, installWindow: "End December" },
];

function formatPrice(price: number) {
  return `${price.toLocaleString("en-US")} baht`;
}

function jobLabel(job: DesignerJob) {
  return job.kind === "lead" ? `Lead ${job.id}` : `Queue ${job.id}`;
}

function JobRow({ job }: { job: DesignerJob }) {
  return (
    <li className="designer-row" data-testid="designer-job" data-kind={job.kind} data-job-id={job.id}>
      <div className="designer-row__top">
        <span className="designer-row__name">{job.customer}</span>
        <span className="designer-row__price">{formatPrice(job.price)}</span>
      </div>
      <div className="designer-row__bottom">
        <span className="designer-chip">{jobLabel(job)}</span>
        <span className="designer-row__window">{job.installWindow}</span>
      </div>
    </li>
  );
}

function JobSection({ title, jobs, testId }: { title: string; jobs: DesignerJob[]; testId: string }) {
  return (
    <section className="designer-section" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 className="designer-section__title" id={`${testId}-title`}>
        {title}
        <span className="designer-section__count">{jobs.length}</span>
      </h2>
      <ul className="designer-list">
        {jobs.map((job) => (
          <JobRow key={`${job.kind}-${job.id}`} job={job} />
        ))}
      </ul>
    </section>
  );
}

export default function DesignerScreen() {
  return (
    <div className="designer-app" data-testid="designer-screen">
      <div className="designer-phone" data-testid="designer-phone">
        <header className="designer-header">
          <h1>{DESIGNER_NAME}</h1>
          <p>Designer</p>
        </header>
        <p className="designer-note" data-testid="designer-note">
          The company still uses the workflow sheet and customer chats. This screen sits beside them.
        </p>
        <div className="designer-scroll">
          <JobSection title="Still selling" jobs={STILL_SELLING} testId="still-selling" />
          <JobSection title="Deposited" jobs={DEPOSITED} testId="deposited" />
        </div>
      </div>
    </div>
  );
}
