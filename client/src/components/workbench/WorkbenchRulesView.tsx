/**
 * 工作台「规则」视图适配器
 *
 * `CustomRulesPanel` 是设置页内嵌面板（需 `isDark` 属性），本适配器按设置页同一来源
 * （`configStore.config.theme`）注入主题后，使其可作为独立工作台视图使用 ——
 * 复用既有规则 UI，不重写（CS01 归一化）。
 */

import CustomRulesPanel from "../settings/CustomRulesPanel";
import { useConfigStore } from "@/stores/configStore";

export default function WorkbenchRulesView() {
  const config = useConfigStore((s) => s.config);
  return <CustomRulesPanel isDark={config.theme === "dark"} />;
}
