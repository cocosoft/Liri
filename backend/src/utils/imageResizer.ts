// @ts-nocheck
/**
 * 图片缩放工具
 *
 * 提供图片缩放和压缩功能。
 * 检测管道：magic bytes → 读取 PNG 尺寸 → ImageMagick（可选）→ 回退验证。
 * 不使用第三方图片处理库，使用内置 API 和可选的系统工具。
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  API_IMAGE_MAX_BASE64_SIZE,
  IMAGE_MAX_WIDTH,
  IMAGE_MAX_HEIGHT,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits'

const execAsync = promisify(exec)

/**
 * 图片缩放错误
 */
export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageResizeError'
  }
}

/**
 * 图片尺寸信息
 */
export interface ImageDimensions {
  originalWidth?: number
  originalHeight?: number
  displayWidth?: number
  displayHeight?: number
}

/**
 * 缩放结果
 */
export interface ResizeResult {
  buffer: Buffer
  mediaType: string
  dimensions?: ImageDimensions
}

/**
 * 从缓冲区检测图片格式（通过 magic bytes）
 *
 * 支持的格式：PNG, JPEG, GIF, WebP
 */
export function detectImageFormatFromBuffer(buffer: Buffer): string {
  if (buffer.length < 8) return 'image/png'

  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 &&
    buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return 'image/png'
  }

  if (
    buffer[0] === 0xff && buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return 'image/gif'
  }

  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 &&
    buffer[2] === 0x46 && buffer[3] === 0x46
  ) {
    return 'image/webp'
  }

  return 'image/png'
}

/**
 * 从 PNG 缓冲区读取图片尺寸（通过 IHDR chunk）
 *
 * PNG 文件结构：
 * - 8字节签名：89 50 4E 47 0D 0A 1A 0A
 * - IHDR chunk：4字节长度 + 4字节类型 + 13字节数据
 *   - 宽（4字节大端序）: 偏移16
 *   - 高（4字节大端序）: 偏移20
 */
export function readPNGDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50) return null

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)

  if (width === 0 || height === 0) return null

  return { width, height }
}

/**
 * 检测 ImageMagick 是否可用
 */
let magickAvailable: boolean | null = null

async function checkMagickAvailable(): Promise<boolean> {
  if (magickAvailable !== null) return magickAvailable

  try {
    await execAsync('magick -version', { timeout: 3000 })
    magickAvailable = true
  } catch {
    try {
      await execAsync('convert -version', { timeout: 3000 })
      magickAvailable = true
    } catch {
      magickAvailable = false
    }
  }

  return magickAvailable
}

/**
 * 获取 ImageMagick 命令名
 */
async function getMagickCommand(): Promise<string> {
  try {
    await execAsync('magick -version', { timeout: 2000 })
    return 'magick'
  } catch {
    return 'convert'
  }
}

/**
 * 计算 base64 编码大小
 */
