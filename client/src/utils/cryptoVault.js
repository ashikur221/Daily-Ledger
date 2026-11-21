/**
 * Client-side Zero-Knowledge AES-GCM (256-bit) Encryption Utilities
 * Uses Web Crypto API (SubtleCrypto) native in modern browsers.
 * The master password never leaves your browser device.
 */

// Derive a 256-bit AES-GCM key from master password and salt using PBKDF2
async function deriveKey(masterPassword, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Convert ArrayBuffer to Base64
function bufferToBase64(buf) {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return window.btoa(bin);
}

// Convert Base64 to Uint8Array
function base64ToBuffer(b64) {
  const bin = window.atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    buf[i] = bin.charCodeAt(i);
  }
  return buf;
}

/**
 * Encrypt plain text using AES-256-GCM
 * Returns payload string: salt:iv:ciphertext
 */
export async function encryptSecret(plainText, masterPassword) {
  if (!plainText) return '';
  const enc = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterPassword, salt);

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plainText)
  );

  return `${bufferToBase64(salt)}:${bufferToBase64(iv)}:${bufferToBase64(ciphertext)}`;
}

/**
 * Decrypt cipher payload using master password
 */
export async function decryptSecret(payload, masterPassword) {
  if (!payload || !payload.includes(':')) return '';
  try {
    const [saltB64, ivB64, dataB64] = payload.split(':');
    const salt = base64ToBuffer(saltB64);
    const iv = base64ToBuffer(ivB64);
    const ciphertext = base64ToBuffer(dataB64);

    const key = await deriveKey(masterPassword, salt);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err) {
    throw new Error('Incorrect Master PIN / Password or corrupted data.');
  }
}
