/**
 * P33 · 授权强度模型（准入判定）单元测试
 *
 * 覆盖方案 `dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P33 的验收口径：
 * ① 准入短路链的 6 条分支与 3 类拒绝原因；
 * ② `off / observe / auto` 三档的接单语义（`observe` 只记 would-accept，零副作用）；
 * ③ 结束态唤醒前的重校验（五类依据分别判）；
 * ④ 配置变更只产 `PolicyEffect`，不撤销授权。
 */
import { describe, it, expect } from 'bun:test';

import {
  ADMISSION_DEFAULTS,
  admitsInferred,
  buildPolicyVersion,
  decideAcceptance,
  diffPolicyEffects,
  evaluateGate,
  resolveAdmission,
  resolveAdmissionCell,
  revalidateMandate,
  STRENGTH_RANK,
} from '@openliri/infra/permission';

import type {
  GateFacts,
  Mandate,
  PolicySnapshot,
} from '@openliri/infra/permission';

function facts(over: Partial<GateFacts>): GateFacts {
  return {
    human: true,
    addressed: false,
    followup: false,
    allowed: false,
    listened: true,
    mode: 'observe',
    ...over,
  };
}

function snap(over: Partial<PolicySnapshot>): PolicySnapshot {
  return {
    version: 'ps1-test',
    mode: 'auto',
    enabledRuleIds: new Set(['r1']),
    ruleText: new Map([['r1', 'rule one']]),
    senderAllowed: true,
    botListed: true,
    ...over,
  };
}

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    strength: 'inferred',
    basis: {
      via: 'admission',
      cell: 'listedUnaddressed',
      rules: ['r1'],
      policyVersion: 'ps1-test',
    },
    scope: { source: 'cron', thread: 't1' },
    ...over,
  };
}

describe('P33 · 强度序与准入表缺省', () => {
  it('强度单调序：ignore < inferred < explicit（只用于"不得降级"）', () => {
    expect(STRENGTH_RANK.ignore).toBeLessThan(STRENGTH_RANK.inferred);
    expect(STRENGTH_RANK.inferred).toBeLessThan(STRENGTH_RANK.explicit);
  });

  it('单元格解析：白名单内且指向代理 ⇒ 无需单元格', () => {
    expect(resolveAdmissionCell(true, true)).toBeUndefined();
    expect(resolveAdmissionCell(true, false)).toBe('listedUnaddressed');
    expect(resolveAdmissionCell(false, true)).toBe('unlistedAddressed');
    expect(resolveAdmissionCell(false, false)).toBe('unlistedUnaddressed');
  });

  it('准入表缺省：白名单内未指向默认 inferred，其余默认 ignore', () => {
    expect(resolveAdmission(undefined, undefined, 'listedUnaddressed')).toBe(
      'inferred'
    );
    expect(resolveAdmission(undefined, undefined, 'unlistedAddressed')).toBe(
      'ignore'
    );
    expect(resolveAdmission(undefined, undefined, 'unlistedUnaddressed')).toBe(
      'ignore'
    );
    expect(ADMISSION_DEFAULTS.listedUnaddressed).toBe('inferred');
  });

  it('表值优先于缺省', () => {
    const table = { 'chat#1': { unlistedAddressed: 'explicit' as const } };
    expect(resolveAdmission(table, 'chat#1', 'unlistedAddressed')).toBe(
      'explicit'
    );
  });
});

