import { describe, test, expect } from 'bun:test'
import {
  sniffFileType,
  isValidStoredFileId,
  sanitizeDisplayFilename,
  validateUploadBytes,
  readImageDimensions,
  ADMISSION_UPLOAD_POLICY,
  TEACHER_UPLOAD_POLICY,
} from '@/lib/security/upload'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20, // IHDR 32x32
  0x08, 0x06, 0x00, 0x00, 0x00,
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
])
const TEXT = Buffer.from('definitely not an image, just text pretending')

describe('magic-byte (file signature) verification', () => {
  test('identifies real content by leading bytes', () => {
    expect(sniffFileType(PNG)).toBe('png')
    expect(sniffFileType(JPEG)).toBe('jpeg')
    expect(sniffFileType(PDF)).toBe('pdf')
    expect(sniffFileType(WEBP)).toBe('webp')
  })
  test('rejects renamed/fake files', () => {
    expect(sniffFileType(TEXT)).toBeNull()
    expect(sniffFileType(Buffer.alloc(0))).toBeNull()
    expect(sniffFileType(Buffer.from([0xff, 0xd8]))).toBeNull() // truncated SOI
  })
  test('decoded image dimensions come from the real header', () => {
    expect(readImageDimensions(PNG, 'png')).toEqual({ width: 32, height: 32 })
  })
})

describe('stored-id validation (traversal-proof)', () => {
  test('accepts server-minted opaque ids', () => {
    expect(isValidStoredFileId('lxyz1234-abc123def.jpg', ['jpg', 'png', 'webp'])).toBe(true)
    expect(isValidStoredFileId('m0r1e2-photo.png', ['png'])).toBe(true)
  })
  test('rejects traversal, wrong extension, junk', () => {
    for (const bad of [
      '../../etc/passwd',
      '..\\windows\\file.jpg',
      'photo.jpg/../../../x.png',
      'photo.exe',
      'photo.jpg%00.png',
      'a.b.c.jpg',
      '.jpg',
      'photo.JPG.jpg',
    ]) {
      expect(isValidStoredFileId(bad, ['jpg', 'png', 'webp'])).toBe(false)
    }
  })
})

describe('central upload policies', () => {
  test('admission policy: PDF/JPG/PNG at 5MB', () => {
    expect(ADMISSION_UPLOAD_POLICY.allowedTypes).toEqual(['pdf', 'jpeg', 'png'])
    expect(ADMISSION_UPLOAD_POLICY.maxBytes).toBe(5 * 1024 * 1024)
  })
  test('teacher policy: JPG/PNG/WebP, photo 2MB / signature 1MB', () => {
    expect(TEACHER_UPLOAD_POLICY.allowedTypes).toEqual(['jpeg', 'png', 'webp'])
    expect(TEACHER_UPLOAD_POLICY.photoMaxBytes).toBe(2 * 1024 * 1024)
    expect(TEACHER_UPLOAD_POLICY.signatureMaxBytes).toBe(1024 * 1024)
  })
})

describe('validateUploadBytes', () => {
  test('rejects oversized payloads regardless of client claims', () => {
    const r = validateUploadBytes(PNG, { allowedTypes: ['png'], maxBytes: 8 })
    expect(r?.status).toBe(413)
  })
  test('rejects bytes that do not match the allowlist (renamed file)', () => {
    const r = validateUploadBytes(TEXT, { allowedTypes: ['pdf', 'jpeg', 'png'], maxBytes: 5 * 1024 * 1024 })
    expect(r?.status).toBe(415)
    // a PNG where only PDF is allowed also fails
    const r2 = validateUploadBytes(PNG, { allowedTypes: ['pdf'], maxBytes: 5 * 1024 * 1024 })
    expect(r2?.status).toBe(415)
  })
  test('accepts policy-conforming bytes', () => {
    expect(validateUploadBytes(PNG, { allowedTypes: ['png'], maxBytes: 1024 })).toBeNull()
    expect(validateUploadBytes(PDF, { allowedTypes: ['pdf', 'jpeg', 'png'], maxBytes: 5 * 1024 * 1024 })).toBeNull()
  })
  test('empty files are rejected', () => {
    expect(validateUploadBytes(Buffer.alloc(0), { allowedTypes: ['png'], maxBytes: 1024 })?.status).toBe(400)
  })
})

describe('display-filename sanitization (metadata echo only)', () => {
  test('strips path components', () => {
    expect(sanitizeDisplayFilename('/etc/passwd')).toBe('passwd')
    expect(sanitizeDisplayFilename('C:\\Users\\x\\report.pdf')).toBe('report.pdf')
  })
  test('strips control characters and shell metacharacters', () => {
    expect(sanitizeDisplayFilename('bad\u0000name.png')).toBe('badname.png')
    expect(sanitizeDisplayFilename('a;b|c`d$e.png')).toBe('abcde.png')
    expect(sanitizeDisplayFilename('<script>.png')).toBe('script.png')
  })
  test('caps length and never returns empty', () => {
    expect(sanitizeDisplayFilename('x'.repeat(500)).length).toBeLessThanOrEqual(120)
    expect(sanitizeDisplayFilename('')).toBe('file')
    expect(sanitizeDisplayFilename(null)).toBe('file')
  })
})
