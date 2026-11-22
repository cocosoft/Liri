/**
 * P0（2026-11-22）：工具安全治理门禁的**判据单测**。
 *
 * 规范：`.trae/specs/tool-security-governance-plan.md`。
 * 本文件只测纯函数（缺口规则 / 台账校验 / 例外表校验），
 * 不实例化工具、不读写仓库文件 —— 生成物一致性由 `lint:tool-governance --check` 负责。
 */
import { describe, expect, it } from 'bun:test';

import {
  computeGaps,
  validateAcceptedGaps,
  validateEntrypoints,
  validateExceptions,
  type EntrypointsFile,
  type ExceptionsFile,
  type GapInput,
} from '../../scripts/lib/toolGovernanceRules';

function row(overrides: Partial<GapInput> = {}): GapInput {
  return {
    sandboxLevel: 'none',
    risk: { derived: 'write' },
    maxResultSizeChars: null,
    ...overrides,
  };
}

describe('computeGaps：缺口规则', () => {
  it('健康工具 ⇒ 无缺口', () => {
    const r = row({
      sandboxLevel: 'execution',
      risk: { derived: 'shell' },
      maxResultSizeChars: 100000,
    });
    expect(computeGaps(r)).toEqual([]);
  });

  it('派生不出风险档 ⇒ risk-undeclared', () => {
    const r = row({ risk: { derived: 'undeclared' } });
    expect(computeGaps(r)).toEqual(['risk-undeclared']);
  });

  it('shell 档但没有 execution 能力位 ⇒ shell-without-sandbox', () => {
    const r = row({ sandboxLevel: 'none', risk: { derived: 'shell' } });
    expect(computeGaps(r)).toEqual(['shell-without-sandbox']);
  });

  it('执行类没有结果上限 ⇒ no-result-limit（bash 有、powershell/code_run 缺）', () => {
    const r = row({
      sandboxLevel: 'execution',
      risk: { derived: 'shell' },
      maxResultSizeChars: null,
    });
    expect(computeGaps(r)).toEqual(['no-result-limit']);
  });
});

describe('validateEntrypoints：执行入口台账', () => {
  const scanned = [
    { file: 'src/a.ts', occurrences: 1 },
    { file: 'src/b.ts', occurrences: 2 },
  ];

  function registry(entries: EntrypointsFile['entries']): EntrypointsFile {
    return { scanRoots: ['src'], entries };
  }

  it('全部登记且一致 ⇒ 无错误', () => {
    expect(
      validateEntrypoints(
        registry([
          {
            file: 'src/a.ts',
            status: 'centralized',
            authorizedBy: 'ToolRegistry.executeTool',
            occurrences: 1,
            note: '',
          },
          {
            file: 'src/b.ts',
            status: 'authorized',
            authorizedBy: 'authorizeX',
            occurrences: 2,
            note: '',
          },
        ]),
        scanned
      )
    ).toEqual([]);
  });

  it('未登记的新入口 ⇒ 报错（新增直调必须复核授权）', () => {
    const errors = validateEntrypoints(registry([]), scanned);
    expect(errors).toContain('未登记的执行入口：src/a.ts（1 处 tool.execute）');
    expect(errors).toContain('未登记的执行入口：src/b.ts（2 处 tool.execute）');
  });

  it('出现次数漂移 / 台账僵尸条目 / 非法状态 ⇒ 报错', () => {
    const errors = validateEntrypoints(
      registry([
        {
          file: 'src/a.ts',
          status: 'centralized',
          authorizedBy: null,
          occurrences: 9,
          note: '',
        },
        {
          file: 'src/gone.ts',
          status: 'centralized',
          authorizedBy: null,
          occurrences: 1,
          note: '',
        },
        {
          file: 'src/b.ts',
          // 故意非法值：验证门禁对 status 的兜底
          status: 'wat' as never,
          authorizedBy: null,
          occurrences: 2,
          note: '',
        },
      ]),
      scanned
    );
    expect(errors.some((e) => e.includes('登记 9 处，实际 1 处'))).toBe(true);
    expect(errors.some((e) => e.includes('台账登记的入口已不存在'))).toBe(true);
    expect(errors.some((e) => e.includes('非法 status'))).toBe(true);
  });

  it('needs-review 必须写 note；authorized 必须写 authorizedBy', () => {
    const errors = validateEntrypoints(
      registry([
        {
          file: 'src/a.ts',
          status: 'needs-review',
          authorizedBy: null,
          occurrences: 1,
          note: '  ',
        },
        {
          file: 'src/b.ts',
          status: 'authorized',
          authorizedBy: null,
          occurrences: 2,
          note: '',
        },
      ]),
      scanned
    );
    expect(errors.some((e) => e.includes('needs-review 必须写 note'))).toBe(
      true
    );
    expect(
      errors.some((e) => e.includes('authorized 必须写 authorizedBy'))
    ).toBe(true);
  });

  it('caller-authorized 必须写 authorizedBy；unreachable 必须写证据 note（G6）', () => {
    const errors = validateEntrypoints(
      registry([
        {
          file: 'src/a.ts',
          status: 'caller-authorized',
          authorizedBy: null,
          occurrences: 1,
          note: '',
        },
        {
          file: 'src/b.ts',
          status: 'unreachable',
          authorizedBy: null,
          occurrences: 2,
          note: '',
        },
      ]),
      scanned
    );
    expect(
      errors.some((e) => e.includes('caller-authorized 必须写 authorizedBy'))
    ).toBe(true);
    expect(errors.some((e) => e.includes('unreachable 必须写 note'))).toBe(
      true
    );
  });
});

