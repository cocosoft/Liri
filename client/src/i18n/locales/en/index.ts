/**
 * en 语言包组装点（H-1 拆分：base + settings + knowledge + workspace + misc）
 *
 * 仅做对象拼装，保持原 `en.ts` 的顶层键顺序与叶子值不变。
 */
import enBase from "./base";
import enSettings from "./settings";
import enKnowledge from "./knowledge";
import enWorkspace from "./workspace";
import enMisc from "./misc";

const en = {
  ...enBase,
  ...enSettings,
  ...enKnowledge,
  ...enWorkspace,
  ...enMisc,
};

export default en;
