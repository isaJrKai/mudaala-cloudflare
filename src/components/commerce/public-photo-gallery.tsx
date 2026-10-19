'use client'

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PublicPhotoGalleryProps {
  photos: string[]
  title: string
}

export function PublicPhotoGallery({ photos, title }: PublicPhotoGalleryProps) {
  const galleryRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  function movePhoto(direction: -1 | 1) {
    const gallery = galleryRef.current
    if (!gallery) return
    const nextIndex = Math.min(photos.length - 1, Math.max(0, activeIndex + direction))
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    gallery.scrollTo({
      left: nextIndex * gallery.clientWidth,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  if (photos.length === 0) return null

  return (
    <section className="relative" aria-label={`Photos of ${title}`}>
      <div
        ref={galleryRef}
        className="flex h-[min(70vh,560px)] min-h-72 snap-x snap-mandatory overflow-x-auto scroll-smooth scrollbar-slim bg-background motion-reduce:scroll-auto"
        role="region"
        aria-roledescription="carousel"
        onScroll={(event) => {
          const gallery = event.currentTarget
          if (gallery.clientWidth > 0) {
            setActiveIndex(Math.min(photos.length - 1, Math.max(0, Math.round(gallery.scrollLeft / gallery.clientWidth))))
          }
        }}
      >
        {photos.map((photo, index) => (
          <div key={photo} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
            <img
              src={photo}
              alt={`${title} - photo ${index + 1} of ${photos.length}`}
              loading={index === 0 ? 'eager' : 'lazy'}
              className="size-full object-contain"
            />
          </div>
        ))}
      </div>

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => movePhoto(-1)}
            disabled={activeIndex === 0}
            aria-label="Previous product photo"
            className="absolute left-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card/95 text-foreground shadow-sm transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => movePhoto(1)}
            disabled={activeIndex === photos.length - 1}
            aria-label="Next product photo"
            className="absolute right-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card/95 text-foreground shadow-sm transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <span
            className="absolute bottom-3 right-3 rounded-full bg-black/75 px-2.5 py-1 text-xs font-medium text-white"
            aria-live="polite"
            aria-atomic="true"
          >
            {activeIndex + 1} / {photos.length}
          </span>
        </>
      ) : null}
    </section>
  )
}
