import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // Standard 96-bit IV for AES-GCM
const AUTH_TAG_LENGTH_BYTES = 16; // Standard 128-bit auth tag

export interface EncryptedPayload {
  encryptedData: string; // Hex string
  iv: string; // Hex string
  authTag: string; // Hex string
  keyVersion: number;
}

/**
 * Returns the 32-byte binary key derived from the master key string.
 */
function deriveKey(masterKeyString: string): Buffer {
  if (!masterKeyString) {
    throw new Error('ENCRYPTION_MASTER_KEY is not defined. Secure credential encryption requires a master key.');
  }
  // Use SHA-256 to ensure exact 32-byte key length regardless of input format
  return crypto.createHash('sha256').update(masterKeyString).digest();
}

/**
 * Encrypts arbitrary sensitive text (e.g. BYOK API keys, SIP passwords) using AES-256-GCM.
 * Generates a unique 96-bit random IV for every encryption.
 */
export function encryptCredential(
  plaintext: string,
  masterKey: string = process.env.ENCRYPTION_MASTER_KEY || 'default-insecure-dev-master-key-change-in-production-12345',
  keyVersion = 1,
  aad = ''
): EncryptedPayload {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  if (aad) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    keyVersion,
  };
}

/**
 * Decrypts AES-256-GCM encrypted credential payload.
 * Verifies authenticity via GCM authentication tag.
 * Throws if authentication fails or data is tampered.
 */
export function decryptCredential(
  payload: EncryptedPayload,
  masterKey: string = process.env.ENCRYPTION_MASTER_KEY || 'default-insecure-dev-master-key-change-in-production-12345',
  aad = ''
): string {
  const key = deriveKey(masterKey);
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const encryptedText = Buffer.from(payload.encryptedData, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  decipher.setAuthTag(authTag);

  if (aad) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }

  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Creates a safe masked string for display (e.g. "sk-...1234" or "AC...7890").
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length <= 8) {
    return '••••••••';
  }
  const prefix = secret.slice(0, 3);
  const suffix = secret.slice(-4);
  return `${prefix}...${suffix}`;
}
