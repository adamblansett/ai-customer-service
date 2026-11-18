import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * RFC 6238 Time-Based One-Time Password (TOTP) Multi-Factor Authentication Manager.
 */
export class TotpMfaManager {
  public static generateEnrollment(email: string, issuer = 'AI Contact Center') {
    const secretBase32 = encodeBase32(crypto.randomBytes(20));
    const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
      email
    )}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    const backupCodes = Array.from({ length: 6 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    return {
      secretBase32,
      otpauthUri,
      backupCodes,
    };
  }

  public static generateTotpCode(secretBase32: string, timestampMs = Date.now()): string {
    const key = decodeBase32(secretBase32);
    const counter = Math.floor(timestampMs / 1000 / 30);
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(counter));

    const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = binary % 1_000_000;
    return String(otp).padStart(6, '0');
  }

  /**
   * Verifies a 6-digit TOTP code in constant time across ±window 30s steps.
   */
  public static verifyTotpCode(
    secretBase32: string,
    providedCode: string,
    timestampMs = Date.now(),
    windowSteps = 1
  ): boolean {
    const cleanCode = (providedCode || '').trim();
    if (!/^\d{6}$/.test(cleanCode)) return false;

    for (let step = -windowSteps; step <= windowSteps; step++) {
      const candidate = this.generateTotpCode(secretBase32, timestampMs + step * 30_000);
      if (
        crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(cleanCode, 'utf8'))
      ) {
        return true;
      }
    }
    return false;
  }
}
