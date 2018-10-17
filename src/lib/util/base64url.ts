function toBase64 (base64url: string) {
  return (base64url + '==='.slice((base64url.length + 3) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
}

function toBase64url (base64: string) {
  return base64.replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export function encode (data: string | Buffer): string {
  const buffer = (typeof data === 'string') ? Buffer.from(data, 'utf8') : data
  return toBase64url(buffer.toString('base64'))
}

export function decode (base64url: string): Buffer {
  return Buffer.from(toBase64(base64url), 'base64')
}
