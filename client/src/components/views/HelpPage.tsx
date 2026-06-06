import { useState, useEffect } from "react";
import KeyboardShortcutsHelp from "../common/KeyboardShortcutsHelp";
import { http } from "../../services/httpClient";

/** 帮助中心导航项 */
interface HelpNavItem {
  id: string;
  label: string;
  icon: string;
}

/** 文档分类 */
interface DocCategory {
  name: string;
  dir: string;
  files: string[];
  collapsed?: boolean;
}

const NAV_ITEMS: HelpNavItem[] = [
  { id: "docs", label: "帮助文档", icon: "D" },
  { id: "shortcuts", label: "快捷键", icon: "S" },
  { id: "about", label: "关于 Liri", icon: "A" },
];

const ACTIVE_NAV_KEY = "liri-help-active-nav";
const APP_VERSION = "7.9.0";

/**
 * 文档分类索引（与 app/docs/ 目录结构同步）
 */
const DOC_CATEGORIES: DocCategory[] = [
  { name: "快速入门", dir: "快速入门", files: ["index", "installation", "onboarding", "quickstart", "setup", "upgrading"] },
  { name: "安装部署", dir: "安装部署", files: ["index", "configuration", "docker", "linux", "macos", "source", "windows", "troubleshooting"] },
  { name: "开发指南", dir: "开发指南", files: ["index", "add-ai-provider", "add-platform-channel", "add-tool-command-skill", "api-reference", "architecture", "code-style", "contributing", "getting-started", "internationalization-design", "module-dev", "module-to-plugin-migration", "security", "testing"] },
  { name: "核心模块", dir: "核心模块", files: ["index", "acp-protocol", "app-core", "auth", "auto-reply", "cache-system", "config-manager", "context-engine", "coordinator", "cron-scheduler", "di-container", "error-handling", "event-bus", "flow-engine", "gateway", "i18n-registry", "logging", "markdown-render", "media-generation", "media-understanding", "memory-host", "notification", "session-manager", "state-management", "task-system"] },
  { name: "工具参考", dir: "工具参考", files: ["index", "agent-tools", "bash", "browser", "code-execution", "file-edit", "file-read", "file-write", "image-generation", "lsp", "mcp", "music-generation", "pdf", "thinking", "tts", "video-generation", "web-fetch", "web-search"] },
  { name: "插件系统", dir: "插件系统", files: ["index", "api-reference", "building-plugins", "bundled-plugins", "hooks", "lifecycle", "manifest", "marketplace", "overview", "plugin-sdk", "review-process", "skills"] },
  { name: "概念与架构", dir: "概念与架构", files: ["index", "agent-model", "architecture", "design-philosophy", "plugin-architecture", "session", "streaming", "tool-system"] },
  { name: "渠道 (Channels)", dir: "渠道", files: ["index", "channel-routing", "channel-testing", "dingtalk", "discord", "feishu", "irc", "line", "matrix", "overview", "qq", "signal", "slack", "telegram", "web", "wechat", "wecom", "whatsapp"] },
  { name: "配置与安全", dir: "配置与安全", files: ["index", "audit", "configuration", "governance", "network-security", "oauth", "permissions", "sandbox", "secrets", "smart-router"] },
  { name: "自动化", dir: "自动化", files: ["index", "cron", "hooks", "tasks", "webhooks"] },
  { name: "帮助与支持", dir: "帮助与支持", files: ["index", "debugging", "environment", "faq-install", "faq", "support", "troubleshooting"] },
  { name: "知识库", dir: "知识库", files: ["index"] },
  { name: "语音", dir: "语音", files: ["语音生成功"] },
  { name: "顶层文档", dir: ".", files: ["API", "CORE_MODULES", "DEVELOPMENT", "SKILLS", "TOOLS", "USAGE", "index"] },
];

