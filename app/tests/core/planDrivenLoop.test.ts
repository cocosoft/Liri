// MIT License
// Copyright (c) 2026 190615273@qq.com

// S0 行为冻结（2026-08-13）：复杂度判定结构化（CS02）+ 子任务上限唯一来源
// S3（2026-08-13）：快速路径准入（isEligibleForFastPath：复杂度门 + 危险工具过滤）
import { describe, it, expect } from 'bun:test';
import {
  classifyTaskComplexity,
  SIMPLE_TASK_MAX_LENGTH,
  hasDangerousToolIntent,
  isEligibleForFastPath,
  PlanDrivenLoop,
  type TAORLoopFactoryOptions,
} from '../../src/core/loop/PlanDrivenLoop';
import { MAX_SUBTASKS } from '../../src/ai/router/TaskDecomposer';
import type { TAORLoop } from '../../src/query/TAORLoop';
import type { TAORLoopDeps } from '../../src/query/TAORLoop';

describe('classifyTaskComplexity — 结构化判定（无正则）', () => {
  it('空/空白消息判定为 complex（不误入快速路径）', () => {
    expect(classifyTaskComplexity('')).toBe('complex');
    expect(classifyTaskComplexity('   ')).toBe('complex');
  });

  it('短问候/致谢/短问题（≤60）判定为 simple', () => {
    expect(classifyTaskComplexity('你好')).toBe('simple');
    expect(classifyTaskComplexity('谢谢')).toBe('simple');
    expect(classifyTaskComplexity('什么是 React')).toBe('simple');
    expect(classifyTaskComplexity('翻译这段话：Hello world')).toBe('simple');
  });

  it('恰好等于阈值的消息判定为 simple', () => {
    const msg = '你'.repeat(SIMPLE_TASK_MAX_LENGTH);
    expect(msg.length).toBe(SIMPLE_TASK_MAX_LENGTH);
    expect(classifyTaskComplexity(msg)).toBe('simple');
  });

  it('超过阈值的长任务判定为 complex', () => {
    const msg = '请'.repeat(SIMPLE_TASK_MAX_LENGTH + 1);
    expect(classifyTaskComplexity(msg)).toBe('complex');
  });

  it('trim 后按有效长度判定（首尾空白不计入）', () => {
    const inner = '你'.repeat(SIMPLE_TASK_MAX_LENGTH);
    expect(classifyTaskComplexity(`  ${inner}  `)).toBe('simple');
  });
});

describe('子任务上限唯一来源（S0 冻结）', () => {
  it('MAX_SUBTASKS 为 5（TaskDecomposer 唯一事实来源）', () => {
    expect(MAX_SUBTASKS).toBe(5);
  });
});

describe('hasDangerousToolIntent — 危险工具意图过滤（S3）', () => {
  it('识别删除/移除类意图', () => {
    expect(hasDangerousToolIntent('请删除这个文件')).toBe(true);
    expect(hasDangerousToolIntent('移除整个目录')).toBe(true);
    expect(hasDangerousToolIntent('delete test.txt')).toBe(true);
  });

  it('识别发送/写入/覆盖类意图', () => {
    expect(hasDangerousToolIntent('发送邮件给张三')).toBe(true);
    expect(hasDangerousToolIntent('写入配置并覆盖')).toBe(true);
    expect(hasDangerousToolIntent('overwrite the file')).toBe(true);
  });

  it('普通消息不误判', () => {
    expect(hasDangerousToolIntent('帮我整理这个项目')).toBe(false);
    expect(hasDangerousToolIntent('什么是 React')).toBe(false);
  });
});

describe('isEligibleForFastPath — S3 两层分流第一层', () => {
  it('简单任务且无危险工具 → 合格', () => {
    expect(isEligibleForFastPath('你好')).toBe(true);
    expect(isEligibleForFastPath('解释一下什么是依赖注入')).toBe(true);
  });

  it('含危险工具即使简单也不合格（后果不可逆，走经典路径质量门）', () => {
    expect(isEligibleForFastPath('删除这个文件')).toBe(false);
    expect(isEligibleForFastPath('发送消息')).toBe(false);
  });

  it('复杂任务不合格（复杂度门筛除）', () => {
    const longMsg = '请'.repeat(SIMPLE_TASK_MAX_LENGTH + 1);
    expect(isEligibleForFastPath(longMsg)).toBe(false);
  });
});

describe('D1: taorLoopFactory 二元签名契约（PDL 侧）', () => {
  it('二元工厂 (sessionId, opts?) 可注入且被原样保存（与 LRTO/PdcaLauncher 同一契约）', () => {
    // D1（2026-09-17）：PDL 原一元声明导致调用方二元工厂的 opts 类型不被识别，
    // PDL 内部只传 sessionId 时 opts 静默丢失。放宽签名后，二元工厂须可注入且不丢失。
    const fakeLoop = {} as TAORLoop;
    const factory = (
      _sessionId: string,
      _opts?: TAORLoopFactoryOptions
    ): TAORLoop => fakeLoop;

    const pdl = new PlanDrivenLoop({
      taorLoop: fakeLoop,
      deps: {} as TAORLoopDeps,
      sessionId: 's1',
      taorLoopFactory: factory,
    });

    const stored = (
      pdl as unknown as {
        taorLoopFactory?: (
          sessionId: string,
          opts?: TAORLoopFactoryOptions
        ) => TAORLoop;
      }
    ).taorLoopFactory;
    expect(stored).toBe(factory);
  });
});
