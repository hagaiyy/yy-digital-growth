import type { EncryptedCredential } from "@/domain/models/EncryptedCredential";
import type { PlatformConnection } from "@/domain/models/PlatformConnection";
import type { PlatformConnectionRepository } from "@/domain/repositories/PlatformConnectionRepository";
import type { PlatformCredentialRepository } from "@/domain/repositories/PlatformCredentialRepository";

export class InMemoryPlatformConnectionRepository implements PlatformConnectionRepository {
  private readonly records = new Map<string, PlatformConnection>();

  async list(): Promise<PlatformConnection[]> {
    return Array.from(this.records.values());
  }

  async findByConnectionId(connectionId: string): Promise<PlatformConnection | null> {
    return this.records.get(connectionId) ?? null;
  }

  async upsert(connection: PlatformConnection): Promise<PlatformConnection> {
    // Full replace, matching MongoPlatformConnectionRepository's
    // replaceOne semantics: omitted optional fields must disappear.
    this.records.set(connection.connectionId, { ...connection });
    return connection;
  }
}

export class InMemoryPlatformCredentialRepository implements PlatformCredentialRepository {
  private readonly records = new Map<string, EncryptedCredential>();

  async save(record: EncryptedCredential): Promise<void> {
    this.records.set(record.connectionId, { ...record });
  }

  async findByConnectionId(connectionId: string): Promise<EncryptedCredential | null> {
    return this.records.get(connectionId) ?? null;
  }

  async delete(connectionId: string): Promise<void> {
    this.records.delete(connectionId);
  }
}
