import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export class PasskeyCloneDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyCloneDetectedError';
  }
}

interface PendingChallenge {
  challenge: string;
  userId?: string;
  email?: string;
  rpId: string;
  expectedOrigin: string;
  purpose: 'registration' | 'authentication';
  expiresAt: number;
}

const CHALLENGE_STORE = new Map<string, PendingChallenge>();

export interface PasskeyRegistrationInput {
  userId: string;
  challenge: string;
  credentialId: string;
  publicKeyPem: string;
  clientDataJSONBase64Url: string;
  authenticatorDataBase64Url: string;
  deviceName?: string;
  transports?: string[];
}

export interface PasskeyAuthenticationInput {
  challenge: string;
  credentialId: string;
  clientDataJSONBase64Url: string;
  authenticatorDataBase64Url: string;
  signatureBase64Url: string;
}

export class WebAuthnPasskeyManager {
  constructor(
    private db: DatabaseInstance,
    private rpId: string = process.env.WEBAUTHN_RP_ID || 'localhost',
    private expectedOrigin: string = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000'
  ) {}

  static toBase64Url(buf: Buffer): string {
    return buf
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  static fromBase64Url(value: string): Buffer {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + '='.repeat(padLen), 'base64');
  }

  /**
   * Issues a single-use cryptographic challenge for FIDO2 / WebAuthn Passkey registration.
   */
  generateRegistrationOptions(user: { id: string; email: string; name: string }) {
    const challenge = WebAuthnPasskeyManager.toBase64Url(crypto.randomBytes(32));
    CHALLENGE_STORE.set(challenge, {
      challenge,
      userId: user.id,
      email: user.email,
      rpId: this.rpId,
      expectedOrigin: this.expectedOrigin,
      purpose: 'registration',
      expiresAt: Date.now() + 5 * 60_000,
    });

    return {
      challenge,
      rp: { name: 'AI Customer Service Console', id: this.rpId },
      user: {
        id: WebAuthnPasskeyManager.toBase64Url(Buffer.from(user.id, 'utf8')),
        name: user.email,
        displayName: user.name,
      },
      pubKeyCredParams: [
        { type: 'public-key' as const, alg: -7 }, // ES256 (ECDSA P-256)
        { type: 'public-key' as const, alg: -8 }, // EdDSA (Ed25519)
      ],
      timeout: 60000,
      attestation: 'none' as const,
      authenticatorSelection: {
        residentKey: 'preferred' as const,
        userVerification: 'preferred' as const,
      },
    };
  }

  /**
   * Verifies registration clientDataJSON + authenticatorData (RP ID hash & User Presence bit)
   * and persists the SPKI public key credential.
   */
  async verifyAndStoreRegistration(input: PasskeyRegistrationInput) {
    const pending = CHALLENGE_STORE.get(input.challenge);
    CHALLENGE_STORE.delete(input.challenge); // Single-use anti-replay

    if (!pending || pending.purpose !== 'registration' || pending.userId !== input.userId) {
      throw new Error('WebAuthnChallengeError: Invalid or already-consumed registration challenge.');
    }
    if (Date.now() > pending.expiresAt) {
      throw new Error('WebAuthnChallengeExpiredError: Registration challenge has expired.');
    }

    this.verifyClientDataAndAuthData(
      input.clientDataJSONBase64Url,
      input.authenticatorDataBase64Url,
      'webauthn.create',
      pending
    );

    const authData = WebAuthnPasskeyManager.fromBase64Url(input.authenticatorDataBase64Url);
    const initialSignCount = authData.readUInt32BE(33);

    // Validate that publicKeyPem is a valid asymmetric public key
    crypto.createPublicKey(input.publicKeyPem);

    const recordId = `pk_${crypto.randomUUID()}`;
    const [created] = await this.db
      .insert(schema.passkeyCredentials)
      .values({
        id: recordId,
        userId: input.userId,
        credentialId: input.credentialId,
        publicKeyPem: input.publicKeyPem,
        algorithm: 'ES256',
        signCount: initialSignCount,
        deviceName: input.deviceName || 'Hardware Passkey',
        transports: input.transports || ['internal', 'hybrid'],
      })
      .returning();

    return created;
  }

