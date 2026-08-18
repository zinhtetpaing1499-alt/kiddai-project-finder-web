export type WorkflowSpreadsheetMetadata = {
  title: string;
  worksheetNames: string[];
  fetchedAt: string;
};

export type WorkflowCellLink = {
  url: string;
};

export type WorkflowCell = {
  text: string;
  formula: string | null;
  links: WorkflowCellLink[];
};

export type WorkflowWorksheetRows = {
  worksheetName: string;
  rows: WorkflowCell[][];
  fetchedAt: string;
};

export type WorkflowSearchSnapshot = {
  metadata: WorkflowSpreadsheetMetadata;
  worksheets: WorkflowWorksheetRows[];
};
