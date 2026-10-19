// WebCrypto utilities for passphrase-encrypted exports.
// AES-GCM with PBKDF2-derived key (Argon2 is not yet universally available in
// WebCrypto, so we use PBKDF2 with a high iteration count).

const PBKDF2_ITERATIONS = 250_000;
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes for AES-GCM
const KEY_LENGTH = 256; // bits

interface EncryptedHeader {
  encrypted: true;
  kdf: "PBKDF2";
  kdf_params: {
    iterations: number;
    salt: string; // base64
    hash: "SHA-256";
  };
  iv: string; // base64
  cipher: "AES-GCM";
}

export interface EncryptedBlob {
  encrypted: true;
  header: EncryptedHeader;
  ciphertext: string; // base64
}

export interface PlaintextBlob {
  encrypted: false;
  data: unknown;
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}

export async function encryptJson(data: unknown, passphrase: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    encrypted: true,
    header: {
      encrypted: true,
      kdf: "PBKDF2",
      kdf_params: {
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(salt),
        hash: "SHA-256",
      },
      iv: toBase64(iv),
      cipher: "AES-GCM",
    },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptJson(blob: EncryptedBlob, passphrase: string): Promise<unknown> {
  if (!blob.encrypted) throw new Error("Not an encrypted blob");
  const salt = fromBase64(blob.header.kdf_params.salt);
  const iv = fromBase64(blob.header.iv);
  const key = await deriveKey(passphrase, salt);
  const ciphertext = fromBase64(blob.ciphertext);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(plaintext));
  } catch {
    throw new Error("Decryption failed. Wrong passphrase or corrupted file.");
  }
}
