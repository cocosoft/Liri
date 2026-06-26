import { useConfigStore } from "../../stores/configStore";

/**
 * 图像处理页面（占位）
 * 后续将实现 AI 图像生成、编辑等功能
 */
function ImagePage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  return (
    <div className={`flex flex-col items-center justify-center h-full ${isDark ? "text-gray-400" : "text-gray-500"}`}>
      <svg
        className="w-16 h-16 mb-4 opacity-50"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <h2 className="text-xl font-medium mb-2">图像处理</h2>
      <p className="text-sm">AI 图像生成与编辑功能，敬请期待</p>
    </div>
  );
}

export default ImagePage;
