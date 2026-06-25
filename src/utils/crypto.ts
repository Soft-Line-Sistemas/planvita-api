import crypto from 'crypto';
import config from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export function encryptText(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptText(cipherText: string): string {
  const [ivRaw, tagRaw, payloadRaw] = String(cipherText ?? '').split(':');
  if (!ivRaw || !tagRaw || !payloadRaw) {
    throw new Error('Cipher text inválido');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivRaw, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(payloadRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
