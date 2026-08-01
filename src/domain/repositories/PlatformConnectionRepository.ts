import type { PlatformConnection } from "@/domain/models/PlatformConnection";

export interface PlatformConnectionRepository {
  list(): Promise<PlatformConnection[]>;
  findByConnectionId(connectionId: string): Promise<PlatformConnection | null>;
  upsert(connection: PlatformConnection): Promise<PlatformConnection>;
}
