//
/**
 * 入站消息处理
 * 处理来自桥接的入站用户消息，提取内容和UUID
 * 支持字符串内容和ContentBlockParam[]（例如包含图像的消息）
 * 基于CC源码 cc_code/backend/bridge/inboundMessages.ts 实现
 */

export interface InboundMessageFields {
  content: string | Array<Record<string, unknown>>;
  uuid?: string;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type?: string;
    mediaType?: string;
    data: string;
  };
}

function isImageBlock(block: Record<string, unknown>): boolean {
  return (block as any).type === 'image' && (block as any).source?.type === 'base64';
}

function detectImageFormatFromBase64(base64: string): string {
  const header = base64.substring(0, 8);
  if (header.startsWith('/9j/')) return 'image/jpeg';
  if (header.startsWith('iVBOR')) return 'image/png';
  if (header.startsWith('RIFF')) return 'image/webp';
  if (header.startsWith('UklE')) return 'image/gif';
  return 'image/jpeg';
}

function isMalformedImageBlock(block: Record<string, unknown>): boolean {
  if (!isImageBlock(block)) return false;
  const source = (block as any).source;
  return !source.media_type && !source.mediaType;
}

function normalizeImageBlock(block: ImageBlock): Record<string, unknown> {
  const source = block.source;
  const mediaType = source.mediaType || source.media_type || detectImageFormatFromBase64(source.data);
  return {
    ...block,
    source: {
      type: 'base64',
      media_type: mediaType,
      data: source.data,
    },
  };
}

function normalizeImageBlocks(
  blocks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (!blocks.some(isMalformedImageBlock)) return blocks;
  return blocks.map(block => isMalformedImageBlock(block) ? normalizeImageBlock(block as any) : block);
}

export interface SDKMessage {
  type: string;
  uuid?: string;
  message?: {
    content?: string | Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

/**
 * 从桥接消息中提取入站消息字段
 * @param msg SDK消息
 * @returns 提取的字段，或undefined如果消息应被跳过
 */
export function extractInboundMessageFields(
  msg: SDKMessage,
): InboundMessageFields | undefined {
  if (msg.type !== 'user') return undefined;

  const content = msg.message?.content;
  if (!content) return undefined;
  if (Array.isArray(content) && content.length === 0) return undefined;

  const uuid = typeof msg.uuid === 'string' ? msg.uuid : undefined;

  return {
    content: Array.isArray(content) ? normalizeImageBlocks(content) : content,
    uuid,
  };
}

/**
 * 检查消息是否包含图像块
 */
export function hasImageBlocks(msg: SDKMessage): boolean {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(block => isImageBlock(block));
}

/**
 * 从消息中提取所有图像的数据
 */
export function extractImageData(msg: SDKMessage): string[] {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(isImageBlock)
    .map(block => (block as any).source.data);
}