describe('validateExceptions：例外表', () => {
  const toolNames = ['bash', 'computer_use'];

  function exceptions(overrides: Partial<ExceptionsFile> = {}): ExceptionsFile {
    return { acceptedGaps: [], knownRisks: [], ...overrides };
  }

  it('合法例外 ⇒ 无错误', () => {
    expect(
      validateExceptions(
        exceptions({
          acceptedGaps: [
            {
              tool: 'bash',
              gaps: ['no-result-limit'],
              riskId: 'G9',
              reason: '历史遗留',
              plan: 'P2-0',
            },
          ],
          knownRisks: [
            {
              id: 'G1',
              tools: ['computer_use'],
              dimension: 'D5',
              reason: '待补声明',
              plan: 'P1-1',
            },
          ],
        }),
        toolNames
      )
    ).toEqual([]);
  });

  it('引用不存在的工具 / 缺 reason / id 重复 ⇒ 报错（防僵尸登记）', () => {
    const errors = validateExceptions(
      exceptions({
        acceptedGaps: [
          {
            tool: 'ghost_tool',
            gaps: ['risk-undeclared'],
            riskId: 'GX',
            reason: ' ',
            plan: ' ',
          },
        ],
        knownRisks: [
          {
            id: 'G1',
            tools: ['bash'],
            dimension: 'D5',
            reason: 'r',
            plan: 'p',
          },
          {
            id: 'G1',
            tools: ['missing'],
            dimension: 'D5',
            reason: 'r',
            plan: 'p',
          },
        ],
      }),
      toolNames
    );
    expect(errors.some((e) => e.includes('不存在的工具：ghost_tool'))).toBe(
      true
    );
    expect(errors.some((e) => e.includes('缺少 riskId / reason / plan'))).toBe(
      true
    );
    expect(errors.some((e) => e.includes('id 缺失或重复：G1'))).toBe(true);
    expect(errors.some((e) => e.includes('不存在的工具：missing'))).toBe(true);
  });
});

describe('validateAcceptedGaps：防僵尸豁免', () => {
  const rows = [{ name: 'bash', gaps: ['no-result-limit'] }];
  const base: ExceptionsFile = { acceptedGaps: [], knownRisks: [] };

  it('缺口仍存在 ⇒ 通过', () => {
    expect(
      validateAcceptedGaps(
        {
          ...base,
          acceptedGaps: [
            {
              tool: 'bash',
              gaps: ['no-result-limit'],
              riskId: 'G9',
              reason: 'r',
              plan: 'p',
            },
          ],
        },
        rows
      )
    ).toEqual([]);
  });

  it('缺口已被修复但例外仍在 ⇒ 报错（2026-11-22 notebook 实证）', () => {
    const errors = validateAcceptedGaps(
      {
        ...base,
        acceptedGaps: [
          {
            tool: 'bash',
            gaps: ['no-result-limit', 'risk-undeclared'],
            riskId: 'G9',
            reason: 'r',
            plan: 'p',
          },
        ],
      },
      rows
    );
    expect(errors).toContain(
      'acceptedGaps 已失效（矩阵不再检出）：bash[risk-undeclared]'
    );
  });

  it('工具已不存在 ⇒ 交由 validateExceptions 报，不在这里重复', () => {
    expect(
      validateAcceptedGaps(
        {
          ...base,
          acceptedGaps: [
            {
              tool: 'ghost',
              gaps: ['no-result-limit'],
              riskId: 'G',
              reason: 'r',
              plan: 'p',
            },
          ],
        },
        rows
      )
    ).toEqual([]);
  });
});
