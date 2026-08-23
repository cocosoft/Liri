/**
 * WatermarkTag — ChatArea 中「上下文水位」的紧凑标签（收缩展示）
 *
 * 上下文水位 status 块在 ChatArea 中从「边框卡片」收缩为一行紧凑小标签，
 * 仅保留关键信息（百分比 + 临界标记），完整详情在右侧「会话日志」面板查看。
 * 识别依据：结构化标记 block.status === "watermark"（chat-stream-chunk 写入，CS02）。
 * 数据来源：优先读 block.watermark 结构化字段（P1-3），旧数据回退解析 content。
 */

interface WatermarkTagProps {
  content: string;
  /** 结构化水位数据（P1-3，CS02：替代内容正则解析） */
  watermark?: { pct: number; severity: "warn" | "compact" };
}

function WatermarkTag({ content, watermark }: WatermarkTagProps) {
  // TODO: CS05-ROOTFIX — content 正则解析仅为旧持久化数据（无 watermark 字段）的过渡兜底，
  // 待历史会话数据自然过期后可删除 fallback 分支
  const pctMatch = watermark ? null : content.match(/上下文水位:\s*(\d+)%/);
  const pct = watermark ? String(watermark.pct) : pctMatch ? pctMatch[1] : null;
  // 临界（compact）检测：优先结构化 severity；旧格式回退关键字（机器生成协议数据，非用户可见状态）
  const isCritical = watermark
    ? watermark.severity === "compact"
    : /severity:\s*compact/.test(content) ||
      content.includes("压缩") ||
      content.includes("临界");

  return (
    <div className="my-0.5 flex">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none border ${
          isCritical
            ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-500 dark:text-red-400"
            : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400"
        }`}
      >
        <span>{isCritical ? "🔴" : "⚠️"}</span>
        <span>上下文 {pct ?? "--"}%</span>
        {isCritical && <span>需压缩</span>}
      </span>
    </div>
  );
}

export default WatermarkTag;
