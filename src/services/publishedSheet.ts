/** Read-only CSV of a link-shared worksheet. Nothing is written back. */

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function cellAt(row: string[], index: number) {
  return row[index]?.replace(/\s+/g, " ").trim() ?? "";
}

export async function fetchPublishedSheet(spreadsheetId: string, sheetName: string) {
  const params = new URLSearchParams({
    spreadsheetId: spreadsheetId.trim(),
    sheet: sheetName,
  });
  const response = await fetch(`/api/workflow-sheet?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    let message = "The Workflow Sheet could not be read.";
    try {
      const payload = JSON.parse(text) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // The body is not JSON.
    }
    throw new Error(message);
  }
  return parseCsv(text);
}
