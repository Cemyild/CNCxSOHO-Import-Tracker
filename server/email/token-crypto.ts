import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.EMAIL_TOKEN_ENC_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "EMAIL_TOKEN_ENC_KEY tanımlı değil veya 64 karakterlik hex değil. " +
        "Üretmek için: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

export function isTokenCryptoConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(process.env.EMAIL_TOKEN_ENC_KEY ?? "");
}

/** "iv:authTag:ciphertext", hepsi base64. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptToken(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Şifreli token biçimi geçersiz");
  const [iv, tag, data] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