describe('P33 · 准入短路链（evaluateGate）', () => {
  it('来源未监听 ⇒ source_not_listening', () => {
    expect(evaluateGate(facts({ listened: false }))).toEqual({
      admitted: false,
      reason: 'source_not_listening',
    });
  });

  it('非人类且不在 bot 白名单 ⇒ not_human', () => {
    expect(evaluateGate(facts({ human: false, listedBot: false }))).toEqual({
      admitted: false,
      reason: 'not_human',
    });
  });

  it('bot 在名单内：off 拒绝，observe 产 inferred（via=bot）', () => {
    expect(
      evaluateGate(facts({ human: false, listedBot: true, mode: 'off' }))
    ).toEqual({ admitted: false, reason: 'admission_ignored' });
    expect(
      evaluateGate(facts({ human: false, listedBot: true, mode: 'observe' }))
    ).toEqual({ admitted: true, strength: 'inferred', via: 'bot' });
  });

  it('白名单内 + 指向代理 ⇒ explicit（off 模式同样有效）', () => {
    const r = evaluateGate(
      facts({ allowed: true, addressed: true, mode: 'off' })
    );
    expect(r).toMatchObject({
      admitted: true,
      strength: 'explicit',
      via: 'addressed',
    });
  });

  it('准入单元格 explicit 优先于 followup（线程上的 Ticket 不得降级显式请求）', () => {
    const r = evaluateGate(
      facts({
        allowed: false,
        addressed: true,
        followup: true,
        cell: 'unlistedAddressed',
        admission: 'explicit',
        mode: 'off',
      })
    );
    expect(r).toMatchObject({
      admitted: true,
      strength: 'explicit',
      via: 'admission',
    });
  });

  it('followup：白名单内显式、白名单外推断；off 下推断不成立', () => {
    expect(
      evaluateGate(facts({ allowed: true, followup: true }))
    ).toMatchObject({ admitted: true, strength: 'explicit', via: 'followup' });
    expect(
      evaluateGate(facts({ allowed: false, followup: true, mode: 'observe' }))
    ).toMatchObject({ admitted: true, strength: 'inferred', via: 'followup' });
    expect(
      evaluateGate(facts({ allowed: false, followup: true, mode: 'off' }))
    ).toEqual({ admitted: false, reason: 'not_a_member' });
  });

  it('陌生人的私聊不构成 followup', () => {
    const r = evaluateGate(
      facts({
        allowed: false,
        addressed: true,
        directMessage: true,
        followup: true,
        cell: 'unlistedAddressed',
        admission: 'ignore',
        mode: 'observe',
      })
    );
    expect(r.admitted).toBe(false);
  });

  it('准入表 inferred + 非 off ⇒ inferred', () => {
    const r = evaluateGate(
      facts({
        allowed: true,
        cell: 'listedUnaddressed',
        admission: 'inferred',
        mode: 'auto',
      })
    );
    expect(r).toMatchObject({
      admitted: true,
      strength: 'inferred',
      via: 'admission',
    });
  });

  it('准入表 ignore ⇒ admission_ignored', () => {
    expect(
      evaluateGate(
        facts({
          allowed: true,
          cell: 'listedUnaddressed',
          admission: 'ignore',
        })
      )
    ).toEqual({ admitted: false, reason: 'admission_ignored' });
  });
});

describe('P33 · 接单决定（off / observe / auto）', () => {
  it('explicit 在任何模式都按研判结果接单', () => {
    for (const mode of ['off', 'observe', 'auto'] as const) {
      expect(
        decideAcceptance({ strength: 'explicit', mode, positive: true })
      ).toEqual({
        action: 'accept',
      });
    }
  });

  it('inferred：off 忽略、observe 记录 would-accept、auto 接单', () => {
    expect(
      decideAcceptance({ strength: 'inferred', mode: 'off', positive: true })
    ).toEqual({ action: 'ignore', wouldAccept: false });
    expect(
      decideAcceptance({
        strength: 'inferred',
        mode: 'observe',
        positive: true,
      })
    ).toEqual({ action: 'ignore', wouldAccept: true });
    expect(
      decideAcceptance({
        strength: 'inferred',
        mode: 'observe',
        positive: false,
      })
    ).toEqual({ action: 'ignore', wouldAccept: false });
    expect(
      decideAcceptance({ strength: 'inferred', mode: 'auto', positive: true })
    ).toEqual({ action: 'accept' });
  });

  it('主动接单必须有至少一条命中规则且全部仍启用', () => {
    const enabled = new Set(['r1']);
    expect(admitsInferred('auto', ['r1'], enabled)).toBe(true);
    expect(admitsInferred('auto', [], enabled)).toBe(false);
    expect(admitsInferred('auto', ['r2'], enabled)).toBe(false);
    expect(admitsInferred('off', ['r1'], enabled)).toBe(false);
    expect(admitsInferred('observe', ['r1'], enabled)).toBe(true);
  });
});

