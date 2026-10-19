/**
 * 附件 → Token 预算折算（通道治理 阶段 1.3「防富媒体预算逃逸」，2026-10-12）。
 *
 * 背景（回仓取证）：用户上传的**富媒体**其字节**不进**发送给模型的 `apiMessages` ——
 * `StreamPipeline.registerImages()` 只把"图片**路径文本**"追加进最后一条 user 消息、并把路径登记给
 * `ImageContextService` ⇒ 图片**字节开销不计入**上下文 token 估算，可**绕过日预算硬闸门**
 * （R16 `DAILY_BUDGET_EXCEEDED`）。本模块提供**纯函数**折算（字节 → 估算 token），
 * 供 `preSendContextProtection` 在 `checkDailyBudget()` / `reserveFor()` **之前**并入本轮预留。
 *
 * **接线口径（2026-10-19 G-11 订正）**：生产调用点有两个 —— ① 交互路径取
 * `StreamMessageOptions.images`（前端 → `ChatRequest.images` → `CoreAPIImpl.chatStream` →
 * `streamMessage`）；② 通道路径取其专用入参 `attachmentSizes`（见下段）。
 * **通道侧入站附件（2026-10-19 G-06/G-11 订正）**：`routeChannelMessage` 已把通道协议层的
 * `MessageContext.attachments` 经 `applyAttachmentPolicy` 收窄后，以**专用预留入参**
 * `attachmentSizes`（仅 `size`）透传给 `CoreAPI.chatStream`（`channels/routing/messageRouter.ts:636-645`）；
 * 本模块的 `estimateAttachmentsTokens()` 在 `preSendContextProtection` 中并入 R16 预留
 * （`chat/orchestrator/preSendContextProtection.ts:209-211`）。
 * ⚠️ **实际是否计入取决于通道是否填 `size`**（G-06 取证）：已核实的 Telegram 语音只填
 * `fileId/fileName/mimeType`（无 `size`），QQ / 飞书下载后**不填 `attachments`**（仅把路径/size
 * 写进正文）⇒ 这三类当前折算为 **0**（缺 `size` 按 0 计，CS06 不臆造）。补齐属通道侧独立切片。
 * 两个 `MessageAttachment` 仍属**同名不同物**（通道协议层 vs 会话领域层，归属裁定：
 * 禁合并 / 禁断言互换）⇒ 接线处**只搬 `size`**，不携带 `url`/`data`。
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
