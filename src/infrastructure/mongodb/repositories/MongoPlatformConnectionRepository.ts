import type { Db } from "mongodb";

import type { PlatformConnection } from "@/domain/models/PlatformConnection";
import type { PlatformConnectionRepository } from "@/domain/repositories/PlatformConnectionRepository";

export class MongoPlatformConnectionRepository implements PlatformConnectionRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<PlatformConnection>("platformConnections");
  }

  async list(): Promise<PlatformConnection[]> {
    return this.collection.find({}, { projection: { _id: 0 } }).toArray();
  }

  async findByConnectionId(connectionId: string): Promise<PlatformConnection | null> {
    return this.collection.findOne({ connectionId }, { projection: { _id: 0 } });
  }

  async upsert(connection: PlatformConnection): Promise<PlatformConnection> {
    // Full-document replace, not $set: callers always pass a complete
    // record, and optional fields intentionally omitted (e.g. cleared on
    // disconnect) must actually disappear from the stored document
    // rather than leaving stale values behind.
    await this.collection.replaceOne(
      { connectionId: connection.connectionId },
      connection,
      { upsert: true },
    );
    return connection;
  }
}
