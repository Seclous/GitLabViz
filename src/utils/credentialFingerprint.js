// SHA-256 over UTF-8. Synchronous so credential changes invalidate views before
// Vue renders; only the digest is ever used in persistent storage keys.
export function credentialFingerprint(value = '') {
  const bytes = new TextEncoder().encode(value)
  const words = new Uint32Array(((bytes.length + 9 + 63) >> 6) * 16)
  bytes.forEach((b, i) => { words[i >> 2] |= b << (24 - (i % 4) * 8) })
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8)
  words[words.length - 1] = bytes.length * 8
  const primes = [], initial = [], constants = []
  for (let n = 2; primes.length < 64; n++) {
    if (primes.some(p => n % p === 0)) continue
    primes.push(n)
    if (initial.length < 8) initial.push((Math.sqrt(n) % 1 * 2 ** 32) >>> 0)
    constants.push((Math.cbrt(n) % 1 * 2 ** 32) >>> 0)
  }
  const h = initial, rotate = (x, n) => (x >>> n) | (x << (32 - n)), w = new Uint32Array(64)
  for (let start = 0; start < words.length; start += 16) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[start + i]
      else {
        const x = w[i - 15], y = w[i - 2]
        w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))
      }
    }
    let [a,b,c,d,e,f,g,j] = h
    for (let i = 0; i < 64; i++) {
      const t = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + w[i]) | 0
      const u = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      j=g; g=f; f=e; e=(d+t)|0; d=c; c=b; b=a; a=(t+u)|0
    }
    ;[a,b,c,d,e,f,g,j].forEach((v, i) => { h[i] = (h[i] + v) >>> 0 })
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('')
}
