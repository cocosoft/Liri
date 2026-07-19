/**
 * QuickCreateCards — 三个创建卡片（垂直排列）
 * AI 写文档 / 表格生成 / 演示制作
 */

import { useTranslation } from "react-i18next";

interface QuickCreateCard {
  id: string;
  icon: string;
  label: string;
  description: string;
  onClick: () => void;
}

interface QuickCreateCardsProps {
  /** 点击卡片后的回调（如聚焦 ChatInput 并填入提示词） */
  onCardClick: (prompt: string) => void;
}

const CARDS: Array<Omit<QuickCreateCard, "onClick"> & { prompt: string }> = [
  {
    id: "doc",
    icon: "🪄",
    label: "AI 写文档",
    description: "创建 Word 文档",
    prompt: "请帮我创建一份文档：",
  },
  {
    id: "xlsx",
    icon: "📊",
    label: "表格生成",
    description: "创建 Excel 表格",
    prompt: "请帮我创建一份表格：",
  },
  {
    id: "pptx",
    icon: "📽️",
    label: "演示制作",
    description: "创建 PPT 演示",
    prompt: "请帮我创建一份演示文稿：",
  },
];

export function QuickCreateCards({ onCardClick }: QuickCreateCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      {CARDS.map((card) => (
        <button
          key={card.id}
          onClick={() => onCardClick(card.prompt)}
          className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 
            dark:border-gray-700 bg-white dark:bg-gray-900 
            hover:bg-blue-50 dark:hover:bg-blue-950 
            transition-colors text-left w-full"
          aria-label={card.label}
        >
          <span className="text-xl flex-shrink-0" aria-hidden="true">
            {card.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {t(`office.${card.id}`, card.label)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {t(`office.${card.id}Desc`, card.description)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
