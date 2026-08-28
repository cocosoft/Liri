import { memo } from "react";
import type { FAQEntry } from "../../../types/knowledge";

interface FAQStatusBadgeProps {
  status: FAQEntry["embeddingStatus"];
}

export const FAQStatusBadge = memo(function FAQStatusBadge({
  status,
}: FAQStatusBadgeProps) {
  switch (status) {
    case "done":
      return (
        <span title="嵌入完成" className="text-xs cursor-default">
          ✅
        </span>
      );
    case "pending":
      return (
        <span
          title="嵌入中..."
          className="text-xs animate-spin inline-block cursor-default"
        >
          ⏳
        </span>
      );
    case "failed":
      // 后端暂无 re-embed 端点：不渲染可点击重试入口（原空实现按钮点了无反应）
      return (
        <span title="嵌入失败（暂不支持手动重试）" className="text-xs cursor-default">
          ❌
        </span>
      );
    default:
      return null;
  }
});
