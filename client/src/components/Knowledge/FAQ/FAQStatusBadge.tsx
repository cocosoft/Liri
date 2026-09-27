import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { FAQEntry } from "../../../types/knowledge";

interface FAQStatusBadgeProps {
  status: FAQEntry["embeddingStatus"];
}

export const FAQStatusBadge = memo(function FAQStatusBadge({
  status,
}: FAQStatusBadgeProps) {
  const { t } = useTranslation();
  switch (status) {
    case "done":
      return (
        <span
          title={t("knowledge.faq.embedDone")}
          className="text-xs cursor-default"
        >
          ✅
        </span>
      );
    case "pending":
      return (
        <span
          title={t("knowledge.faq.embedding")}
          className="text-xs animate-spin inline-block cursor-default"
        >
          ⏳
        </span>
      );
    case "failed":
      // 后端暂无 re-embed 端点：不渲染可点击重试入口（原空实现按钮点了无反应）
      return (
        <span
          title={t("knowledge.faq.embedFailed")}
          className="text-xs cursor-default"
        >
          ❌
        </span>
      );
    default:
      return null;
  }
});
