import { supabase } from '@/lib/supabase'
import type { Student } from '@/types/database'

export const PHOTO_BUCKET = 'student-photos'

/**
 * Printed at roughly 20mm x 25mm on the card, so anything past a few hundred
 * pixels is invisible on paper and only costs storage and load time. Portrait
 * 4:5, the shape a passport-style photo already is.
 */
const TARGET_W = 400
const TARGET_H = 500

/** Anything bigger than this is almost certainly not a photo of a face. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Re-encode a chosen image to a fixed portrait size before it ever leaves the
 * browser. Two reasons: a phone photo is several megabytes and none of that
 * detail survives a 20mm print, and a fixed aspect ratio means the card layout
 * cannot be broken by whatever shape someone happens to upload.
 *
 * The crop is centred and covers the frame, so a landscape photo loses its
 * sides rather than being squashed.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = TARGET_W
    canvas.height = TARGET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read that image.')

    // Cover: scale so the shorter side fills the frame, then centre.
    const scale = Math.max(TARGET_W / bitmap.width, TARGET_H / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, TARGET_W, TARGET_H)
    ctx.drawImage(bitmap, (TARGET_W - w) / 2, (TARGET_H - h) / 2, w, h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    )
    if (!blob) throw new Error('Could not process that image.')
    return blob
  } finally {
    bitmap.close()
  }
}

/**
 * Upload a prepared photo and return its storage path. The path is the student
 * id, so re-uploading replaces the previous photo instead of accumulating
 * orphans nobody will ever clean up.
 */
export async function uploadPhoto(studentId: string, blob: Blob): Promise<string> {
  const path = `${studentId}.jpg`
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(error.message)
  return path
}

export async function deletePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path])
  if (error) throw new Error(error.message)
}

/**
 * Sign every photo on a screen in one call. The bucket is private, so a photo
 * is only ever reachable through a short-lived link; an hour outlasts printing
 * a batch of cards without leaving a link usable tomorrow.
 */
export async function signStudentPhotos(
  students: Student[],
  seconds = 3600
): Promise<Map<string, string>> {
  const withPhotos = students.filter((s) => s.photo_path)
  if (withPhotos.length === 0) return new Map()

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(withPhotos.map((s) => s.photo_path as string), seconds)
  // A failure here is not worth blocking a screen for — cards simply print with
  // initials instead of a face.
  if (error) return new Map()

  const urls = new Map<string, string>()
  data?.forEach((entry, i) => {
    if (entry.signedUrl) urls.set(withPhotos[i].id, entry.signedUrl)
  })
  return urls
}

/** Initials for the placeholder shown when a student has no photo yet. */
export function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
