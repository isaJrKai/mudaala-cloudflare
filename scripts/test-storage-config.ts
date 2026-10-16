import assert from 'node:assert/strict'
import { chooseStorage } from '../src/lib/storage'

assert.equal(chooseStorage({}).name, 'local-disk', 'local development keeps the disk provider')
assert.equal(
  chooseStorage({
    NODE_ENV: 'production',
    STORAGE_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
    STORAGE_BUCKET: 'mudaala-photos',
    STORAGE_KEY: 'test-key',
    STORAGE_SECRET: 'test-secret',
  }).name,
  's3-compatible',
  'fully configured production media storage uses the S3-compatible provider',
)

assert.throws(
  () => chooseStorage({ NODE_ENV: 'production' }),
  /Production photo storage is not configured/,
  'production must not silently return non-durable /uploads URLs',
)
assert.throws(
  () => chooseStorage({
    NODE_ENV: 'production',
    STORAGE_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
    STORAGE_BUCKET: 'mudaala-photos',
    STORAGE_KEY: 'test-key',
  }),
  /Production photo storage is not configured/,
  'partially configured production storage must fail closed',
)

console.log('Media storage configuration checks passed.')
