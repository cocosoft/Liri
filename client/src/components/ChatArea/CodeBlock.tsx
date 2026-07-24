import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import "highlight.js/styles/github-dark.css";
import { handleClientError } from "../../utils/handleError";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// 注册常用语言（按需加载，减少体积）
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

/** 语言别名映射，用于显示友好名称 */
const LANG_DISPLAY: Record<string, string> = {
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  c: "C",
  cpp: "C++",
  css: "CSS",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  python: "Python",
  py: "Python",
  rust: "Rust",
  rs: "Rust",
  sql: "SQL",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TSX",
  xml: "XML",
  html: "HTML",
  yaml: "YAML",
  yml: "YAML",
};

interface CodeBlockProps {
  code: string;
  language?: string;
}

/** 代码块组件：语法高亮 + 复制按钮 + 语言标签 */
function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const highlighted = useMemo(() => {
    if (!code) return "";

    const lang = language?.toLowerCase() || "";
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (e) {
        handleClientError(e, {
          module: "components:chat:CodeBlock",
          action: "highlight",
        });
        // 高亮失败时降级为自动检测
      }
    }

    // 自动检测语言
    try {
      return hljs.highlightAuto(code).value;
    } catch (e) {
      handleClientError(e, {
        module: "components:chat:CodeBlock",
        action: "highlightAuto",
      });
      return escapeHtml(code);
    }
  }, [code, language]);

  const displayLang = language
    ? LANG_DISPLAY[language.toLowerCase()] || language
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      handleClientError(e, {
        module: "components:chat:CodeBlock",
        action: "copyToClipboard",
      });
      // 忽略复制失败
    }
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-gray-700">
      {/* 顶部栏：语言名称 + 复制按钮 */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-800 text-gray-400 text-xs">
        <span>{displayLang || "code"}</span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-gray-200"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      {/* 代码内容 */}
      <pre className="bg-gray-900 text-gray-100 p-4 overflow-x-auto text-sm leading-relaxed">
        <code
          className={`hljs${language ? ` language-${language}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default CodeBlock;
