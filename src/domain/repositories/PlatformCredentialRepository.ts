import type { EncryptedCredential } from "@/domain/models/EncryptedCredential";

export interface PlatformCredentialRepository {
  save(record: EncryptedCredential): Promise<void>;
  findByConnectionId(connectionId: string): Promise<EncryptedCredential | null>;
  delete(connectionId: string): Promise<void>;
}
