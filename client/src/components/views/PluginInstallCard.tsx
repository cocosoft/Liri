/**
 * PluginInstallCard — 渠道插件安装引导卡片
 * 当 QQ/飞书/钉钉/企业微信 渠道对应插件未安装时显示
 */

interface PluginInstallCardProps {
  channelLabel: string;
  pluginNames: string[];
  isInstalling: boolean;
  onInstall: () => void;
}

/** 渠道→CLI 备用安装命令映射 */
function getCliCommands(pluginNames: string[]): string[] {
  if (pluginNames.length === 0) {
    return ["# 无可用插件包"];
  }
  return pluginNames.map((name) => `npm install ${name}`);
}

function PluginInstallCard({
  channelLabel,
  pluginNames,
  isInstalling,
  onInstall,
}: PluginInstallCardProps) {
  const commands = getCliCommands(pluginNames);

  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔌</span>
          <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
            插件未安装
          </span>
        </div>
        <button
          onClick={onInstall}
          disabled={isInstalling}
          className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors"
        >
          {isInstalling ? "安装中..." : "安装插件"}
        </button>
      </div>

      <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
        {channelLabel} 需要 {pluginNames.join(" / ")} 插件才能正常工作。
        点击"安装插件"自动通过 npm 安装。
      </p>

      <details className="text-xs">
        <summary className="text-amber-600 dark:text-amber-400 cursor-pointer hover:underline">
          如安装失败，请在终端执行以下命令：
        </summary>
        <div className="mt-2 p-2 rounded bg-gray-900 text-gray-200 font-mono text-xs overflow-x-auto">
          {commands.map((cmd, i) => (
            <div key={i}>{cmd}</div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default PluginInstallCard;