  /**
   * Issues a single-use cryptographic challenge for passwordless Passkey login.
   */
  async generateAuthenticationOptions(email?: string) {
    const challenge = WebAuthnPasskeyManager.toBase64Url(crypto.randomBytes(32));
    let allowCredentials: Array<{ id: string; type: 'public-key'; transports: any }> = [];
    let resolvedUserId: string | undefined;

    if (email) {
      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.toLowerCase().trim()));
      if (user) {
        resolvedUserId = user.id;
        const creds = await this.db
          .select()
          .from(schema.passkeyCredentials)
          .where(eq(schema.passkeyCredentials.userId, user.id));
        allowCredentials = creds.map((c) => ({
          id: c.credentialId,
          type: 'public-key',
          transports: c.transports,
        }));
      }
    }

    CHALLENGE_STORE.set(challenge, {
      challenge,
      userId: resolvedUserId,
      email,
      rpId: this.rpId,
      expectedOrigin: this.expectedOrigin,
      purpose: 'authentication',
      expiresAt: Date.now() + 5 * 60_000,
    });

    return {
      challenge,
      rpId: this.rpId,
      timeout: 60000,
      userVerification: 'preferred' as const,
      allowCredentials,
    };
  }

  /**
   * Verifies ECDSA P-256 / Ed25519 signature over authenticatorData || SHA256(clientDataJSON),
   * enforces monotonic signCount against cloned authenticators, and returns the authenticated userId.
   */
  async verifyAuthentication(input: PasskeyAuthenticationInput): Promise<{
    userId: string;
    credentialId: string;
    newSignCount: number;
  }> {
    const pending = CHALLENGE_STORE.get(input.challenge);
    CHALLENGE_STORE.delete(input.challenge); // Single-use anti-replay

    if (!pending || pending.purpose !== 'authentication') {
      throw new Error('WebAuthnChallengeError: Invalid or replayed authentication challenge.');
    }
    if (Date.now() > pending.expiresAt) {
      throw new Error('WebAuthnChallengeExpiredError: Authentication challenge expired.');
    }

    const [stored] = await this.db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.credentialId, input.credentialId));

    if (!stored) {
      throw new Error('WebAuthnCredentialNotFoundError: Unknown passkey credential.');
    }

    const { authData, clientDataRaw } = this.verifyClientDataAndAuthData(
      input.clientDataJSONBase64Url,
      input.authenticatorDataBase64Url,
      'webauthn.get',
      pending
    );

    // Verify cryptographic signature over authenticatorData || SHA256(clientDataJSON)
    const clientDataHash = crypto.createHash('sha256').update(clientDataRaw).digest();
    const signedPayload = Buffer.concat([authData, clientDataHash]);
    const signature = WebAuthnPasskeyManager.fromBase64Url(input.signatureBase64Url);

    const publicKey = crypto.createPublicKey(stored.publicKeyPem);
    const isValidSignature =
      publicKey.asymmetricKeyType === 'ed25519'
        ? crypto.verify(null, signedPayload, publicKey, signature)
        : crypto.verify('sha256', signedPayload, publicKey, signature);

    if (!isValidSignature) {
      throw new Error('WebAuthnSignatureInvalidError: Cryptographic passkey signature failed.');
    }

    const incomingSignCount = authData.readUInt32BE(33);
    if ((stored.signCount > 0 || incomingSignCount > 0) && incomingSignCount <= stored.signCount) {
      throw new PasskeyCloneDetectedError(
        `Authenticator clone suspected: incoming signCount (${incomingSignCount}) <= stored signCount (${stored.signCount}).`
      );
    }

    await this.db
      .update(schema.passkeyCredentials)
      .set({
        signCount: incomingSignCount,
        lastUsedAt: new Date(),
      })
      .where(eq(schema.passkeyCredentials.id, stored.id));

    return {
      userId: stored.userId,
      credentialId: stored.credentialId,
      newSignCount: incomingSignCount,
    };
  }

  async listUserPasskeys(userId: string) {
    return this.db
      .select({
        id: schema.passkeyCredentials.id,
        credentialId: schema.passkeyCredentials.credentialId,
        deviceName: schema.passkeyCredentials.deviceName,
        algorithm: schema.passkeyCredentials.algorithm,
        signCount: schema.passkeyCredentials.signCount,
        lastUsedAt: schema.passkeyCredentials.lastUsedAt,
        createdAt: schema.passkeyCredentials.createdAt,
      })
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.userId, userId));
  }

  async revokePasskey(userId: string, passkeyId: string): Promise<boolean> {
    const existing = await this.db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.id, passkeyId));

    if (!existing[0] || existing[0].userId !== userId) {
      return false;
    }
    await this.db
      .delete(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.id, passkeyId));
    return true;
  }

  /**
   * Builds binary WebAuthn authenticatorData (37 bytes: 32-byte rpIdHash + 1-byte flags + 4-byte signCount).
   */
  static buildAuthenticatorData(rpId: string, signCount: number, userPresent = true): Buffer {
    const rpIdHash = crypto.createHash('sha256').update(rpId, 'utf8').digest();
    const flags = Buffer.from([userPresent ? 0x05 : 0x00]); // UP (0x01) + UV (0x04)
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(signCount, 0);
    return Buffer.concat([rpIdHash, flags, counter]);
  }

  private verifyClientDataAndAuthData(
    clientDataJSONBase64Url: string,
    authenticatorDataBase64Url: string,
    expectedType: 'webauthn.create' | 'webauthn.get',
    pending: PendingChallenge
  ): { authData: Buffer; clientDataRaw: Buffer } {
    const clientDataRaw = WebAuthnPasskeyManager.fromBase64Url(clientDataJSONBase64Url);
    const clientData = JSON.parse(clientDataRaw.toString('utf8'));

    if (clientData.type !== expectedType) {
      throw new Error(`WebAuthnTypeMismatchError: Expected '${expectedType}', got '${clientData.type}'.`);
    }
    if (clientData.challenge !== pending.challenge) {
      throw new Error('WebAuthnChallengeMismatchError: ClientData challenge does not match.');
    }
    if (clientData.origin !== pending.expectedOrigin) {
      throw new Error(
        `WebAuthnOriginMismatchError: Expected origin '${pending.expectedOrigin}', got '${clientData.origin}'.`
      );
    }

    const authData = WebAuthnPasskeyManager.fromBase64Url(authenticatorDataBase64Url);
    if (authData.length < 37) {
      throw new Error('WebAuthnAuthDataError: Authenticator data must be at least 37 bytes.');
    }

    const expectedRpIdHash = crypto.createHash('sha256').update(pending.rpId, 'utf8').digest();
    const actualRpIdHash = authData.subarray(0, 32);
    if (!crypto.timingSafeEqual(expectedRpIdHash, actualRpIdHash)) {
      throw new Error('WebAuthnRpIdMismatchError: Authenticator RP ID hash mismatch.');
    }

    const flags = authData[32];
    const userPresent = (flags & 0x01) === 0x01;
    if (!userPresent) {
      throw new Error('WebAuthnUserPresenceError: User Presence (UP) flag was not asserted.');
    }

    return { authData, clientDataRaw };
  }
}
