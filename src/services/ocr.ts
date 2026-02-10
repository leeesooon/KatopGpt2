import { createWorker } from 'tesseract.js'
import type { ImageAttachment } from '../types'

let workerPromise: ReturnType<typeof createWorker> | null = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('chi_sim+eng')
  }
  return workerPromise
}

/**
 * OCR a single image and return the recognised text.
 */
export async function recognizeImage(image: ImageAttachment): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(image.base64)
  return data.text.trim()
}

/**
 * OCR multiple images and return a combined description string.
 */
export async function recognizeImages(images: ImageAttachment[]): Promise<string> {
  if (images.length === 0) return ''

  const results = await Promise.all(
    images.map(async (img, i) => {
      const text = await recognizeImage(img)
      const label = images.length > 1 ? `[图片 ${i + 1}: ${img.name}]` : `[图片: ${img.name}]`
      return `${label}\n${text || '(未识别到文字)'}`
    })
  )

  return results.join('\n\n')
}
