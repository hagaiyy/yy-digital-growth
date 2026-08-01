import type { DataImportSettings } from "@/domain/models/DataImportSettings";

export interface DataImportSettingsRepository {
  find(): Promise<DataImportSettings | null>;
  save(settings: DataImportSettings): Promise<DataImportSettings>;
}
