import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { WORKFLOW_VIEWS, loadWorkflowTable, viewBySlug, type SheetTable } from "./workflowSheets";

export function SheetBoard({ slug }: { slug?: string }) {
  const view = viewBySlug(slug);
  const [table, setTable] = useState<SheetTable | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    loadWorkflowTable(view)
      .then((result) => {
        if (!cancel) setTable(result);
      })
      .catch((reason) => {
        if (!cancel) {
          setTable(null);
          setError(reason instanceof Error ? reason.message : "The Workflow Sheet could not be read.");
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [view]);

  const rows = useMemo(() => {
    const source = table?.rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((row) => row.join(" ").toLowerCase().includes(needle));
  }, [query, table]);

  return (
    <div className="company-board">
      <div className="company-tabs company-tabs--wrap" role="tablist" aria-label="Workflow sheets">
        {WORKFLOW_VIEWS.map((item) => (
          <NavLink
            key={item.slug}
            to={item.slug === "deposit" ? "/company/jobs" : `/company/departments/${item.slug}`}
            role="tab"
            aria-selected={item.slug === view.slug}
            className={item.slug === view.slug ? "company-tab company-tab--on" : "company-tab"}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      <div className="company-board__bar">
        <p>{loading ? "Reading the sheet…" : `${rows.length} rows · ${view.sheetName}`}</p>
        <label className="company-search">
          <span className="company-sr">Search this sheet</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, queue, or note"
          />
        </label>
      </div>
      {error ? <p className="company-error">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <p className="company-empty">No rows in this sheet.</p> : null}
      {rows.length > 0 && table ? (
        <div className="company-table-wrap">
          <table className="company-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={table.columns[cellIndex]} title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
