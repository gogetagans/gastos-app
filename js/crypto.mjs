const cryptoApi = () => {
  const api = globalThis.crypto;
  if (!api?.subtle) throw new Error("Este entorno no tiene WebCrypto.");
  return api;
};

export const KDF = "PBKDF2-SHA256";
export const CIPHER = "AES-GCM";
export const ITERATIONS = 310000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export function bytesToB64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step));
  }
  return btoa(binary);
}

export function b64ToBytes(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  cryptoApi().getRandomValues(bytes);
  return bytes;
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("El archivo cifrado no tiene el formato esperado.");
  }
  if (envelope.version !== 1) throw new Error("Versión de archivo cifrado no reconocida.");
  if (envelope.kdf !== KDF || envelope.cipher !== CIPHER) {
    throw new Error("El cifrado del archivo no es AES-GCM con PBKDF2-SHA256.");
  }
  if (!Number.isInteger(envelope.iterations) || envelope.iterations < ITERATIONS) {
    throw new Error(`Hacen falta al menos ${ITERATIONS} iteraciones de PBKDF2.`);
  }
  if (envelope.keyBits != null && envelope.keyBits !== 256) {
    throw new Error("La clave tiene que ser de 256 bits.");
  }
  const salt = b64ToBytes(envelope.salt || "");
  const iv = b64ToBytes(envelope.iv || "");
  const ciphertext = b64ToBytes(envelope.ciphertext || "");
  if (salt.length < SALT_BYTES) throw new Error("La sal del archivo es demasiado corta.");
  if (iv.length !== IV_BYTES) throw new Error("El vector de inicialización no es válido.");
  if (ciphertext.length < 16) throw new Error("El archivo cifrado está incompleto.");
  return { salt, iv, ciphertext };
}

async function deriveKey(password, salt, iterations) {
  const api = cryptoApi();
  const baseKey = await api.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return api.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function decryptWithKey(key, envelope) {
  const { iv, ciphertext } = validateEnvelope(envelope);
  let plain;
  try {
    plain = await cryptoApi().subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new Error("Contraseña incorrecta o archivo dañado.");
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("El contenido descifrado no es un JSON de gastos.");
  }
  if (!data || !Array.isArray(data.groups)) {
    throw new Error("El archivo no contiene la lista de grupos.");
  }
  return data;
}

export async function openEnvelope(password, envelope) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Introduce tu contraseña.");
  }
  const { salt } = validateEnvelope(envelope);
  const key = await deriveKey(password, salt, envelope.iterations);
  const data = await decryptWithKey(key, envelope);
  return { data, key, salt, iterations: envelope.iterations };
}

export async function sealDataset(password, dataset, existing = {}) {
  if (!existing.key && (typeof password !== "string" || password.length === 0)) {
    throw new Error("Falta la contraseña.");
  }
  const iterations = existing.iterations || ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < ITERATIONS) {
    throw new Error(`Hacen falta al menos ${ITERATIONS} iteraciones de PBKDF2.`);
  }
  const salt = existing.salt || randomBytes(SALT_BYTES);
  if (salt.length < SALT_BYTES) throw new Error("La sal es demasiado corta.");
  const key = existing.key || (await deriveKey(password, salt, iterations));
  const iv = randomBytes(IV_BYTES);
  const encoded = new TextEncoder().encode(JSON.stringify(dataset));
  const cipher = new Uint8Array(
    await cryptoApi().subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
  );
  const envelope = {
    version: 1,
    kdf: KDF,
    cipher: CIPHER,
    keyBits: 256,
    iterations,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(cipher),
  };
  return { envelope, key, salt, iterations };
}
