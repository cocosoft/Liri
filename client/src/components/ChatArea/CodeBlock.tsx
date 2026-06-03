import { useState, useCallback } from "react";

interface CodeBlockProps {
  language: string;
  code: string;
  maxLines?: number;
}

const LINES_THRESHOLD = 20;

function CodeBlock({
  language,
  code,
  maxLines = LINES_THRESHOLD,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const lines = code.split("\n");
  const isLong = lines.length > maxLines;
  const displayCode =
    isLong && !expanded ? lines.slice(0, maxLines).join("\n") + "\n..." : code;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div className="relative my-3 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
        <span className="text-xs font-mono text-gray-500 dark:text-gray-400 uppercase">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto bg-white dark:bg-gray-900 text-sm leading-relaxed">
        <code className={`language-${language}`}>{displayCode}</code>
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border-t border-gray-300 dark:border-gray-600"
        >
          {expanded ? "收起" : `展开全部 (共 ${lines.length} 行)`}
        </button>
      )}
    </div>
  );
}

export default CodeBlock;
