/**
 * 附件 → Token 预算折算（通道治理 阶段 1.3「防富媒体预算逃逸」，2026-10-12）。
 *
 * 背景（回仓取证）：用户上传的**富媒体**其字节**不进**发送给模型的 `apiMessages` ——
 * `StreamPipeline.registerImages()` 只把"图片**路径文本**"追加进最后一条 user 消息、并把路径登记给
 * `ImageContextService` ⇒ 图片**字节开销不计入**上下文 token 估算，可**绕过日预算硬闸门**
 * （R16 `DAILY_BUDGET_EXCEEDED`）。本模块提供**纯函数**折算（字节 → 估算 token），
 * 供 `preSendContextProtection` 在 `checkDailyBudget()` / `reserveFor()` **之前**并入本轮预留。
 *
 * **接线口径（2026-10-12 收口订正，如实）**：生产调用点取 `StreamMessageOptions.images`
 * （前端 → `ChatRequest.images` → `CoreAPIImpl.chatStream` → `streamMessage`），这是**唯一**贯通到
 * 该处且携带 `size` 的入参。
 * ⚠️ **未接线的口子（不谎称已覆盖）**：**通道侧**入站附件（`channels/types/IChannel.ts` 的
 * `MessageContext.attachments`）**当前未**被 `routeChannelMessage` 透传给 `CoreAPI.chatStream`
 * （`channels/routing/messageRouter.ts` 的 `chatStream({...})` 无附件字段）⇒ 该路径**尚在闸门之外**；
 * 且通道侧 `MessageAttachment` 与 `session/types/message` 的 `MessageAttachment` 属**同名不同物**
 * （归属裁定：禁合并 / 禁断言互换）⇒ 须经 DTO 形状搬运（见通道治理方案 阶段 2.4）后再接线。
 *
 * 折算口径（保守、可解释）：`ceil(bytes / BYTES_PER_TOKEN)`。缺省 `4`（与英文/代码 ~4 bytes/token
 * 同量级）；二进制媒体（图片/音视频）实际开销通常**更高** ⇒ 此处取 4 属**保守下限**（宁可低估
 * 也不夸大预算占用）。**缺 `size` 的附件按 0 计**（不臆造，CS06）。
 */

/** 字节 → token 的折算比（保守下限：4 bytes/token） */
export const ATTACHMENT_BYTES_PER_TOKEN = 4;

/** 仅需 `size` 的结构化入参（避免依赖具体 `MessageAttachment` 形状） */
export interface AttachmentSizeLike {
  size?: number;
}

/** 单附件 → 估算 token（缺 `size` / 非正数 / 非法值 ⇒ 0，不臆造） */
export function estimateAttachmentTokens(att: AttachmentSizeLike): number {
  const bytes = att?.size;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return 0;
  }
  return Math.ceil(bytes / ATTACHMENT_BYTES_PER_TOKEN);
}

/** 附件列表 → 合计估算 token（空 / 缺省 ⇒ 0） */
export function estimateAttachmentsTokens(
  attachments?: readonly AttachmentSizeLike[]
): number {
  if (!attachments || attachments.length === 0) return 0;
  let total = 0;
  for (const a of attachments) total += estimateAttachmentTokens(a);
  return total;
}
