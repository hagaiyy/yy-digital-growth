import type { Db } from "mongodb";

import { FacebookConnector } from "@/application/connectors/FacebookConnector";
import { InstagramConnector } from "@/application/connectors/InstagramConnector";
import { PinterestConnector } from "@/application/connectors/PinterestConnector";
import { ConnectionService } from "@/application/services/ConnectionService";
import { DataImportService } from "@/application/services/DataImportService";
import { getDb } from "@/infrastructure/mongodb/client";
import { MongoPlatformConnectionRepository } from "@/infrastructure/mongodb/repositories/MongoPlatformConnectionRepository";
import { MongoPlatformCredentialRepository } from "@/infrastructure/mongodb/repositories/MongoPlatformCredentialRepository";
import { MongoImportedContentRepository } from "@/infrastructure/mongodb/repositories/MongoImportedContentRepository";
import { MongoPerformanceSnapshotRepository } from "@/infrastructure/mongodb/repositories/MongoPerformanceSnapshotRepository";
import { MongoImportRunRepository } from "@/infrastructure/mongodb/repositories/MongoImportRunRepository";
import { MongoDataImportSettingsRepository } from "@/infrastructure/mongodb/repositories/MongoDataImportSettingsRepository";

export function buildConnectionService(db: Db): ConnectionService {
  return new ConnectionService({
    connectionRepository: new MongoPlatformConnectionRepository(db),
    credentialRepository: new MongoPlatformCredentialRepository(db),
    instagramConnector: new InstagramConnector(),
    facebookConnector: new FacebookConnector(),
    pinterestConnector: new PinterestConnector(),
  });
}

export function buildDataImportService(db: Db, connectionService: ConnectionService): DataImportService {
  return new DataImportService({
    connectionService,
    importedContentRepository: new MongoImportedContentRepository(db),
    performanceSnapshotRepository: new MongoPerformanceSnapshotRepository(db),
    importRunRepository: new MongoImportRunRepository(db),
    settingsRepository: new MongoDataImportSettingsRepository(db),
    instagramConnector: new InstagramConnector(),
    facebookConnector: new FacebookConnector(),
    pinterestConnector: new PinterestConnector(),
  });
}

export async function createServices(): Promise<{
  connectionService: ConnectionService;
  dataImportService: DataImportService;
}> {
  const db = await getDb();
  const connectionService = buildConnectionService(db);
  const dataImportService = buildDataImportService(db, connectionService);
  return { connectionService, dataImportService };
}
