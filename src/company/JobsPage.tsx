import { CompanyShell } from "./CompanyApp";
import { SheetBoard } from "./SheetBoard";

export function CompanyJobsPage() {
  return (
    <CompanyShell pane="section">
      <div className="company-page company-page--wide">
        <header className="company-page__head">
          <h1>Jobs</h1>
        </header>
        <SheetBoard slug="deposit" />
      </div>
    </CompanyShell>
  );
}
