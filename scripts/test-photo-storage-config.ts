import assert from 'node:assert/strict'
import { chooseStorage } from '../src/lib/storage'

assert.equal(chooseStorage({}).name, 'local-disk')
assert.equal(
  chooseStorage({
    NODE_ENV: 'production',
    STORAGE_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
    STORAGE_BUCKET: 'mudaala-photos',
    STORAGE_KEY: 'test-key',
    STORAGE_SECRET: 'test-secret',
  }).name,
  's3-compatible',
)
assert.throws(
  () => chooseStorage({ NODE_ENV: 'production' }),
  /Production photo storage is not configured/,
)
assert.throws(
  () => chooseStorage({
    NODE_ENV: 'production',
    STORAGE_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
    STORAGE_BUCKET: 'mudaala-photos',
    STORAGE_KEY: 'test-key',
  }),
  /Production photo storage is not configured/,
)
console.log('Photo storage configuration checks passed.')
