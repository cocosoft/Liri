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
  // M5 修复：无选项时的自由文本回答
  const [freeText, setFreeText] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  // 会话中断态：后端无对应待处理交互（重启/超时/abort 已清理），锁定且不可重试
  const [interrupted, setInterrupted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
    // #9 修复：提交期间防重（原双击/连点会重复提交）
    if (submitted || submitting) return;

    // 构造答案：无选项模式提交自由文本；有选项模式按选中项提交
    let answers: string[];
    if (validOptions.length === 0) {
      // M5 修复：无选项时必须有输入框，自由文本即答案
      const text = freeText.trim();
      if (!text) return;
      answers = [text];
    } else {
      if (selectedLabels.length === 0) return;
      // 选中"其他"但没填文字时，禁用提交
      if (otherRequiresText) return;
      // 选中"其他"时，将用户输入的文字作为答案
      answers = isOtherSelected
        ? selectedLabels.map((l) => (l === OTHER_LABEL ? otherText.trim() : l))
        : selectedLabels;
    }

    setSubmitting(true);
    try {
      // 提交回答到后端
      const result = await chatService.submitQuestionAnswer(
        questionId,
        answers,
        sessionId,
      );

      // 404 = 后端无对应待处理交互（会话中断/后端重启/交互超时），
      // 锁定并提示"会话已中断"，禁止无限重试（方案 1）
      if (result.notFound) {
        setInterrupted(true);
        setSubmitted(true);
        logger.warn("question 块失效：后端无对应交互，锁定", {
          questionId,
          sessionId,
          interruptedAt: new Date().toISOString(),
        });
        return;
      }

      // #9 修复：仅成功才锁定（原失败也 setSubmitted(true)，用户无法重试）
      if (result.success) {
        setSubmitted(true);
        // 非流式路径：后端返回了最终响应内容，通过回调追加到消息列表
        if (result.content && onResponse) {
          onResponse(result.content);
        }
      } else {
        logger.warn("提交回答失败，未锁定，允许重试", { questionId });
      }
    } catch (e) {
      // #9 修复：异常不锁定，保留可重试状态
      logger.error("提交回答异常", { questionId, error: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    validOptions.length === 0
      ? freeText.trim().length > 0
      : selectedLabels.length > 0 && !otherRequiresText;

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
            // M5 修复：无选项时必须有输入框 + 提交按钮，否则用户无法回应
            <div className="space-y-2">
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="该问题未提供可选项，请在此直接输入您的回答（1-200 字）..."
                maxLength={200}
                rows={3}
                disabled={submitted}
                className="w-full px-2.5 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {freeText.length}/200
                </span>
                {!submitted && (
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || submitting}
                    className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
                  >
                    {submitting ? "提交中..." : "提交回答"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 提交按钮（仅选项模式显示在下方；无选项模式按钮已内联在上方分支） */}
          {!submitted && validOptions.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
              >
                {submitting
                  ? "提交中..."
                  : multiSelect
                    ? `确认选择（${selectedLabels.length}项）`
                    : "确认选择"}
              </button>
              {multiSelect && (
                <span className="text-xs text-gray-400">可多选</span>
              )}
            </div>
          )}

          {/* 会话中断提示（方案 1：后端已无待处理交互，块锁定不可重试） */}
          {interrupted && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-2">
              <span>⚠️</span>
              <span>会话已中断，该问题无法继续回答，请重新发起对话。</span>
            </div>
          )}

          {/* 已提交提示 */}
          {submitted && !interrupted && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span>✓</span>
              <span>
                已选择：
                {validOptions.length === 0
                  ? freeText.trim() || "（空）"
                  : isOtherSelected
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
