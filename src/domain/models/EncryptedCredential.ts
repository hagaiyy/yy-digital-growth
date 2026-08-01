// Private, encrypted-at-rest credential envelope. Never returned by any
// API route and never rendered in the UI. The ciphertext payload is the
// only place platform tokens/secrets exist outside of process memory.
export interface EncryptedCredential {
  connectionId: string;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}
