/**
 * U-03（2026-10-19）：media 工具族的**模型可见出参结构**（JSON Schema）。
 *
 * 图片处理工具（`media_image_*`）的 `data` 统一来自 `ImageProcessor` 的
 * `ProcessResult`（`src/media/image/ImageProcessor.ts`）⇒ 共用同一份声明，
 * 避免 6 份手写副本各自漂移。
 */
export const IMAGE_PROCESS_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '处理是否成功' },
    filePath: { type: 'string', description: '输出文件路径' },
    originalSize: { type: 'number', description: '原始文件大小（字节）' },
    processedSize: { type: 'number', description: '处理后文件大小（字节）' },
    dimensions: {
      type: 'object',
      description: '处理后的尺寸（处理器能取到时返回）',
      properties: {
        width: { type: 'number', description: '宽度（像素）' },
        height: { type: 'number', description: '高度（像素）' },
      },
      required: ['width', 'height'],
    },
    error: { type: 'string', description: '失败原因（成功时不返回）' },
  },
  required: ['success', 'filePath', 'originalSize', 'processedSize'],
};

/**
 * U-03（2026-10-19）：`media_info` 的出参结构（`MediaStore.MediaFileInfo` 投影）。
 */
export const MEDIA_INFO_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    format: { type: 'string', description: 'MIME 类型（如 image/png）' },
    fileSize: { type: 'number', description: '文件大小（字节）' },
    createdAt: { type: 'number', description: '创建时间（毫秒时间戳）' },
    dimensions: {
      type: 'object',
      description: '图片尺寸（仅图片文件可探测时返回）',
      properties: {
        width: { type: 'number', description: '宽度（像素）' },
        height: { type: 'number', description: '高度（像素）' },
      },
      required: ['width', 'height'],
    },
  },
  required: ['format', 'fileSize', 'createdAt'],
};

/**
 * U-03（2026-10-20）：**单文件产出**类 media 工具的统一出参结构 ——
 * `media_video_compress` / `media_video_extract_audio` / `media_video_extract_thumbnail` /
 * `media_qr_generate` 四者的成功结果都只有「一个输出文件 + 大小（+ 少数附加位）」。
 *
 * 与 `IMAGE_PROCESS_OUTPUT_JSON_SCHEMA` 的区别（有意保留两份，不合并）：
 * 图片族强制 `originalSize`；`media_qr_generate` 的输入是文本、**没有原始文件**，
 * 故此处 `originalSize` 可选。两者的公共键集（success/filePath/processedSize）一致。
 */
export const MEDIA_FILE_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '处理是否成功' },
    filePath: { type: 'string', description: '输出文件路径' },
    originalSize: {
      type: 'number',
      description: '输入文件大小（字节；二维码生成无输入文件，不返回）',
    },
    processedSize: { type: 'number', description: '输出文件大小（字节）' },
    captureTime: {
      type: 'number',
      description:
        '缩略图抓取时间点（秒；仅 media_video_extract_thumbnail 返回）',
    },
    error: { type: 'string', description: '失败原因（成功时不返回）' },
  },
  required: ['success', 'filePath', 'processedSize'],
};

/**
 * U-03（2026-10-20）：`media_pdf_extract` 的出参结构（`ExtractedPage[]` 投影）。
 */
export const MEDIA_PDF_EXTRACT_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '提取是否成功' },
    pageCount: { type: 'number', description: '提取到的页数' },
    totalSize: { type: 'number', description: '各页图片大小之和（字节）' },
    pages: {
      type: 'array',
      description: '逐页导出的图片',
      items: {
        type: 'object',
        properties: {
          pageNumber: { type: 'number', description: '页码（从 1 开始）' },
          imagePath: { type: 'string', description: '该页导出的图片路径' },
          format: { type: 'string', description: '图片格式（jpeg/png）' },
          width: { type: 'number', description: '宽度（像素）' },
          height: { type: 'number', description: '高度（像素）' },
        },
        required: ['pageNumber', 'imagePath', 'format'],
      },
    },
  },
  required: ['success', 'pageCount', 'pages'],
};

/**
 * U-03（2026-10-20）：`media_qr_decode` 的出参结构（成功时只有解码文本）。
 */
export const MEDIA_QR_DECODE_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '解码是否成功' },
    text: { type: 'string', description: '二维码解码出的文本内容' },
  },
  required: ['success', 'text'],
};

/**
 * U-03（2026-10-20）：`media_delete` 的出参结构。
 */
export const MEDIA_DELETE_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '是否删除成功' },
    filePath: { type: 'string', description: '已删除的文件路径' },
  },
  required: ['success', 'filePath'],
};

/**
 * U-03（2026-10-20）：`media_delete_batch` 的出参结构。
 */
export const MEDIA_DELETE_BATCH_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '是否全部删除成功' },
    deletedCount: { type: 'number', description: '实际删除成功的文件数' },
    total: { type: 'number', description: '本次请求删除的文件总数' },
    filePaths: {
      type: 'array',
      description: '本次请求删除的文件路径（已通过路径安全校验）',
      items: { type: 'string' },
    },
  },
  required: ['success', 'deletedCount', 'total'],
};
