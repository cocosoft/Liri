import { useState } from "react";
import type { QuestionData } from "../../types";
import { chatService } from "../../services/chatService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:questionBlock");

interface QuestionBlockProps {
  questionData: QuestionData;
  sessionId?: string;
  onResponse?: (content: string) => void;
}

// "其他"选项的固定 label
const OTHER_LABEL = "__other__";

function QuestionBlock({
  questionData,
  sessionId,
  onResponse,
}: QuestionBlockProps) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [otherText, setOtherText] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { question, header, options, multiSelect, questionId } = questionData;

  // 过滤空 label 选项（LLM 调用错误时常见），同时保留原始顺序
  const validOptions = options.filter(
    (opt) => opt.label && opt.label.trim().length > 0,
  );

  const isOtherSelected = selectedLabels.includes(OTHER_LABEL);
  const otherRequiresText = isOtherSelected && otherText.trim().length === 0;

  const handleToggle = (label: string) => {
    if (submitted) return;

    setSelectedLabels((prev) => {
      if (multiSelect) {
        return prev.includes(label)
          ? prev.filter((l) => l !== label)
          : [...prev, label];
      }
      // 单选模式：再次点击同一项取消
      return prev[0] === label ? [] : [label];
    });
  };

  const handleSubmit = async () => {
    if (selectedLabels.length === 0) return;
    // 选中"其他"但没填文字时，禁用提交
    if (otherRequiresText) return;

    // 构造答案：选中"其他"时，将用户输入的文字作为答案
    let answers: string[];
    if (isOtherSelected) {
      // 把"其他"替换成用户实际填写的文字
      answers = selectedLabels.map((l) =>
        l === OTHER_LABEL ? otherText.trim() : l,
      );
    } else {
      answers = selectedLabels;
    }

    // 提交回答到后端
    const result = await chatService.submitQuestionAnswer(
      questionId,
      answers,
      sessionId,
    );

    setSubmitted(true);

    if (!result.success) {
      logger.warn("提交回答失败，但已标记为已提交", { questionId });
    }

    // 非流式路径：后端返回了最终响应内容，通过回调追加到消息列表
    if (result.content && onResponse) {
      onResponse(result.content);
    }
  };

  const canSubmit = selectedLabels.length > 0 && !otherRequiresText;

  return (
    <div className="my-3 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-blue-50/50 dark:bg-blue-950/30">
      {/* 头部 */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-blue-100/80 dark:bg-blue-900/40 hover:bg-blue-200/60 dark:hover:bg-blue-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-600 dark:text-blue-400 text-sm">💬</span>
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
          {validOptions.length > 0 ? (
            <div className="space-y-2">
              {validOptions.map((option, idx) => {
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

              {/* 固定"其他"选项 */}
              <button
                onClick={() => handleToggle(OTHER_LABEL)}
                disabled={submitted}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                  isOtherSelected
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
                      isOtherSelected
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {isOtherSelected && (
                      <span className="text-xs leading-none">✓</span>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span
                      className={`font-medium text-sm ${
                        isOtherSelected
                          ? "text-blue-700 dark:text-blue-300"
                          : "text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      其它
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      在下方输入您的具体内容
                    </p>
                  </div>
                </div>
              </button>

              {/* "其他"对应的补充输入框 */}
              {isOtherSelected && !submitted && (
                <div className="pl-7 pr-1">
                  <textarea
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    placeholder="请输入您的具体选择（1-200 字）..."
                    maxLength={200}
                    rows={2}
                    className="w-full px-2.5 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-none"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">
                      {otherText.length}/200
                    </span>
                    {otherRequiresText && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        选中"其它"时需填写内容
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 提交后展示"其他"的内容 */}
              {submitted && isOtherSelected && otherText && (
                <div className="pl-7 pr-1 text-xs text-gray-600 dark:text-gray-400 italic">
                  您的输入：{otherText.trim()}
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 text-xs text-amber-700 dark:text-amber-300">
              ⚠️ 该问题未提供可选项，请直接在下方输入框回复。
            </div>
          )}

          {/* 提交按钮 */}
          {!submitted && validOptions.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
              >
                {multiSelect
                  ? `确认选择（${selectedLabels.length}项）`
                  : "确认选择"}
              </button>
              {multiSelect && (
                <span className="text-xs text-gray-400">可多选</span>
              )}
            </div>
          )}

          {/* 已提交提示 */}
          {submitted && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span>✓</span>
              <span>
                已选择：
                {isOtherSelected
                  ? otherText.trim() || OTHER_LABEL
                  : selectedLabels.join("、")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QuestionBlock;
