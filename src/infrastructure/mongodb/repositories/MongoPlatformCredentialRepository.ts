import type { Db } from "mongodb";

import type { EncryptedCredential } from "@/domain/models/EncryptedCredential";
import type { PlatformCredentialRepository } from "@/domain/repositories/PlatformCredentialRepository";

// Private collection: never read by any API route response path, only
// by the application service that performs verify/reconnect operations.
export class MongoPlatformCredentialRepository implements PlatformCredentialRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<EncryptedCredential>("platformCredentials");
  }

  async save(record: EncryptedCredential): Promise<void> {
    await this.collection.updateOne(
      { connectionId: record.connectionId },
      { $set: record },
      { upsert: true },
    );
  }

  async findByConnectionId(connectionId: string): Promise<EncryptedCredential | null> {
    return this.collection.findOne({ connectionId }, { projection: { _id: 0 } });
  }

  async delete(connectionId: string): Promise<void> {
    await this.collection.deleteOne({ connectionId });
  }
}
