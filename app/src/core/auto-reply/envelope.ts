import type {
  ReplyPayload,
  EnvelopeMetadata,
  ReplyEnvelope,
  DispatchTarget,
} from './types.js';
import { chunkText, resolveChunkLimit } from './chunk.js';

let nextEnvelopeId = 1;

/**
 * 生成唯一信封 ID。
 */
function generateEnvelopeId(): string {
  const id = nextEnvelopeId++;
  return `env-${Date.now()}-${id}`;
}

/**
 * 创建回复信封，将负载与元数据包装在一起。
 * 自动对文本进行分块以适应目标渠道限制。
 */
export function createEnvelope(
  payload: ReplyPayload,
  metadata: Partial<EnvelopeMetadata>,
  target?: DispatchTarget
): ReplyEnvelope {
  const channelLimit = target
    ? resolveChunkLimit(target.channelId, target.accountId)
    : 4000;

  const chunks = payload.text
    ? chunkText(payload.text, channelLimit).chunks
    : [];

  const envelope: ReplyEnvelope = {
    id: generateEnvelopeId(),
    payload,
    metadata: {
      timestamp: Date.now(),
      ...metadata,
    },
    chunks,
  };

  return envelope;
}

/**
 * 检查信封是否包含可发送内容。
 */
export function hasContent(envelope: ReplyEnvelope): boolean {
  return (
    envelope.chunks.length > 0 ||
    (envelope.payload.attachments?.length ?? 0) > 0
  );
}

/**
 * 合并多个信封为单个信封（如果可能）。
 */
export function mergeEnvelopes(envelopes: ReplyEnvelope[]): ReplyEnvelope[] {
  if (envelopes.length <= 1) {
    return envelopes;
  }

  const merged: ReplyEnvelope[] = [];
  let current = envelopes[0];

  for (let i = 1; i < envelopes.length; i++) {
    const next = envelopes[i];

    if (
      current.metadata.channelId === next.metadata.channelId &&
      current.metadata.conversationId === next.metadata.conversationId
    ) {
      const mergedText = [...current.chunks, ...next.chunks].join('\n\n');

      const mergedPayload: ReplyPayload = {
        text: mergedText,
        attachments: [
          ...(current.payload.attachments ?? []),
          ...(next.payload.attachments ?? []),
        ],
      };

      current = {
        id: current.id,
        payload: mergedPayload,
        metadata: current.metadata,
        chunks: [mergedText],
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}