// 文档文件显示名称映射（去掉连字符、首字母大写）
const DOC_LABELS: Record<string, string> = {
  index: "概述",
  "add-ai-provider": "添加 AI 提供商",
  "add-platform-channel": "添加平台渠道",
  "add-tool-command-skill": "添加工具/命令/Skill",
  "api-reference": "API 参考",
  "agent-tools": "Agent 工具",
  "code-execution": "代码执行",
  "file-edit": "文件编辑",
  "file-read": "文件读取",
  "file-write": "文件写入",
  "image-generation": "图片生成",
  "music-generation": "音乐生成",
  "video-generation": "视频生成",
  "web-fetch": "网页抓取",
  "web-search": "网页搜索",
  "getting-started": "开始入门",
  module: "模块",
  "module-dev": "模块开发",
  "module-to-plugin-migration": "模块到插件迁移",
  "internationalization-design": "国际化设计",
  "design-philosophy": "设计理念",
  "plugin-architecture": "插件架构",
  "error-handling": "错误处理",
  "event-bus": "事件总线",
  "flow-engine": "流程引擎",
  "config-manager": "配置管理",
  "context-engine": "上下文引擎",
  "session-manager": "会话管理",
  "state-management": "状态管理",
  "media-generation": "媒体生成",
  "media-understanding": "媒体理解",
  "memory-host": "记忆宿主",
  "markdown-render": "Markdown 渲染",
  "cache-system": "缓存系统",
  "cron-scheduler": "Cron 调度器",
  "di-container": "DI 容器",
  "channel-routing": "渠道路由",
  "channel-testing": "渠道测试",
  dingtalk: "钉钉",
  discord: "Discord",
  feishu: "飞书",
  irc: "IRC",
  line: "LINE",
  matrix: "Matrix",
  overview: "概览",
  qq: "QQ",
  signal: "Signal",
  slack: "Slack",
  telegram: "Telegram",
  web: "Web",
  wechat: "微信",
  wecom: "企业微信",
  whatsapp: "WhatsApp",
  "building-plugins": "构建插件",
  "bundled-plugins": "内置插件",
  lifecycle: "生命周期",
  manifest: "插件清单",
  marketplace: "市场",
  "plugin-sdk": "Plugin SDK",
  "review-process": "审查流程",
  skills: "Skills",
  hooks: "Hooks",
  tasks: "任务",
  webhooks: "Webhooks",
  cron: "Cron",
  troubleshooting: "故障排除",
  debugging: "调试",
  environment: "环境",
  "faq-install": "安装 FAQ",
  faq: "常见问题",
  support: "支持",
  onboarding: "上手引导",
  quickstart: "快速开始",
  setup: "设置",
  upgrading: "升级",
  configuration: "配置",
  docker: "Docker",
  linux: "Linux",
  macos: "macOS",
  source: "源码构建",
  windows: "Windows",
  "network-security": "网络安全",
  oauth: "OAuth",
  permissions: "权限",
  sandbox: "沙箱",
  secrets: "密钥管理",
  "smart-router": "智能路由",
  governance: "治理",
  audit: "审计",
  "app-core": "应用核心",
  auth: "认证",
  "auto-reply": "自动回复",
  coordinator: "协调器",
  gateway: "网关",
  notification: "通知",
  "task-system": "任务系统",
  "agent-model": "Agent 模型",
  streaming: "流式",
  "tool-system": "工具系统",
  session: "会话",
  architecture: "架构",
  "code-style": "代码风格",
  testing: "测试",
  contributing: "贡献指南",
  security: "安全",
  "语音生成功": "语音合成",
  "lsp": "LSP",
  "mcp": "MCP",
  "pdf": "PDF",
  "tts": "TTS",
  "thinking": "思考",
  "browser": "浏览器",
  "bash": "Bash",
};

/** 格式化文档名 */
function formatDocLabel(name: string): string {
  return DOC_LABELS[name] || name;
}

