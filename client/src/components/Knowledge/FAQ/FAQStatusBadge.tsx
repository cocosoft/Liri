import { memo } from "react";
import type { FAQEntry } from "../../../types/knowledge";

interface FAQStatusBadgeProps {
  status: FAQEntry["embeddingStatus"];
  onRetry?: () => void;
}

export const FAQStatusBadge = memo(function FAQStatusBadge({
  status,
  onRetry,
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
      return (
        <button
          title="嵌入失败，点击重试"
          onClick={(e) => {
            e.stopPropagation();
            onRetry?.();
          }}
          className="text-xs hover:scale-110 transition-transform cursor-pointer"
        >
          ❌
        </button>
      );
    default:
      return null;
  }
});
