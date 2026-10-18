// Mudaala - photo storage behind one interface.
//
// Development writes photos to the local disk (public/uploads, served
// statically by Next). Production points at any S3-compatible bucket -
// Cloudflare R2, Supabase Storage, MinIO - using the STORAGE_* environment
// variables. Call sites (today: the upload route; the URL-migration script)
// never know which one is behind the interface, and the choice is made per
// process from the environment, so flipping a deployment from disk to bucket
// needs no code change.
//
// The S3 provider uses the AWS SDK for SigV4 signing and S3-compatible PUT/DELETE.
// Path-style URLs (endpoint/bucket/key) work with R2, Supabase's S3 gateway
// and MinIO alike.

import { createHash, createHmac } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export interface PhotoStorage {
  /** Human-readable provider name for logs and health reporting. */
  readonly name: string
  /** Persist one validated photo; resolves with its PUBLIC url. */
  save(data: Buffer, extension: string): Promise<string>
  /** Persist a WebP feed thumbnail beside its original, using a predictable sibling key. */
  saveThumbnail(originalUrl: string, data: Buffer): Promise<void>
  /** Delete one stored photo by its public URL. A URL this provider does not
   *  own resolves quietly; an already-deleted object too - deletion is
   *  idempotent because account deletion must never fail on a missing file. */
  remove(url: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Local disk (development default)
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

export class LocalDiskStorage implements PhotoStorage {
  readonly name = 'local-disk'

  async save(data: Buffer, extension: string): Promise<string> {
    const name = `${randomBytes(4).toString('hex')}-${randomBytes(8).toString('hex')}.${extension}`
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    await fs.writeFile(path.join(UPLOAD_DIR, name), data)
    return `/uploads/${name}`
  }

  async saveThumbnail(originalUrl: string, data: Buffer): Promise<void> {
    if (!originalUrl.startsWith('/uploads/')) throw new Error('Thumbnail URL is not a local upload')
    const name = originalUrl.slice('/uploads/'.length)
    if (!name || name.includes('/') || name.includes('..')) throw new Error('Invalid local photo URL')
    const stem = name.replace(/\.[^.]+$/, '')
    await fs.writeFile(path.join(UPLOAD_DIR, `${stem}.thumb.webp`), data)
  }

  async remove(url: string): Promise<void> {
    // Only bare filenames inside UPLOAD_DIR are ours - anything with a path
    // separator or traversal is not a file this provider wrote, so it is
    // ignored rather than chased.
    const name = url.split('/').pop() ?? ''
    if (!name || name.includes('..') || name.includes('/') || !url.startsWith('/uploads/')) return
    await fs.rm(path.join(UPLOAD_DIR, name), { force: true })
    const stem = name.replace(/\.[^.]+$/, '')
    await fs.rm(path.join(UPLOAD_DIR, `${stem}.thumb.webp`), { force: true })
  }
}

// ---------------------------------------------------------------------------
// S3-compatible (Cloudflare R2, Supabase Storage, MinIO, AWS itself)
// ---------------------------------------------------------------------------

export interface S3Env {
  endpoint: string // e.g. https://<account>.r2.cloudflarestorage.com or a Supabase S3 URL
  bucket: string
  key: string
  secret: string
  publicUrl?: string // where saved objects are publicly served, e.g. https://cdn.example
  region?: string // Must match the Supabase project's configured region
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

/** AWS SigV4 canonical signature for one request - exported for unit tests. */
export function signS3Request(
  env: S3Env,
  method: 'PUT' | 'DELETE',
  objectKey: string,
  payloadHash: string,
  now = new Date(),
): { authorization: string; amzDate: string; payloadHash: string; host: string; path: string } {
  const host = new URL(env.endpoint).host
  const region = env.region ?? 'auto'
  const service = 's3'
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}` // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  // SigV4 signs the RFC3986-encoded URI path. Keep `/` separators but encode
  // each path segment so the canonical request is identical to what fetch sends.
  const encodePathSegment = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  const path = `/${encodePathSegment(env.bucket)}/${objectKey.split('/').map(encodePathSegment).join('/')}`

  const canonicalRequest = [
    method,
    path,
    '',
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.secret}`, dateStamp), region), service), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${env.key}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`
  return { authorization, amzDate, payloadHash, host, path }
}

const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex')

/** AWS SigV4 canonical signature for one PUT - exported for unit tests. */
export function signS3Put(
  env: S3Env,
  objectKey: string,
  payload: Buffer,
  now = new Date(),
): { authorization: string; amzDate: string; payloadHash: string; host: string; path: string } {
  return signS3Request(env, 'PUT', objectKey, createHash('sha256').update(payload).digest('hex'), now)
}

export class S3Storage implements PhotoStorage {
  readonly name = 's3-compatible'
  private readonly client: S3Client

  constructor(private readonly env: S3Env) {
    // Let the AWS SDK own SigV4 signing. Supabase's S3 gateway is AWS-S3
    // compatible, and the SDK handles canonical URI/header rules reliably.
    this.client = new S3Client({
      region: env.region ?? 'eu-west-2',
      endpoint: env.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.key,
        secretAccessKey: env.secret,
      },
    })
  }

  /** PUT one object; exported so the one-off URL-migration script reuses it. */
  async put(
    objectKey: string,
    data: Buffer,
    contentType = 'image/webp',
    cacheControl = 'public, max-age=31536000, immutable',
  ): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.env.bucket,
        Key: objectKey,
        Body: data,
        ContentType: contentType,
        CacheControl: cacheControl,
      }))
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 500) : 'unknown S3 error'
      console.error(`[photo-storage] Supabase S3 PUT rejected: ${detail}`)
      throw new Error('S3 put failed')
    }
  }
  async save(data: Buffer, extension: string): Promise<string> {
    const key = `photos/${randomBytes(4).toString('hex')}-${randomBytes(8).toString('hex')}.${extension}`
    const contentType = extension === 'jpg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : 'image/webp'
    await this.put(key, data, contentType)
    return this.publicUrlFor(key)
  }

  async saveThumbnail(originalUrl: string, data: Buffer): Promise<void> {
    const key = this.objectKeyFor(originalUrl)
    if (!key) throw new Error('Thumbnail URL is not owned by this storage provider')
    const thumbnailKey = key.replace(/\.[^.]+$/, '.thumb.webp')
    await this.put(thumbnailKey, data, 'image/webp')
  }

  async remove(url: string): Promise<void> {
    const key = this.objectKeyFor(url)
    if (!key) return
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.env.bucket,
        Key: key,
      }))
      // Thumbnails are immutable siblings of uploaded originals.
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.env.bucket,
        Key: key.replace(/\.[^.]+$/, '.thumb.webp'),
      }))
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 500) : 'unknown S3 error'
      console.error(`[photo-storage] Supabase S3 DELETE rejected: ${detail}`)
      throw new Error('S3 delete failed')
    }
  }
  /** Resolve the public media base separately from the S3 API endpoint. */
  private publicBase(): string {
    const endpoint = new URL(this.env.endpoint)
    const configured = this.env.publicUrl?.trim()

    if (endpoint.hostname.endsWith('.supabase.co')) {
      const correctPublicBase = endpoint.origin + '/storage/v1/object/public/' + this.env.bucket
      if (configured) {
        const publicUrl = new URL(configured)
        // If a Supabase URL was configured using the S3 API path, normalize it
        // to the public-object route. Preserve a valid public URL or custom CDN.
        if (publicUrl.hostname === endpoint.hostname && /\/storage\/v1\/s3(?:\/|$)/.test(publicUrl.pathname)) {
          return correctPublicBase
        }
        if (publicUrl.hostname === endpoint.hostname && /\/storage\/v1\/object\/public\//.test(publicUrl.pathname)) {
          return publicUrl.toString().replace(/\/$/, '')
        }
        if (publicUrl.hostname !== endpoint.hostname) return configured.replace(/\/$/, '')
        if (publicUrl.pathname === '/' || publicUrl.pathname.endsWith('/' + this.env.bucket)) {
          return correctPublicBase
        }
        return configured.replace(/\/$/, '')
      }
      if (/\/storage\/v1\/s3\/?$/.test(endpoint.pathname)) return correctPublicBase
    }

    if (configured) return configured.replace(/\/$/, '')
    return this.env.endpoint.replace(/\/$/, '') + '/' + this.env.bucket
  }

  /** The object key behind a public URL, or null when the URL is not ours. */
  objectKeyFor(url: string): string | null {
    const bases = [this.publicBase(), this.env.endpoint.replace(/\/$/, '') + '/' + this.env.bucket]
    for (const base of bases) {
      if (url.startsWith(base + '/')) return url.slice(base.length + 1)
    }
    return null
  }

  /** The public URL an object is served from (media host + key). */
  publicUrlFor(objectKey: string): string {
    return this.publicBase() + '/' + objectKey
  }
}

// ---------------------------------------------------------------------------
// Provider choice - pure function so the suite can pin it
// ---------------------------------------------------------------------------

export function readStorageEnv(env: Record<string, string | undefined> = process.env): S3Env | null {
  const endpoint = env.STORAGE_ENDPOINT?.trim()
  const bucket = env.STORAGE_BUCKET?.trim()
  const key = env.STORAGE_KEY?.trim()
  const secret = env.STORAGE_SECRET?.trim()
  if (!endpoint || !bucket || !key || !secret) return null
  return {
    endpoint: endpoint.replace(/\/$/, ''),
    bucket,
    key,
    secret,
    publicUrl: env.STORAGE_PUBLIC_URL?.trim() || undefined,
    region: env.STORAGE_REGION?.trim() || 'eu-west-2',
  }
}

export function chooseStorage(env: Record<string, string | undefined> = process.env): PhotoStorage {
  const s3 = readStorageEnv(env)
  if (s3) return new S3Storage(s3)

  // Local disk is only durable for local development. In Cloudflare Workers,
  // silently accepting a write to local disk can return a /uploads URL that
  // is not persisted across requests. Fail clearly rather than fake success.
  if (env.NODE_ENV === 'production') {
    throw new Error('Production photo storage is not configured: STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_KEY and STORAGE_SECRET are required')
  }

  return new LocalDiskStorage()
}
