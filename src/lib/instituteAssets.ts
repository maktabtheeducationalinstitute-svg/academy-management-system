import { supabase } from '@/lib/supabase'

export const INSTITUTE_ASSETS_BUCKET = 'institute-assets'

// A single shared file, not one per student — unlike student-photos, this
// bucket only ever holds this one image, re-uploaded (upsert) whenever the
// office replaces it.
const SIGNATURE_PATH = 'principal-signature.png'

/** Anything bigger than this is almost certainly not a scanned signature. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const TARGET_W = 400
const TARGET_H = 200

/**
 * Re-encode a chosen image to a fixed frame before it ever leaves the browser,
 * for the same reasons as student photos. Signatures are wide and short,
 * not portrait, and "contain" (not "cover") — a signature's edges are the
 * part that matters, so nothing is allowed to crop off. PNG, not JPEG, so a
 * transparent background survives and the signature sits on the card without
 * a white box around it.
 */
export async function prepareSignature(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = TARGET_W
    canvas.height = TARGET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read that image.')

    const scale = Math.min(TARGET_W / bitmap.width, TARGET_H / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (TARGET_W - w) / 2, (TARGET_H - h) / 2, w, h)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not process that image.')
    return blob
  } finally {
    bitmap.close()
  }
}

export async function uploadSignature(blob: Blob): Promise<string> {
  const { error } = await supabase.storage
    .from(INSTITUTE_ASSETS_BUCKET)
    .upload(SIGNATURE_PATH, blob, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(error.message)
  return SIGNATURE_PATH
}

export async function deleteSignature(path: string): Promise<void> {
  const { error } = await supabase.storage.from(INSTITUTE_ASSETS_BUCKET).remove([path])
  if (error) throw new Error(error.message)
}

/**
 * The bucket is private, so the signature is only ever reachable through a
 * short-lived link. Returns null on any failure — a card simply prints
 * without a signature rather than blocking the whole screen over it.
 */
export async function signSignatureUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(INSTITUTE_ASSETS_BUCKET).createSignedUrl(path, seconds)
  if (error) return null
  return data?.signedUrl ?? null
}
