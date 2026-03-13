import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies the X-Hub-Signature-256 header from GitHub.
 * Returns true if the signature is valid.
 *
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature) return false;

  const sigHashAlg = "sha256";
  const expectedSig = `sha256=${createHmac(sigHashAlg, secret)
    .update(payload)
    .digest("hex")}`;

  try {
    // Ensure equal length before comparison to avoid timingSafeEqual length errors
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
