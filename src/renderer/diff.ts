import sharp from 'sharp';
import pixelmatch from 'pixelmatch';

export interface CompareOptions {
  threshold?: number;
  include_diff_image?: boolean;
  anti_aliasing_detection?: boolean;
  output_format?: 'png' | 'jpeg' | 'webp' | 'avif';
}

export interface CompareResult {
  mismatch_percentage: number;
  total_pixels: number;
  diff_pixels: number;
  diff_image_buffer?: Buffer;
}

/**
 * Compare two PNG images and return pixel-level diff stats.
 * If dimensions differ, the smaller image is resized to match the larger.
 */
export async function compareImages(
  imageA: Buffer,
  imageB: Buffer,
  options: CompareOptions = {},
): Promise<CompareResult> {
  const {
    threshold = 0.1,
    include_diff_image = true,
    anti_aliasing_detection = false,
    output_format = 'png',
  } = options;

  // Decode both images to get dimensions
  const metaA = await sharp(imageA).metadata();
  const metaB = await sharp(imageB).metadata();

  if (!metaA.width || !metaA.height || !metaB.width || !metaB.height) {
    throw new Error('Invalid image: unable to determine dimensions');
  }

  // Determine target dimensions (use larger of each dimension)
  const width = Math.max(metaA.width, metaB.width);
  const height = Math.max(metaA.height, metaB.height);

  // Decode to raw RGBA, resizing if needed
  const rawA = await sharp(imageA)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const rawB = await sharp(imageB)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Allocate diff output buffer
  const diffBuf = include_diff_image
    ? new Uint8Array(width * height * 4)
    : undefined;

  const diffPixels = pixelmatch(
    new Uint8Array(rawA.buffer, rawA.byteOffset, rawA.length),
    new Uint8Array(rawB.buffer, rawB.byteOffset, rawB.length),
    diffBuf ?? undefined,
    width,
    height,
    {
      threshold,
      includeAA: anti_aliasing_detection,
    },
  );

  const totalPixels = width * height;
  const mismatchPct = totalPixels > 0
    ? Math.round((diffPixels / totalPixels) * 100 * 100) / 100
    : 0;

  let diffImageBuffer: Buffer | undefined;
  if (include_diff_image && diffBuf) {
    const sharpImg = sharp(Buffer.from(diffBuf.buffer), {
      raw: { width, height, channels: 4 },
    });

    if (output_format === 'jpeg') {
      diffImageBuffer = await sharpImg.jpeg().toBuffer();
    } else if (output_format === 'webp') {
      diffImageBuffer = await sharpImg.webp().toBuffer();
    } else if (output_format === 'avif') {
      diffImageBuffer = await sharpImg.avif().toBuffer();
    } else {
      diffImageBuffer = await sharpImg.png().toBuffer();
    }
  }

  return {
    mismatch_percentage: mismatchPct,
    total_pixels: totalPixels,
    diff_pixels: diffPixels,
    diff_image_buffer: diffImageBuffer,
  };
}
