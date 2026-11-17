import { ApiError } from '@/lib/api'
import { chooseStorage, S3Storage } from '@/lib/storage'

/** Only photos accepted by Mudaala's moderated upload pipeline may be used. */
export function assertUploadedShowroomPhotos(urls: Array<string | null | undefined>) {
  const values = urls.filter((value): value is string => Boolean(value))
  if (values.length === 0) return
  const storage = chooseStorage()
  const invalid = values.some((url) => {
    if (storage instanceof S3Storage) return storage.objectKeyFor(url) === null
    return !url.startsWith('/uploads/')
  })
  if (invalid) throw new ApiError(400, 'Choose photos uploaded through Mudaala. External photo links are not accepted.')
}
