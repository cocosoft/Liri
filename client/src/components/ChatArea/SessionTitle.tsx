/**
 * SessionTitle — 统一会话标题展示组件（方案 C P2-3 收敛）
 *
 * 收敛方案 C #1-#7 各展示点的标题兜底逻辑，避免逐点补丁复发：
 * - 空标题统一 fallback（i18n，由调用方传入）
 * - 单行截断场景统一 `truncate` + 原生 `title` 全文兜底
 * - 可变高度容器统一 `break-words` 换行（`truncate={false}`）
 * - 可选 base-ui Tooltip 全文（hover 看完整标题）
 */
import type { JSX } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { cn } from "@/lib/utils";

interface SessionTitleProps {
  /** 标题文本（空/undefined/null 时走 fallback） */
  text?: string | null;
  /** 空标题兜底文案 */
  fallback: string;
  /** 单行截断（默认 true，列表项/固定宽度）；false 时 break-words 换行（可变高度容器） */
  truncate?: boolean;
  /** 渲染标签（保留语义与事件），默认 span */
  as?: "span" | "div" | "h2" | "h3";
  /** hover 用 base-ui Tooltip 显示完整标题（默认 false 走原生 title，更轻量） */
  withTooltip?: boolean;
  /** 附加类名 */
  className?: string;
  /** 点击事件透传（如 header 详情开关） */
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** 双击事件透传（如 header 进入编辑） */
  onDoubleClick?: React.MouseEventHandler<HTMLElement>;
}

function SessionTitle({
  text,
  fallback,
  truncate = true,
  as = "span",
  withTooltip = false,
  className,
  onClick,
  onDoubleClick,
}: SessionTitleProps): JSX.Element {
  const display = text && text.length > 0 ? text : fallback;
  const Tag = as;

  const inner = (
    <Tag
      className={cn(truncate ? "truncate" : "break-words", className)}
      title={text && text.length > 0 ? text : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {display}
    </Tag>
  );

  if (!withTooltip) return inner;

  return (
    <Tooltip>
      <TooltipTrigger render={inner} />
      <TooltipContent>{text || fallback}</TooltipContent>
    </Tooltip>
  );
}

export default SessionTitle;
