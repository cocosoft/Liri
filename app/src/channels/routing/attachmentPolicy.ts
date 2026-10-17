// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 入站附件 MIME 分类与上限（U-26 / T1-6 残余，2026-10-17）。
 *
 * 背景：通道入站附件此前只把 `size` 送进预算预留（`query/attachmentBudget.ts`），
 * **无 MIME 分类、无单附件上限、无条数上限** ⇒ 超大附件会一次性抬高预留，
 * 未知类型也没有一致的处置口径。
 *
 * 口径（保守、可解释）：
 *  - **分类**：按 MIME 主类型归入 `image` / `audio` / `video` / `document` / `archive` / `other`；
 *  - **MIME 缺省**：按扩展名推断（仅用于分类，不改写原始 `mimeType`）；
 *  - **上限**：按分类给单附件字节上限；未知/缺省类型走最严格的 `other` 档；
 *  - **条数**：单条消息最多 `MAX_ATTACHMENTS_PER_MESSAGE` 个，超出者拒绝；
 *  - **缺 `size`**：无法证明超限 ⇒ 接受（不臆造，CS06）。
 *
 * 本模块为**纯函数**（无 IO、无日志），拒绝原因由调用方留痕。
 */

export type AttachmentCategory =
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'archive'
  | 'other';

/** 单条消息的附件条数上限 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** 各分类的单附件字节上限（保守值；可按渠道能力覆盖） */
export const ATTACHMENT_SIZE_LIMITS: Record<AttachmentCategory, number> = {
  image: 20 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  archive: 200 * 1024 * 1024,
  other: 10 * 1024 * 1024,
};

/** 仅需分类所需字段的结构（避免依赖具体通道附件形状） */
export interface AttachmentPolicyInput {
  mimeType?: string;
  fileName?: string;
  size?: number;
}

export type AttachmentRejectReason = 'count_exceeded' | 'size_exceeded';

export interface RejectedAttachment {
  index: number;
  reason: AttachmentRejectReason;
  category: AttachmentCategory;
  limitBytes: number;
  size?: number;
}

export interface AttachmentPolicyResult<T extends AttachmentPolicyInput> {
  accepted: T[];
  rejected: RejectedAttachment[];
}

export interface AttachmentPolicyOptions {
  maxCount?: number;
  limits?: Partial<Record<AttachmentCategory, number>>;
}

const DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const ARCHIVE_MIME = new Set([
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
]);

const EXT_CATEGORY: Record<string, AttachmentCategory> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  svg: 'image',
  mp3: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  wav: 'audio',
  m4a: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  pdf: 'document',
  txt: 'document',
  md: 'document',
  json: 'document',
  csv: 'document',
  xml: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  '7z': 'archive',
  rar: 'archive',
};

/** 归一化 MIME：去参数、转小写；空值 ⇒ undefined */
function normalizeMime(mimeType?: string): string | undefined {
  if (typeof mimeType !== 'string') return undefined;
  const main = mimeType.split(';')[0]?.trim().toLowerCase();
  return main || undefined;
}

/** 从文件名取扩展名分类（无法判定 ⇒ undefined） */
function categoryFromFileName(
  fileName?: string
): AttachmentCategory | undefined {
  if (!fileName) return undefined;
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  if (!match) return undefined;
  return EXT_CATEGORY[match[1].toLowerCase()];
}

/** 按 MIME（优先）/ 扩展名（兜底）分类；无法判定 ⇒ `other` */
export function classifyAttachment(
  input: AttachmentPolicyInput
): AttachmentCategory {
  const mime = normalizeMime(input.mimeType);
  if (mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (
      mime.startsWith('text/') ||
      DOCUMENT_MIME.has(mime) ||
      mime.includes('officedocument') ||
      mime.includes('ms-excel') ||
      mime.includes('ms-powerpoint') ||
      mime.includes('msword')
    ) {
      return 'document';
    }
    if (
      ARCHIVE_MIME.has(mime) ||
      mime.includes('zip') ||
      mime.includes('tar')
    ) {
      return 'archive';
    }
  }
  return categoryFromFileName(input.fileName) ?? 'other';
}

/**
 * 应用附件策略：按**原顺序**保留合格附件，并给出逐项拒绝原因（供调用方留痕）。
 *
 * 注意：被拒绝的附件**不进入预算预留**（其字节不会被模型读取）——这是"上限"的本义；
 * 调用方必须以 warn 留痕（不得静默丢弃）。
 */
export function applyAttachmentPolicy<T extends AttachmentPolicyInput>(
  attachments: readonly T[] | undefined,
  options: AttachmentPolicyOptions = {}
): AttachmentPolicyResult<T> {
  const accepted: T[] = [];
  const rejected: RejectedAttachment[] = [];
  if (!attachments || attachments.length === 0) return { accepted, rejected };

  const maxCount = options.maxCount ?? MAX_ATTACHMENTS_PER_MESSAGE;
  attachments.forEach((att, index) => {
    if (index >= maxCount) {
      rejected.push({
        index,
        reason: 'count_exceeded',
        category: classifyAttachment(att),
        limitBytes: 0,
        ...(typeof att.size === 'number' ? { size: att.size } : {}),
      });
      return;
    }
    const category = classifyAttachment(att);
    const limitBytes =
      options.limits?.[category] ?? ATTACHMENT_SIZE_LIMITS[category];
    const size = att.size;
    if (
      typeof size === 'number' &&
      Number.isFinite(size) &&
      size > limitBytes
    ) {
      rejected.push({
        index,
        reason: 'size_exceeded',
        category,
        limitBytes,
        size,
      });
      return;
    }
    accepted.push(att);
  });
  return { accepted, rejected };
}
