import type { Db } from "mongodb";

import type { DataImportSettings } from "@/domain/models/DataImportSettings";
import type { DataImportSettingsRepository } from "@/domain/repositories/DataImportSettingsRepository";

export class MongoDataImportSettingsRepository implements DataImportSettingsRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<DataImportSettings>("dataImportSettings");
  }

  async find(): Promise<DataImportSettings | null> {
    return this.collection.findOne({ settingKey: "dataImport" }, { projection: { _id: 0 } });
  }

  async save(settings: DataImportSettings): Promise<DataImportSettings> {
    await this.collection.replaceOne({ settingKey: "dataImport" }, settings, { upsert: true });
    return settings;
  }
}