describe('P33 · 唤醒前重校验（revalidateMandate）', () => {
  it('来源不再监听 ⇒ source_off', () => {
    const r = revalidateMandate(mandate(), {
      sourceStillListens: false,
      mode: 'auto',
      enabledRuleIds: new Set(['r1']),
      senderStillAllowed: true,
      botStillListed: true,
    });
    expect(r).toEqual({ ok: false, reason: 'source_off' });
  });

  it('显式 followup 与非 auto 模式无关（仍有效）', () => {
    const m = mandate({
      strength: 'explicit',
      basis: { via: 'followup', policyVersion: 'ps1-test' },
    });
    expect(
      revalidateMandate(m, {
        sourceStillListens: true,
        mode: 'off',
        enabledRuleIds: new Set(),
        senderStillAllowed: true,
        botStillListed: true,
      })
    ).toEqual({ ok: true });
  });

  it('推断 followup：非 auto ⇒ mode_off；命中规则停用 ⇒ rules_disabled', () => {
    const m = mandate({
      strength: 'inferred',
      basis: { via: 'followup', rules: ['r1'], policyVersion: 'ps1-test' },
    });
    expect(
      revalidateMandate(m, {
        sourceStillListens: true,
        mode: 'observe',
        enabledRuleIds: new Set(['r1']),
        senderStillAllowed: true,
        botStillListed: true,
      })
    ).toEqual({ ok: false, reason: 'mode_off' });
    expect(
      revalidateMandate(m, {
        sourceStillListens: true,
        mode: 'auto',
        enabledRuleIds: new Set(),
        senderStillAllowed: true,
        botStillListed: true,
      })
    ).toEqual({ ok: false, reason: 'rules_disabled' });
  });

  it('表格准入被削弱（explicit → inferred）⇒ weakened', () => {
    const m = mandate({
      strength: 'explicit',
      basis: {
        via: 'admission',
        cell: 'unlistedAddressed',
        policyVersion: 'ps1-test',
      },
    });
    expect(
      revalidateMandate(m, {
        sourceStillListens: true,
        mode: 'auto',
        enabledRuleIds: new Set(['r1']),
        senderStillAllowed: false,
        botStillListed: true,
        admissionStrengthNow: 'inferred',
      })
    ).toEqual({ ok: false, reason: 'weakened' });
  });

  it('发送者已被加入白名单且原本是"陌生 @ 我" ⇒ 直接通过', () => {
    const m = mandate({
      strength: 'explicit',
      basis: {
        via: 'admission',
        cell: 'unlistedAddressed',
        policyVersion: 'ps1-test',
      },
    });
    expect(
      revalidateMandate(m, {
        sourceStillListens: true,
        mode: 'off',
        enabledRuleIds: new Set(),
        senderStillAllowed: true,
        botStillListed: true,
      })
    ).toEqual({ ok: true });
  });

  it('bot 被移出名单 ⇒ bot_not_listed；白名单发送者被移除 ⇒ sender_not_allowed', () => {
    expect(
      revalidateMandate(
        mandate({
          strength: 'inferred',
          basis: { via: 'bot', rules: ['r1'], policyVersion: 'ps1-test' },
        }),
        {
          sourceStillListens: true,
          mode: 'auto',
          enabledRuleIds: new Set(['r1']),
          senderStillAllowed: true,
          botStillListed: false,
        }
      )
    ).toEqual({ ok: false, reason: 'bot_not_listed' });
    expect(
      revalidateMandate(
        mandate({
          strength: 'explicit',
          basis: { via: 'addressed', policyVersion: 'ps1-test' },
        }),
        {
          sourceStillListens: true,
          mode: 'auto',
          enabledRuleIds: new Set(['r1']),
          senderStillAllowed: false,
          botStillListed: true,
        }
      )
    ).toEqual({ ok: false, reason: 'sender_not_allowed' });
  });
});

describe('P33 · 配置变更只产效果、不撤销授权（diffPolicyEffects）', () => {
  const tickets = [{ id: 't-1', mandate: mandate() }];

  it('命中规则被禁用 ⇒ rules: disabled', () => {
    const effects = diffPolicyEffects(
      tickets,
      snap({}),
      snap({ enabledRuleIds: new Set() })
    );
    expect(effects.get('t-1')).toEqual({
      rules: [{ id: 'r1', change: 'disabled' }],
    });
  });

  it('规则文案变更 ⇒ rules: changed', () => {
    const effects = diffPolicyEffects(
      tickets,
      snap({}),
      snap({ ruleText: new Map([['r1', 'rule one v2']]) })
    );
    expect(effects.get('t-1')).toEqual({
      rules: [{ id: 'r1', change: 'changed' }],
    });
  });

  it('发送者失去资格 ⇒ requesterAllowed:false（而非 proactive）', () => {
    const effects = diffPolicyEffects(
      tickets,
      snap({}),
      snap({ senderAllowed: false })
    );
    expect(effects.get('t-1')).toEqual({ requesterAllowed: false });
  });

  it('auto → observe 的推断授权 ⇒ proactive:false（不取消在途工作）', () => {
    const effects = diffPolicyEffects(
      tickets,
      snap({}),
      snap({ mode: 'observe' })
    );
    expect(effects.get('t-1')).toEqual({ proactive: false });
  });

  it('无影响的授权不出现在结果里', () => {
    const effects = diffPolicyEffects(tickets, snap({}), snap({}));
    expect(effects.size).toBe(0);
  });
});

describe('P33 · Policy 版本号', () => {
  it('同输入同结果、不同输入不同结果，且带前缀', () => {
    const a = buildPolicyVersion(['auto', 'r1:rule one', 'cron:[]']);
    const b = buildPolicyVersion(['auto', 'r1:rule one', 'cron:[]']);
    const c = buildPolicyVersion(['observe', 'r1:rule one', 'cron:[]']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('ps1-')).toBe(true);
  });

  it('分隔符参与运算，避免拼接撞车', () => {
    expect(buildPolicyVersion(['ab', 'c'])).not.toBe(
      buildPolicyVersion(['a', 'bc'])
    );
  });
});
