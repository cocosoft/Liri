/**
 * 分词组件
 *
 * 将译文按空格/标点拆分为可点击的词，hover 时显示下划线。
 * 点击词时触发 onWordClick 回调，用于弹出备选翻译。
 */

import { useCallback } from "react";

interface SplitTextProps {
  text: string;
  isDark: boolean;
  onWordClick: (word: string, event: React.MouseEvent) => void;
}

/** 判断是否为单词字符（字母、数字、中文等非标点符号） */
function isWordChar(ch: string): boolean {
  return /[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(ch);
}

function SplitText({ text, isDark, onWordClick }: SplitTextProps) {
  const hoverColor = isDark ? "hover:bg-gray-700" : "hover:bg-gray-200";
  const underlineColor = isDark ? "decoration-gray-500" : "decoration-gray-400";

  const renderTokens = useCallback(() => {
    const tokens: Array<{ type: "word" | "space" | "punct"; text: string }> = [];
    let i = 0;

    while (i < text.length) {
      const ch = text[i];

      if (ch === " " || ch === "\n") {
        tokens.push({ type: "space", text: ch });
        i++;
      } else if (isWordChar(ch)) {
        // 收集连续单词字符
        let word = "";
        while (i < text.length && isWordChar(text[i])) {
          word += text[i];
          i++;
        }
        tokens.push({ type: "word", text: word });
      } else {
        // 标点符号
        tokens.push({ type: "punct", text: ch });
        i++;
      }
    }

    return tokens;
  }, [text]);

  const tokens = renderTokens();

  return (
    <>
      {tokens.map((token, idx) => {
        if (token.type === "word") {
          return (
            <span
              key={idx}
              onClick={(e) => onWordClick(token.text, e)}
              className={`cursor-pointer rounded-sm px-0.5 -mx-0.5 transition-colors ${hoverColor} hover:underline ${underlineColor}`}
              title="点击查看备选翻译"
            >
              {token.text}
            </span>
          );
        }
        return <span key={idx}>{token.text}</span>;
      })}
    </>
  );
}

export default SplitText;