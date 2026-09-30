import "./purchasing.css";

type PurchasingJob = {
  queueNumber: string;
  deadline: string;
};

const JOBS: PurchasingJob[] = [
  { queueNumber: "8801", deadline: "2026-09-18" },
  { queueNumber: "8808", deadline: "2026-09-24" },
  { queueNumber: "8815", deadline: "2026-10-06" },
  { queueNumber: "8822", deadline: "2026-10-14" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(iso: string) {
  const day = parseDay(iso);
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

function deadlineIsPast(iso: string, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parseDay(iso).getTime() < today.getTime();
}

export default function PurchasingScreen() {
  return (
    <section className="purchasing" data-testid="purchasing-screen" aria-label="Purchasing">
      <p className="purchasing-beside" data-testid="sheet-line">
        The company still uses the workflow sheet. This screen sits beside it.
      </p>
      <header className="purchasing-head">
        <h1>จัดซื้อ</h1>
      </header>
      <p className="purchasing-note" data-testid="order-date-note">
        The date is entered only when the whole order is placed.
      </p>
      <ol className="purchasing-list">
        {JOBS.map((job) => {
          const past = deadlineIsPast(job.deadline);
          return (
            <li
              key={job.queueNumber}
              className={past ? "purchasing-row purchasing-row--past" : "purchasing-row"}
              data-testid="purchasing-row"
              data-queue={job.queueNumber}
              data-past={past ? "true" : "false"}
            >
              <div className="purchasing-row__top">
                <span className="purchasing-queue">Queue {job.queueNumber}</span>
                {past ? (
                  <span className="purchasing-past" data-testid="deadline-past">
                    Past
                  </span>
                ) : null}
              </div>
              <p className="purchasing-deadline">
                <span>Deadline</span>
                <time dateTime={job.deadline}>{formatDay(job.deadline)}</time>
              </p>
              <p className="purchasing-order">
                <span>Order date</span>
                <span className="purchasing-order__blank">—</span>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