function base64Size(rawSize: number): number {
  return Math.ceil((rawSize * 4) / 3)
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

/**
 * 缩放图片缓冲区
 *
 * 通过管道检测和缩放图片：
 * 1. 检查尺寸是否已在限制内
 * 2. 检查 PNG 是否超尺寸
 * 3. 尝试 ImageMagick（如可用）进行缩放
 * 4. 回退到验证和报错
 *
 * @param imageBuffer - 原始图片缓冲区
 * @param originalSize - 原始文件大小
 * @param ext - 文件扩展名
 * @returns 缩放结果
 * @throws ImageResizeError - 无法缩放且超过限制时
 */
export async function maybeResizeAndDownsampleImageBuffer(
  imageBuffer: Buffer,
  originalSize: number,
  ext: string
): Promise<ResizeResult> {
  if (imageBuffer.length === 0) {
    throw new ImageResizeError('Image file is empty (0 bytes)')
  }

  const mediaType = ext || 'png'
  const normalizedMediaType = mediaType === 'jpg' ? 'jpeg' : mediaType

  const pngDims = readPNGDimensions(imageBuffer)
  const width = pngDims?.width
  const height = pngDims?.height

  if (originalSize <= IMAGE_TARGET_RAW_SIZE &&
      (!width || width <= IMAGE_MAX_WIDTH) &&
      (!height || height <= IMAGE_MAX_HEIGHT)) {
    return {
      buffer: imageBuffer,
      mediaType: normalizedMediaType,
      dimensions: {
        originalWidth: width,
        originalHeight: height,
        displayWidth: width,
        displayHeight: height,
      },
    }
  }

  // Check if ImageMagick is available for actual resizing
  const hasMagick = await checkMagickAvailable()

  if (hasMagick) {
    try {
      return await resizeWithMagick(imageBuffer, originalSize, normalizedMediaType, width, height)
    } catch {
      // Fall through to size validation
    }
  }

  // Check base64 size: if within API limit, allow through uncompressed
  const b64Size = base64Size(originalSize)

  const overDim =
    width !== undefined && height !== undefined &&
    (width > IMAGE_MAX_WIDTH || height > IMAGE_MAX_HEIGHT)

  if (b64Size <= API_IMAGE_MAX_BASE64_SIZE && !overDim) {
    return {
      buffer: imageBuffer,
      mediaType: normalizedMediaType,
      dimensions: {
        originalWidth: width,
        originalHeight: height,
        displayWidth: width,
        displayHeight: height,
      },
    }
  }

  const hint = hasMagick
    ? 'ImageMagick resize failed'
    : 'Install ImageMagick (magick) for image resizing support'

  throw new ImageResizeError(
    overDim
      ? `Unable to resize image — dimensions exceed the ${IMAGE_MAX_WIDTH}x${IMAGE_MAX_HEIGHT}px limit. ` +
          `${hint}.`
      : `Unable to resize image (${formatFileSize(originalSize)} raw, ${formatFileSize(b64Size)} base64). ` +
          `${hint}.`
  )
}

/**
 * 使用 ImageMagick 缩放图片
 */
async function resizeWithMagick(
  imageBuffer: Buffer,
  originalSize: number,
  mediaType: string,
  originalWidth?: number,
  originalHeight?: number
): Promise<ResizeResult> {
  const cmd = await getMagickCommand()

  // Calculate target dimensions
  let targetWidth = originalWidth || IMAGE_MAX_WIDTH
  let targetHeight = originalHeight || IMAGE_MAX_HEIGHT

  if (targetWidth > IMAGE_MAX_WIDTH) {
    targetHeight = Math.round((targetHeight * IMAGE_MAX_WIDTH) / targetWidth)
    targetWidth = IMAGE_MAX_WIDTH
  }

  if (targetHeight > IMAGE_MAX_HEIGHT) {
    targetWidth = Math.round((targetWidth * IMAGE_MAX_HEIGHT) / targetHeight)
    targetHeight = IMAGE_MAX_HEIGHT
  }

  const outputFormat = mediaType === 'png' ? 'png' : 'jpeg'

  const { stdout } = await execAsync(
    `${cmd} - -resize ${targetWidth}x${targetHeight}> -quality 80 ${outputFormat}:-`,
    {
      input: imageBuffer,
      timeout: 10000,
      maxBuffer: 20 * 1024 * 1024,
    }
  )

  const resizedBuffer = Buffer.from(stdout)

  return {
    buffer: resizedBuffer,
    mediaType: outputFormat,
    dimensions: {
      originalWidth,
      originalHeight,
      displayWidth: targetWidth,
      displayHeight: targetHeight,
    },
  }
}

/**
 * 缩放图片内容块
 *
 * 接收 ImageBlockParam 格式的图片，返回缩放后的版本。
 *
 * @param imageBlock - 图片内容块（需为 base64 类型）
 * @returns 缩放后的图片块
 */
export async function maybeResizeAndDownsampleImageBlock(
  imageBlock: { type: string; source: { type: string; data: string; media_type?: string } }
): Promise<{ block: typeof imageBlock; dimensions?: ImageDimensions }> {
  if (imageBlock.source.type !== 'base64') {
    return { block: imageBlock }
  }

  const imageBuffer = Buffer.from(imageBlock.source.data, 'base64')
  const originalSize = imageBuffer.length
  const mediaType = imageBlock.source.media_type || 'image/png'
  const ext = mediaType.split('/')[1] || 'png'

  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    originalSize,
    ext
  )

  return {
    block: {
      type: 'image',
      source: {
        type: 'base64',
        media_type: `image/${resized.mediaType}`,
        data: resized.buffer.toString('base64'),
      },
    },
    dimensions: resized.dimensions,
  }
}

