import { SkillInjectionService } from '@modules/skills/services/SkillInjectionService';
import { SkillRegistry } from '@modules/skills/SkillRegistry';

// 技能注册表/注入服务单例 —— 惰性 Proxy（2026-08-30，T7 单测 TDZ 根因修复）：
// 原 `new SkillRegistry()` / `new SkillInjectionService()` 在模块顶层立即执行，
// bun test worker 的依赖图加载序（skills → … → systemPromptSections → skills）
// 触发 `Cannot access 'SkillRegistry' before initialization`（生产 main.ts 启动序正常，
// 仅 bun test 加载序触发）。对齐 aiService.ts 惰性 Proxy 模式：首次访问成员才实例化，
// 消费方用法不变。实测 loopGuard/aiService 同模式已验证可用。
let _skillRegistry: SkillRegistry | undefined;
export const skillRegistry = new Proxy({} as SkillRegistry, {
  get(_target, prop: keyof SkillRegistry, receiver) {
    _skillRegistry ??= new SkillRegistry();
    const value = Reflect.get(_skillRegistry, prop, _skillRegistry);
    return typeof value === 'function' ? value.bind(_skillRegistry) : value;
  },
});

let _skillInjectionService: SkillInjectionService | undefined;
export const skillInjectionService = new Proxy({} as SkillInjectionService, {
  get(_target, prop: keyof SkillInjectionService, receiver) {
    _skillInjectionService ??= new SkillInjectionService(skillRegistry);
    const value = Reflect.get(
      _skillInjectionService,
      prop,
      _skillInjectionService
    );
    return typeof value === 'function'
      ? value.bind(_skillInjectionService)
      : value;
  },
});
