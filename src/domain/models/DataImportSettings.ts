export interface DataImportSettings {
  schemaVersion: "1.0.0";
  settingKey: "dataImport";
  recentContentLimit: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_RECENT_CONTENT_LIMIT = 30;
export const MIN_RECENT_CONTENT_LIMIT = 1;
export const MAX_RECENT_CONTENT_LIMIT = 100;