function HelpPage() {
  const [activeNav, setActiveNav] = useState(() => {
    try {
      const s = localStorage.getItem(ACTIVE_NAV_KEY);
      if (s && NAV_ITEMS.some((n) => n.id === s)) return s;
    } catch { /* ignore */ }
    return "docs";
  });
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<{
    title: string;
    html: string;
  } | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  useEffect(() => {
    if (docContent) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [docContent]);

  const switchNav = (id: string) => {
    setActiveNav(id);
    setDocContent(null);
    try {
      localStorage.setItem(ACTIVE_NAV_KEY, id);
    } catch { /* ignore */ }
  };

  /** 加载文档内容 */
  const loadDoc = async (cat: DocCategory, fileName: string) => {
    setLoadingDoc(true);
    const docPath = `app/docs/${cat.dir}/${fileName}.md`;
    try {
      const res = await http.get<{ ok: boolean; data: string }>("/api/file/read", {
        params: { path: docPath },
      });
      if (res?.ok && res?.data) {
        // 简单将 markdown 换行转为段落
        const lines = res.data.split("\n");
        let html = "";
        let inCode = false;
        for (const line of lines) {
          if (line.startsWith("```")) {
            inCode = !inCode;
            html += inCode ? "<pre class='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto my-2'>" : "</pre>";
            continue;
          }
          if (inCode) {
            html += line + "\n";
            continue;
          }
          if (line.startsWith("# ")) {
            html += `<h1 class="text-xl font-bold text-gray-900 dark:text-gray-100 mt-6 mb-3">${line.slice(2)}</h1>`;
          } else if (line.startsWith("## ")) {
            html += `<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-5 mb-2">${line.slice(3)}</h2>`;
          } else if (line.startsWith("### ")) {
            html += `<h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-1">${line.slice(4)}</h3>`;
          } else if (line.trim()) {
            html += `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">${line}</p>`;
          }
        }
        setDocContent({ title: formatDocLabel(fileName), html });
      } else {
        setDocContent({ title: formatDocLabel(fileName), html: "<p class='text-red-500'>文档加载失败</p>" });
      }
    } catch {
      setDocContent({ title: formatDocLabel(fileName), html: "<p class='text-red-500'>文档加载失败：无法连接后端服务</p>" });
    }
    setLoadingDoc(false);
  };

  const toggleCategory = (catName: string) => {
    setExpandedCat(expandedCat === catName ? null : catName);
  };

  return (
    <div className="flex flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-900">
      {/* ── 左侧导航 ── */}
      <aside className="w-52 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            帮助中心
          </h2>
        </div>
        <nav className="pb-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => switchNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium border-r-2 border-blue-500"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <span className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800 relative">
        {activeNav === "docs" && renderDocs()}
        {activeNav === "shortcuts" && renderShortcuts()}
        {activeNav === "about" && renderAbout()}

        {/* 文档查看器浮层 */}
        {docContent && (
          <div className="absolute inset-0 bg-white dark:bg-gray-800 z-10 overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between z-10">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {docContent.title}
              </h3>
              <button
                onClick={() => setDocContent(null)}
                className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-300"
              >
                返回
              </button>
            </div>
            <div className="px-6 py-4 max-w-3xl">
              {loadingDoc ? (
                <p className="text-sm text-gray-500">加载中...</p>
              ) : (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: docContent.html }}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );

  /** 帮助文档 - 分类浏览器 */
  function renderDocs() {
    return (
      <div className="p-6 max-w-4xl">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            帮助文档
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            点击分类展开文档列表，选择文档查看详细内容
          </p>
        </div>

        <div className="space-y-2">
          {DOC_CATEGORIES.map((cat) => {
            const isExpanded = expandedCat === cat.name;
            return (
              <div
                key={cat.name}
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                {/* 分类头部 */}
                <button
                  onClick={() => toggleCategory(cat.name)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <span>{cat.name}</span>
                  <span
                    className={`text-gray-400 transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  >
                    &gt;
                  </span>
                </button>

                {/* 文件列表 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    {cat.files.map((file) => (
                      <button
                        key={file}
                        onClick={() => loadDoc(cat, file)}
                        disabled={loadingDoc}
                        className="w-full text-left px-5 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                      >
                        {formatDocLabel(file)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-sm text-gray-400 dark:text-gray-500">
          更多文档请查看项目 <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">app/docs/</code> 目录
        </p>
      </div>
    );
  }

  /** 快捷键 */
  function renderShortcuts() {
    return (
      <div className="p-6 max-w-3xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          快捷键
        </h3>
        <KeyboardShortcutsHelp />
      </div>
    );
  }

  /** 关于 Liri */
  function renderAbout() {
    return (
      <div className="p-6 max-w-3xl space-y-8">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            关于 Liri
          </h3>

          {/* 应用信息 */}
          <div className="flex items-center gap-4 mb-6 p-5 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
              L
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Liri
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                版本 {APP_VERSION}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                集 AI 聊天、任务管理、知识库、自动化于一体的桌面生产力工具
              </p>
            </div>
          </div>

          {/* 详细信息 */}
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-gray-600 dark:text-gray-400">开源协议</span>
              <span className="text-gray-900 dark:text-gray-100 font-medium">
                MIT License
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-gray-600 dark:text-gray-400">技术栈</span>
              <span className="text-gray-900 dark:text-gray-100">
                TypeScript + Rust + React + Tauri
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-gray-600 dark:text-gray-400">运行时</span>
              <span className="text-gray-900 dark:text-gray-100">
                Node.js + Python (UV)
              </span>
            </div>
          </div>
        </div>

        {/* 核心功能 */}
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
            核心功能
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                AI 聊天
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                多模型对话、流式输出、上下文管理
              </p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                任务管理
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Agent 任务、PDCA 循环、看板管理
              </p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                知识库
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                文档管理、语义搜索、RAG
              </p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                自动化
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                定时任务、渠道集成、Webhook
              </p>
            </div>
          </div>
        </div>

        {/* 链接 */}
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
            相关链接
          </h4>
          <div className="space-y-2 text-sm">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                switchNav("docs");
              }}
              className="block px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded text-blue-600 dark:text-blue-400 hover:underline"
            >
              查看帮助文档
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default HelpPage;
