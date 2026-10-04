import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/* Passwords are stored as scrypt hashes with a per-user salt:
   `scrypt$N$r$p$salt$hash`, all parameters in the string so they
   can be raised later without invalidating existing accounts. */

const N = 2 ** 15
const R = 8
const P = 1
const KEYLEN = 64

function derive(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const key = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Twelve characters at least, and not one of the obvious ones. */
export function passwordProblem(password: string, email = ''): string | null {
  if (password.length < 12) return 'Use at least 12 characters.'
  if (password.length > 256) return 'Use at most 256 characters.'
  const lower = password.toLowerCase()
  if (email && lower.includes(email.toLowerCase().split('@')[0])) return 'Do not include your email name in the password.'
  if (/^(.)\1+$/.test(password) || ['password', 'admin', 'qwerty', '123456'].some((w) => lower.includes(w))) return 'Choose a less predictable password.'
  return null
}
