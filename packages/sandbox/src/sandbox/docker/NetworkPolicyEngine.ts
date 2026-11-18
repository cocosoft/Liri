/**
 * 网络策略**声明层**（B2，2026-09-26，《Liri 优化方案》）
 *
 * ⚠️ **B2 的结构性修复：策略执行者不得与被约束者同处一个权限域。**
 *
 * - **改前（假安全）**：本模块经 `docker exec … sh -c "iptables …"` 在**容器内**下发端口白名单
 *   （依赖 `docker create --cap-add=NET_ADMIN`），域名黑名单则 `echo >> /etc/hosts` 写进容器
 *   ⇒ 容器内进程**持有 CAP_NET_ADMIN**，一条 `iptables -F` 即可清空全部规则。
 * - **改后**：本模块**只生成声明**（纯函数，**零 exec**）；实际执行交**宿主侧**
 *   （方案建议：Windows = Docker 网络 + 宿主防火墙；Linux = nftables 作用于 veth，或 eBPF）。
 *
 * **本仓在宿主侧能落地、且无需任何 capability 的两项**：
 * 1. `--network`（含默认 `none`）—— 由 `docker create` 参数承担；
 * 2. `--add-host <domain>:0.0.0.0` —— 域名黑洞**在创建时由宿主侧下发**（替代原 `docker exec` 写 /etc/hosts）。
 *
 * **fail-closed（关键取舍，避免静默降级）**：若配置了端口白名单，而本仓**没有**宿主侧执行器，
 * **不会**假装"端口已受限"，而是把网络模式**收窄为 `none`**（宁可全禁，也不给假象）并告警。
 *
 * 说明（分寸如实）：本项属**静态可断言的结构性修复** —— 改了"执行者与被约束者同域"这一形态，
 * **没有**构造逃逸实验，故**不声称**"已修复某个可复现漏洞"。
 */

import type { DockerNetworkConfig } from './DockerNetworkPolicy';

/**
 * 网络策略声明（供宿主侧执行层消费；本仓只下达能下达的部分）
 */
export interface NetworkPolicyPlan {
  /** 配置里请求的网络模式 */
  sourceMode: DockerNetworkConfig['mode'];
  /** 本仓**实际会用的**网络模式（可能被 fail-closed 收窄为 `none`） */
  effectiveNetworkMode: DockerNetworkConfig['mode'];
  /** 是否因 fail-closed 收窄 */
  narrowedByFailClosed: boolean;
  /** 实际会追加到 `docker create` 的参数（**全部为宿主侧参数**，绝不包含 `--cap-add`） */
  dockerArgs: string[];
  /** 域名黑名单（宿主侧还应另做强制；`--add-host` 只是软控制） */
  blockedDomains: string[];
  /** 端口白名单（本仓**不执行**，需宿主侧执行器） */
  allowedPorts: number[];
  /** 执行责任方：恒为 `host`（B2 的核心结论） */
  enforcementOwner: 'host';
  /**
   * **本仓不执行**的限制项（显式列出，避免"以为已生效"）。
   * 非空时 `DockerSandbox` 会打 WARN。
   */
  unenforcedInThisRepo: string[];
}

/**
 * 把网络配置编译为**声明**（纯函数：不 exec、不读写文件、不依赖 Docker 是否可用）。
 */
export function compileNetworkPolicy(
  config: DockerNetworkConfig
): NetworkPolicyPlan {
  const blockedDomains = config.blockedDomains ?? [];
  const allowedPorts = config.allowedPorts ?? [];
  const unenforcedInThisRepo: string[] = [];

  let effectiveNetworkMode = config.mode;
  let narrowedByFailClosed = false;

  if (allowedPorts.length > 0) {
    // 按端口强制出站**必须**在宿主侧（nftables/eBPF/宿主防火墙）；本仓不再用容器内 iptables
    unenforcedInThisRepo.push(
      'egress-port-whitelist（按端口强制出站需宿主侧执行器；本仓不再下发容器内 iptables）'
    );
    if (config.mode !== 'none') {
      effectiveNetworkMode = 'none';
      narrowedByFailClosed = true;
    }
  }

  if (config.allowedDomains && config.allowedDomains.length > 0) {
    unenforcedInThisRepo.push(
      'domain-allowlist（按域名放行需宿主侧 DNS 层；本仓不实现）'
    );
  }

  if (blockedDomains.length > 0) {
    unenforcedInThisRepo.push(
      'domain-blacklist（本仓只做 `--add-host` 黑洞：容器内 root 仍可改 /etc/hosts，且不阻断 DNS 直查）'
    );
  }

  // 全部为**宿主侧** docker create 参数（B2 后**永不**出现 --cap-add=NET_ADMIN）
  const dockerArgs: string[] = [];
  const networkArg =
    effectiveNetworkMode === 'custom'
      ? // 自定义网络必须给名字；缺名时 fail-closed 为 none（不再把字面量 "custom" 当网络名）
        (config.customNetworkName ?? 'none')
      : effectiveNetworkMode;
  if (networkArg !== 'bridge') {
    dockerArgs.push('--network', networkArg);
  }
  for (const domain of blockedDomains) {
    dockerArgs.push('--add-host', `${domain}:0.0.0.0`);
  }

  return {
    sourceMode: config.mode,
    effectiveNetworkMode,
    narrowedByFailClosed,
    dockerArgs,
    blockedDomains,
    allowedPorts,
    enforcementOwner: 'host',
    unenforcedInThisRepo,
  };
}
