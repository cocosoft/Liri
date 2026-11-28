// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P1-1（2026-11-06，审批/熔断根因簇）回归锁。
//
// 真机 `session_mw458fpp3ea32a050e`：连续 3 次 `tsc --noEmit` 报类型错（退出码 1）
// 被计入 `consecutiveInvalidTurns` 并触发 `circuit_breaker` —— 模型正在按错误修代码，
// 却被当成"输出无效"。
//
// 修复：检查/测试类命令的非零退出 = **有效证据**，由 `isExpectedNonzeroExit()` 结构化判定，
// BashTool 写 `failureKind='expected_nonzero_exit'`，`classifyTurn()` 判为 progress。
// 本文件同时守护负向边界：普通命令非零退出、写文件重定向、exit=0 都不得被误判。

import { describe, expect, it } from 'bun:test';
import {
  isEnvironmentProbeFailure,
  isExpectedNonzeroExit,
  lastCommandSegment,
} from '../../src/tools/bash/exitSemantics';
import { classifyTurn } from '@modules/query/ReActLoop';

describe('isExpectedNonzeroExit：检查/测试类命令的非零退出', () => {
  const yes = (command: string, exitCode = 1): void => {
    expect(isExpectedNonzeroExit({ command, exitCode })).toBe(true);
  };
  const no = (command: string, exitCode = 1): void => {
    expect(isExpectedNonzeroExit({ command, exitCode })).toBe(false);
  };

  it('类型检查：npx / bunx / 本地 node_modules 三种形态', () => {
    yes('npx tsc --noEmit');
    yes('bunx tsc --noEmit');
    yes('.\\node_modules\\.bin\\tsc.cmd --noEmit');
    yes('./node_modules/.bin/tsc --noEmit');
    yes('bun run typecheck');
  });

  it('测试与 lint', () => {
    yes('bun test');
    yes('bun test tests/chat');
    yes('npm test');
    yes('pnpm run test:unit');
    yes('npx vitest run');
    yes('eslint src tests');
    yes('bun run lint');
  });

  it('git diff 以退出码表达"有差异"', () => {
    yes('git diff --exit-code');
    yes('git diff --quiet HEAD');
  });

  it('复合命令按段检查（真机 powershell 包裹形态）', () => {
    yes('cd /d E:\\repo && npx tsc --noEmit');
    yes(
      `powershell -NoProfile -Command "cd 'E:\\repo'; npx tsc --noEmit --pretty false 2>&1"`
    );
  });

  it('负向：普通命令 / 非检查脚本 / exit=0 / 空命令 ⇒ 不得误判', () => {
    no('rm -rf build');
    no('node app.js');
    no('bun run build');
    no('cat missing.txt');
    no('npx tsc --noEmit', 0);
    expect(isExpectedNonzeroExit({ command: '', exitCode: 1 })).toBe(false);
    expect(isExpectedNonzeroExit({ command: 'npx tsc --noEmit' })).toBe(false);
  });
});

describe('lastCommandSegment：与检索无匹配判定共用同一实现', () => {
  it('取管道/串联的最后一段', () => {
    expect(lastCommandSegment('cd X && npx tsc --noEmit')).toBe(
      'npx tsc --noEmit'
    );
    expect(lastCommandSegment('dir /b | findstr a')).toBe('findstr a');
    expect(lastCommandSegment('a || b ; c')).toBe('c');
  });
});

describe('classifyTurn：expected_nonzero_exit 不计入 invalid', () => {
  it('连续 3 轮检查未通过 ⇒ progress（不再触发 circuit_breaker）', () => {
    expect(
      classifyTurn([{ status: 'error', failureKind: 'expected_nonzero_exit' }])
    ).toBe('progress');
  });

  it('负向：未分类失败 / 工具自身失败仍判 invalid', () => {
    expect(classifyTurn([{ status: 'error', failureKind: 'tool_error' }])).toBe(
      'invalid'
    );
    expect(classifyTurn([{ status: 'error' }])).toBe('invalid');
  });

  it('混合：检查未通过 + 真实失败 ⇒ 仍按失败分型（不洗白）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'expected_nonzero_exit' },
        { status: 'error', failureKind: 'tool_error' },
      ])
    ).toBe('invalid');
  });
});

/**
 * P0-2（2026-11-27，真机 `session_mwz477wj251057474e`）：环境层失败不得吃 invalid 预算。
 *
 * 该轮模型为"把写好的 SVG 转 PNG"连续执行 `npm install @resvg/resvg-js` →
 * `where magick & where inkscape …` → `pip install cairosvg`，三次都因本机缺依赖失败，
 * 却按"工具失败"计 invalid ⇒ 3 轮即 `circuit_breaker`（用户看到"画到一半报错中断"）。
 */
