// mhd-manager · Authentifizierung: scrypt-Hashing, Sessions, Brute-Force-Sperre
// Warum scrypt und nicht argon2: argon2id braucht ein natives Modul oder Node >= 22.7
// mit Memory-Limits. scrypt ist in Node eingebaut, speicherhart und hier ausreichend.
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Parameter nach OWASP-Empfehlung für scrypt: N=2^15, r=8, p=3.
// Achtung: Node prüft gegen maxmem mit Standard 32 MiB; scrypt braucht hier
// ~128 * N * r = 32 MiB plus Overhead. Ohne erhöhtes maxmem wirft Node
// "memory limit exceeded". Deshalb maxmem explizit anheben.
const N = 32768;
const R = 8;
const P = 3;
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024; // 256 MiB Luft für 128*N*r

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scryptAsync(
      password.normalize('NFKC'), salt, expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM }
    );
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Signierte Session-ID: zufällig + HMAC, damit ein geratenes Token nicht genügt. */
export function newSessionToken(secret) {
  const raw = randomBytes(32).toString('base64url');
  const sig = createHmac('sha256', secret).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

export function isValidSessionToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [raw, sig] = token.split('.');
  if (!raw || !sig) return false;
  const expect = createHmac('sha256', secret).update(raw).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Brute-Force-Bremse: zählt Fehlversuche je IP und je Benutzername.
 * Nach `maxAttempts` Fehlschlägen im Fenster wird gesperrt — und die Sperre
 * verdoppelt sich mit jeder weiteren Sperre (max. 24 h).
 */
export class LoginLimiter {
  constructor({ maxAttempts = 5, windowMs = 15 * 60_000, baseLockMs = 15 * 60_000, maxLockMs = 24 * 3600_000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.baseLockMs = baseLockMs;
    this.maxLockMs = maxLockMs;
    this.hits = new Map(); // key -> { count, first, lockedUntil, strikes }
  }

  #entry(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e) {
      e = { count: 0, first: now, lockedUntil: 0, strikes: 0 };
      this.hits.set(key, e);
    }
    // Zähler-Fenster abgelaufen → zurücksetzen (Sperre bleibt bestehen)
    if (now - e.first > this.windowMs && now > e.lockedUntil) {
      e.count = 0;
      e.first = now;
    }
    return e;
  }

  /** Restliche Sperrzeit in Sekunden (0 = nicht gesperrt). */
  lockedFor(keys) {
    const now = Date.now();
    let until = 0;
    for (const key of keys) {
      const e = this.hits.get(key);
      if (e && e.lockedUntil > now) until = Math.max(until, e.lockedUntil);
    }
    return until ? Math.ceil((until - now) / 1000) : 0;
  }

  fail(keys) {
    const now = Date.now();
    let lockSeconds = 0;
    for (const key of keys) {
      const e = this.#entry(key);
      e.count += 1;
      if (e.count >= this.maxAttempts) {
        e.strikes += 1;
        const lockMs = Math.min(this.baseLockMs * 2 ** (e.strikes - 1), this.maxLockMs);
        e.lockedUntil = now + lockMs;
        e.count = 0;
        e.first = now;
        lockSeconds = Math.max(lockSeconds, Math.ceil(lockMs / 1000));
      }
    }
    return lockSeconds;
  }

  reset(keys) {
    for (const key of keys) this.hits.delete(key);
  }

  /** Periodisch alte Einträge entfernen, damit der Speicher nicht wächst. */
  sweep() {
    const now = Date.now();
    for (const [key, e] of this.hits) {
      if (now > e.lockedUntil && now - e.first > this.windowMs) this.hits.delete(key);
    }
  }
}
