/**
 * zh 语言包组装点（H-1 拆分：base + settings + knowledge + workspace + misc）
 *
 * 仅做对象拼装，保持原 `zh.ts` 的顶层键顺序与叶子值不变。
 */
import zhBase from "./base";
import zhSettings from "./settings";
import zhKnowledge from "./knowledge";
import zhWorkspace from "./workspace";
import zhMisc from "./misc";

const zh = {
  ...zhBase,
  ...zhSettings,
  ...zhKnowledge,
  ...zhWorkspace,
  ...zhMisc,
};

export default zh;