/**
 * 压缩图片缓冲区至指定大小限制
 *
 * 使用 ImageMagick（如可用）将图片压缩到目标字节数以内。
 * 策略：逐步降低分辨率（100% → 75% → 50% → 25%）和质量。
 *
 * @param imageBuffer - 图片缓冲区
 * @param maxBytes - 最大字节数（默认 IMAGE_TARGET_RAW_SIZE）
 * @param originalMediaType - 原图媒体类型（可选）
 * @returns 压缩结果
 */
export async function compressImageBuffer(
  imageBuffer: Buffer,
  maxBytes: number = IMAGE_TARGET_RAW_SIZE,
  originalMediaType?: string
): Promise<{ base64: string; mediaType: string; originalSize: number }> {
  const fallbackFormat = originalMediaType?.split('/')[1] || 'jpeg'
  const normalizedFallback = fallbackFormat === 'jpg' ? 'jpeg' : fallbackFormat
  const originalSize = imageBuffer.length

  if (originalSize <= maxBytes) {
    const detected = detectImageFormatFromBuffer(imageBuffer)
    return {
      base64: imageBuffer.toString('base64'),
      mediaType: detected,
      originalSize,
    }
  }

  const hasMagick = await checkMagickAvailable()

  if (hasMagick) {
    try {
      const cmd = await getMagickCommand()
      const scalingFactors = [1.0, 0.75, 0.5, 0.25]

      for (const factor of scalingFactors) {
        const resizeArg = factor < 1.0
          ? `-resize ${Math.round(factor * 100)}%`
          : ''

        const { stdout } = await execAsync(
          `${cmd} - ${resizeArg} -quality 80 jpeg:-`,
          {
            input: imageBuffer,
            timeout: 15000,
            maxBuffer: 20 * 1024 * 1024,
          }
        )

        const compressed = Buffer.from(stdout)
        if (compressed.length <= maxBytes) {
          return {
            base64: compressed.toString('base64'),
            mediaType: 'image/jpeg',
            originalSize,
          }
        }
      }

      const { stdout } = await execAsync(
        `${cmd} - -resize 600x600> -quality 30 jpeg:-`,
        {
          input: imageBuffer,
          timeout: 15000,
          maxBuffer: 20 * 1024 * 1024,
        }
      )

      const compressed = Buffer.from(stdout)
      return {
        base64: compressed.toString('base64'),
        mediaType: 'image/jpeg',
        originalSize,
      }
    } catch {
      // Fall through
    }
  }

  // If image is within API limit, allow through uncompressed
  const b64Size = base64Size(originalSize)
  if (b64Size <= API_IMAGE_MAX_BASE64_SIZE) {
    const detected = detectImageFormatFromBuffer(imageBuffer)
    return {
      base64: imageBuffer.toString('base64'),
      mediaType: detected,
      originalSize,
    }
  }

  const hint = hasMagick
    ? 'ImageMagick compression failed'
    : 'Install ImageMagick (magick) for image compression support'

  throw new ImageResizeError(
    `Unable to compress image (${formatFileSize(originalSize)}) to fit within ${formatFileSize(maxBytes)}. ${hint}.`
  )
}

/**
 * 以 Token 限制压缩图片
 *
 * base64 每 token 约 0.125 字符，转换为字节限制后压缩。
 *
 * @param imageBuffer - 图片缓冲区
 * @param maxTokens - 最大 Token 数
 * @param originalMediaType - 原图媒体类型（可选）
 * @returns 压缩结果
 */
export async function compressImageBufferWithTokenLimit(
  imageBuffer: Buffer,
  maxTokens: number,
  originalMediaType?: string
): Promise<{ base64: string; mediaType: string; originalSize: number }> {
  const maxBase64Chars = Math.floor(maxTokens / 0.125)
  const maxBytes = Math.floor(maxBase64Chars * 0.75)

  return compressImageBuffer(imageBuffer, maxBytes, originalMediaType)
}
