/**
 * B2（2026-09-26，《Liri 优化方案》）：网络策略**声明层**的结构性回归。
 *
 * 方案验收原文是"威胁模型用例 —— 沙箱内尝试清空/篡改策略后，实际网络行为不变"，
 * 那需要**真实容器**（本仓无 Docker CI ⇒ 未做，见 spec §7）。本文件锁的是它的**结构性代理**：
 *  ① `dockerArgs` **永不**含 `--cap-add`（不再把 NET_ADMIN 交给被约束方）；
 *  ② `dockerArgs` **永不**含容器内执行形态（`exec` / `sh -c` / `iptables`）—— 本仓不再"进容器下发策略"；
 *  ③ 端口白名单**本仓不执行** ⇒ 显式列入 `unenforcedInThisRepo` 并按 **fail-closed 收窄**；
 *  ④ 执行责任方恒为 `host`。
 *
 * 纯函数、离线可跑（不依赖 Docker 是否可用）。
 */
import { describe, expect, it } from 'bun:test';
import {
  compileNetworkPolicy,
  type NetworkPolicyPlan,
} from '../../src/sandbox/docker/NetworkPolicyEngine';
import type { DockerNetworkConfig } from '../../src/sandbox/docker/DockerNetworkPolicy';

function plan(config: DockerNetworkConfig): NetworkPolicyPlan {
  return compileNetworkPolicy(config);
}

/** 声明里的参数是否"进入容器执行"（宿主侧参数不应包含这些形态） */
function hasInContainerExecution(args: string[]): boolean {
  return args.some(
    (a) =>
      a.includes('exec') ||
      a.includes('sh -c') ||
      a.includes('iptables') ||
      a.includes('/etc/hosts')
  );
}

describe('B2: 结构性断言（不再把执行权交给被约束方）', () => {
  const configs: DockerNetworkConfig[] = [
    { mode: 'none' },
    { mode: 'bridge' },
    { mode: 'bridge', allowedPorts: [443, 80] },
    { mode: 'host', allowedPorts: [443] },
    { mode: 'none', blockedDomains: ['evil.com'] },
    { mode: 'custom', customNetworkName: 'mynet', allowedDomains: ['pypi.org'] },
  ];

  it('任何配置下 dockerArgs 都不含 --cap-add（NET_ADMIN 不再授予）', () => {
    for (const c of configs) {
      const args = plan(c).dockerArgs;
      expect(args.join(' ')).not.toContain('--cap-add');
      expect(args.join(' ')).not.toContain('NET_ADMIN');
    }
  });

  it('任何配置下 dockerArgs 都不含"进容器执行"形态（exec / sh -c / iptables / /etc/hosts）', () => {
    for (const c of configs) {
      expect(hasInContainerExecution(plan(c).dockerArgs)).toBe(false);
    }
  });

  it('执行责任方恒为 host', () => {
    for (const c of configs) {
      expect(plan(c).enforcementOwner).toBe('host');
    }
  });
});

describe('B2: 默认策略（mode=none，无白/黑名单）', () => {
  it('只下达 --network none，且无需外部执行项', () => {
    const p = plan({ mode: 'none' });
    expect(p.dockerArgs).toEqual(['--network', 'none']);
    expect(p.effectiveNetworkMode).toBe('none');
    expect(p.narrowedByFailClosed).toBe(false);
    expect(p.unenforcedInThisRepo).toEqual([]);
  });
});

describe('B2: 端口白名单 ⇒ fail-closed 收窄（不静默降级）', () => {
  it('bridge + allowedPorts ⇒ 收窄为 none，并显式列出未执行项', () => {
    const p = plan({ mode: 'bridge', allowedPorts: [443] });
    expect(p.narrowedByFailClosed).toBe(true);
    expect(p.effectiveNetworkMode).toBe('none');
    expect(p.dockerArgs).toEqual(['--network', 'none']);
    expect(p.unenforcedInThisRepo.join(' ')).toContain('egress-port-whitelist');
    expect(p.allowedPorts).toEqual([443]);
  });

  it('本就是 none + allowedPorts ⇒ 不算"收窄"，但仍列出未执行项（不假装已按端口限制）', () => {
    const p = plan({ mode: 'none', allowedPorts: [443] });
    expect(p.narrowedByFailClosed).toBe(false);
    expect(p.effectiveNetworkMode).toBe('none');
    expect(p.unenforcedInThisRepo.join(' ')).toContain('egress-port-whitelist');
  });
});

describe('B2: 域名黑名单只做宿主侧 --add-host 黑洞（并如实标注其局限）', () => {
  it('生成 --add-host <domain>:0.0.0.0，并列入未执行项（容器内可改 + 不阻断 DNS 直查）', () => {
    const p = plan({ mode: 'bridge', blockedDomains: ['evil.com', 'bad.org'] });
    // bridge 不是 docker 的显式参数 ⇒ 只追加 --add-host（宿主侧创建期下发）
    expect(p.dockerArgs).toEqual([
      '--add-host',
      'evil.com:0.0.0.0',
      '--add-host',
      'bad.org:0.0.0.0',
    ]);
    expect(p.unenforcedInThisRepo.join(' ')).toContain('domain-blacklist');
    // 不再写容器内 /etc/hosts（改由创建期 --add-host 下发）
    expect(hasInContainerExecution(p.dockerArgs)).toBe(false);
  });

  it('域名白名单 ⇒ 列入未执行项（需宿主侧 DNS 层）', () => {
    const p = plan({ mode: 'bridge', allowedDomains: ['pypi.org'] });
    expect(p.unenforcedInThisRepo.join(' ')).toContain('domain-allowlist');
  });
});

describe('B2: custom 网络模式', () => {
  it('有名字 ⇒ --network <name>', () => {
    const p = plan({ mode: 'custom', customNetworkName: 'liri-net' });
    expect(p.dockerArgs).toEqual(['--network', 'liri-net']);
  });

  it('缺名字 ⇒ fail-closed 为 none（不再把字面量 "custom" 当网络名）', () => {
    const p = plan({ mode: 'custom' });
    expect(p.dockerArgs).toEqual(['--network', 'none']);
  });
});