describe('isEnvironmentProbeFailure：安装失败 / 命令不存在探测', () => {
  const yes = (command: string, exitCode = 1): void => {
    expect(isEnvironmentProbeFailure({ command, exitCode })).toBe(true);
  };
  const no = (command: string, exitCode = 1): void => {
    expect(isEnvironmentProbeFailure({ command, exitCode })).toBe(false);
  };

  it('依赖获取（各包管理器）失败 ⇒ 环境层', () => {
    yes('npm install @resvg/resvg-js --no-audit --no-fund');
    yes('npm ci');
    yes('bun add sharp');
    yes('pip install cairosvg');
    yes('python -m pip install cairosvg --target output\\_pylibs');
    yes('cd /d E:\\repo && npm install');
    yes('winget install ImageMagick');
  });

  it('可执行文件探测无此命令（where / which / command -v）⇒ 环境层', () => {
    yes('where magick');
    yes('where magick & where inkscape & where rsvg-convert');
    yes('which magick');
    yes('command -v magick');
  });

  it('负向：普通命令 / 非安装脚本 / exit=0 / 无退出码 ⇒ 不得误判', () => {
    no('rm -rf build');
    no('node app.js');
    no('npm run build');
    no('npm test');
    no('del output\\a.svg');
    // 退出码来自最后一段 ⇒ 安装成功后的无关失败不背锅
    no('npm i a & del b');
    no('npm install', 0);
    no('where magick', 0);
    expect(isEnvironmentProbeFailure({ command: '' })).toBe(false);
    expect(isEnvironmentProbeFailure({ command: 'npm install' })).toBe(false);
  });

  it('classifyTurn：env_unavailable 判 environment_blocked（2 轮即有可执行结论）', () => {
    expect(
      classifyTurn([{ status: 'error', failureKind: 'env_unavailable' }])
    ).toBe('environment_blocked');
    // 与真实工具失败混合时仍按失败分型（不洗白）
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'env_unavailable' },
        { status: 'error', failureKind: 'tool_error' },
      ])
    ).toBe('invalid');
  });
});

/**
 * 2026-11-28（真机 `session_mwz477wj251057474e` 15:31Z 段）：**模块导入探测失败 = 环境层**。
 *
 * 现场：模型连做 `python -c "import cairosvg; print(…)"` / `import playwright` /
 * `where magick & where rsvg-convert …` 等探测，全部因本机没装而失败，却仍计入
 * `consecutiveInvalidTurns`（`reActLoop:all-tools-failed`，iteration 8/10/13/15/16/18）。
 * 既有分型只覆盖"安装命令 + where/which"，**模块导入探测**漏在网外。
 */
describe('isEnvironmentProbeFailure：模块导入探测（2026-11-28 补）', () => {
  const yes = (command: string, exitCode = 1): void => {
    expect(isEnvironmentProbeFailure({ command, exitCode })).toBe(true);
  };
  const no = (command: string, exitCode = 1): void => {
    expect(isEnvironmentProbeFailure({ command, exitCode })).toBe(false);
  };

  it('python -c "import …"（含分号后的 print）⇒ 环境层', () => {
    yes(`python -c "import cairosvg; print('cairosvg ok')"`);
    yes(`python -c "import playwright; print('playwright ok')"`);
    yes(`py -c "from cairosvg import svg2png"`);
    yes(`python3.11 -c "import PIL; print(PIL.__version__)"`);
  });

  it('node -e/-p require(...) ⇒ 环境层', () => {
    yes(`node -e "require('sharp')"`);
    yes(`node -p "require('resvg-js').version"`);
    yes(`node -e "const m = require('canvas')"`);
  });

  it('POSIX 路径探测 test -e/-f/-d ⇒ 环境层', () => {
    yes('test -e node_modules/sharp');
    yes('test -d output');
  });

  it('多个模块探测用 & 串联（真机形态）⇒ 环境层', () => {
    yes(
      `python -c "import playwright; print('playwright ok')" & python -c "import resvg_py; print('resvg ok')" & python -c "import svglib; print('svglib ok')"`
    );
  });

  it('负向：普通脚本 / 非导入的 -c 体 / 复合命令 / 产物核对 ⇒ 不得误判', () => {
    no('python scripts/build.py');
    no(`python -c "print(open('x').read())"`);
    no('node app.js');
    // 带 && 的复合命令不按"整条即探测"处理（语义主体未必是探测）
    no(`python -c "import x" && node build.js`);
    // 产物存在性核对：失败是任务未达成，不得洗白成环境层
    no('dir /b output\\pelican.svg');
    no('ls output');
  });
});
