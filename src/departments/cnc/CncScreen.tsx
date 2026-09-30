import { cncBenches } from "./drawingJobs";
import "./cnc.css";

export default function CncScreen() {
  return (
    <main className="cnc" data-testid="cnc-screen">
      <p className="cnc__sheet" data-testid="sheet-note">
        The company still uses the workflow sheet; this screen sits beside it.
      </p>
      <header className="cnc__header">
        <h1>CNC</h1>
        <p>Drawing jobs</p>
      </header>
      <div className="cnc__benches">
        {cncBenches.map((bench) => (
          <section
            key={bench.name}
            className="cnc-bench"
            data-testid="cnc-bench"
            data-bench={bench.name}
            aria-label={bench.name}
          >
            <div className="cnc-bench__head">
              <h2>{bench.name}</h2>
              <span>{bench.jobs.length} jobs</span>
            </div>
            <ol className="cnc-bench__jobs">
              {bench.jobs.map((job) => (
                <li key={job.queueNumber} data-testid="drawing-job" data-queue={job.queueNumber}>
                  <span className="cnc-job__queue">Queue {job.queueNumber}</span>
                  <span className="cnc-job__customer">{job.customer}</span>
                  <span className="cnc-job__deadline">
                    <span className="cnc-job__label">Deadline</span>
                    {job.deadline}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
