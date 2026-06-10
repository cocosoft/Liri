import { useState } from "react";
import type { QuestionData } from "../../types";
import { chatService } from "../../services/chatService";

interface QuestionBlockProps {
  questionData: QuestionData;
  sessionId?: string;
  onResponse?: (content: string) => void;
}

function QuestionBlock({ questionData, sessionId, onResponse }: QuestionBlockProps) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { question, header, options, multiSelect, questionId } = questionData;

  const handleToggle = (label: string) => {
    if (submitted) return;

    setSelectedLabels((prev) => {
      if (multiSelect) {
        return prev.includes(label)
          ? prev.filter((l) => l !== label)
          : [...prev, label];
      }
      return prev[0] === label ? [] : [label];
    });
  };

  const handleSubmit = async () => {
    if (selectedLabels.length === 0) return;

    // 提交回答到后端
    const result = await chatService.submitQuestionAnswer(
      questionId,
      selectedLabels,
      sessionId,
    );

    setSubmitted(true);

    if (!result.success) {
      console.warn("提交回答失败，但已标记为已提交", { questionId });
    }

    // 非流式路径：后端返回了最终响应内容，通过回调追加到消息列表
    if (result.content && onResponse) {
      onResponse(result.content);
    }
  };

  return (
    <div className="my-3 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-blue-50/50 dark:bg-blue-950/30">
      {/* 头部 */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-blue-100/80 dark:bg-blue-900/40 hover:bg-blue-200/60 dark:hover:bg-blue-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-600 dark:text-blue-400 text-sm">
            💬
          </span>
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {header || "请选择一个选项"}
          </span>
        </div>
        <span className="text-blue-400 dark:text-blue-500 text-xs transition-transform duration-200">
          {isCollapsed ? "▶" : "▼"}
        </span>
      </button>

      {/* 内容 */}
      {!isCollapsed && (
        <div className="px-4 py-3 space-y-3">
          {/* 问题描述 */}
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {question}
          </p>

          {/* 选项列表 */}
          <div className="space-y-2">
            {options.map((option, idx) => {
              const isSelected = selectedLabels.includes(option.label);
              return (
                <button
                  key={`${questionId}-${idx}`}
                  onClick={() => handleToggle(option.label)}
                  disabled={submitted}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                    isSelected
                      ? "border-blue-500 bg-blue-100 dark:bg-blue-900/50 dark:border-blue-500 ring-1 ring-blue-400"
                      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600"
                  } ${
                    submitted ? "opacity-60 cursor-default" : "cursor-pointer"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                        multiSelect ? "rounded-md" : "rounded-full"
                      } ${
                        isSelected
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-gray-300 dark:border-gray-600"
                      }`}
                    >
                      {isSelected && (
                        <span className="text-xs leading-none">✓</span>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span
                        className={`font-medium text-sm ${
                          isSelected
                            ? "text-blue-700 dark:text-blue-300"
                            : "text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {option.label}
                      </span>
                      {option.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {option.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 提交按钮 */}
          {!submitted && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={selectedLabels.length === 0}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
              >
                {multiSelect
                  ? `确认选择（${selectedLabels.length}项）`
                  : "确认选择"}
              </button>
              {multiSelect && (
                <span className="text-xs text-gray-400">
                  可多选
                </span>
              )}
            </div>
          )}

          {/* 已提交提示 */}
          {submitted && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span>✓</span>
              <span>
                已选择：{selectedLabels.join("、")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QuestionBlock;
