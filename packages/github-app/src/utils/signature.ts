import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies the X-Hub-Signature-256 header from GitHub.
 * Returns true if the signature is valid.
 * 
 * @param secret - The webhook secret
 * @param payload - The raw request body
 * @param sig - The X-Hub-Signature-256 header value
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string | Buffer,
  sig: string
): boolean {
  const sigHashAlg = "sha256";
  const expectedSig = `sha256=${createHmac(sigHashAlg, secret)
    .update(payload)
    .digest("hex")}`;

  try {
    return timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(expectedSig)
    );
  } catch {
    return false;
  }
}
