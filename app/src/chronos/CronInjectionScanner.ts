/**
 * CronInjectionScanner — Cron 任务防注入安全扫描
 *
 * P2-10: 对标 hermes-agent _scan_cron_prompt（严格模式 8 威胁）+
 *        _scan_cron_skill_assembled（宽松模式 4 模式）。
 *
 * 两层扫描：
 *   strict:  用户提供的 cron prompt — 8 种威胁模式
 *   relaxed: 含 skill 内容的组装 prompt — 4 种模式（避免误报）
 */
import { getLogger } from '@modules/monitoring';
const logger = getLogger('chronos:injectionScan');

export type ScanMode = 'strict' | 'relaxed';

export interface ScanResult {
  safe: boolean;
  threats: Array<{ name: string; description: string; match: string }>;
}

// ============================================================
// Strict Mode: 8 threat patterns
// ============================================================

const STRICT_PATTERNS = [
  {
    name: 'prompt_injection',
    pattern:
      /ignore (?:all )?(?:previous|above|prior) instructions|disregard (?:all )?(?:previous|above) instructions|forget (?:all )?(?:your )?instructions/i,
    description: 'Prompt injection: ignoring previous instructions',
  },
  {
    name: 'deception_hide',
    pattern:
      /do not (?:tell|inform|notify|show) the user|hide (?:this|the|your) (?:action|output|result)|secretly|without (?:the )?user(?:'s)? knowledge/i,
    description: 'Deception: hiding actions from user',
  },
  {
    name: 'sys_prompt_override',
    pattern:
      /you are (?:now|a) (?:different|new) (?:AI|assistant|agent|system)|your (?:new )?(?:system prompt|instructions|role) is/i,
    description: 'System prompt override attempt',
  },
  {
    name: 'disregard_rules',
    pattern:
      /do not follow (?:the |any )?(?:rules|guidelines|policies|safety|ethics)|bypass (?:all )?(?:safety|security|restrictions)/i,
    description: 'Attempt to disregard rules/safety',
  },
  {
    name: 'read_secrets',
    pattern:
      /(?:cat|type|read|get-content)\s+.*\.(?:env|credentials|secret|key|token|pem|p12|pfx)/i,
    description: 'Attempt to read sensitive files',
  },
  {
    name: 'ssh_backdoor',
    pattern:
      /(?:echo|cat|tee)\s+.*>>\s*.*authorized_keys|ssh-keygen\s+.*-N\s*""/i,
    description: 'SSH backdoor injection',
  },
  {
    name: 'sudoers_mod',
    pattern:
      /(?:visudo|chmod\s+.*\/etc\/sudoers|echo\s+.*>>\s*\/etc\/sudoers)/i,
    description: 'Sudoers file modification',
  },
  {
    name: 'destructive_root_rm',
    pattern:
      /rm\s+(?:-rf?\s+)?\/(?:$|\s)|rm\s+(?:-rf?\s+)?\/etc|rm\s+(?:-rf?\s+)?\/usr|dd\s+if=.*of=\/dev\/(?:sd|nvme)/i,
    description: 'Destructive root-level removal',
  },
];

// ============================================================
// Relaxed Mode: 4 patterns (for skill-assembled prompts)
// ============================================================

const RELAXED_PATTERNS = [
  STRICT_PATTERNS[0], // prompt_injection
  STRICT_PATTERNS[2], // sys_prompt_override
  STRICT_PATTERNS[3], // disregard_rules
  STRICT_PATTERNS[4], // read_secrets
];

// ============================================================
// Invisible Unicode Detection
// ============================================================

const INVISIBLE_CHARS =
  /[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * 检测不可见 Unicode 字符（对比度攻击）
 */
function checkInvisibleUnicode(text: string): ScanResult {
  const matches = text.match(INVISIBLE_CHARS);
  if (matches && matches.length > 0) {
    return {
      safe: false,
      threats: [
        {
          name: 'invisible_unicode',
          description: `Detected ${matches.length} invisible Unicode character(s) — potential contrast attack`,
          match: `${matches.length} chars`,
        },
      ],
    };
  }
  return { safe: true, threats: [] };
}

// ============================================================
// Scanner
// ============================================================

export class CronInjectionScanner {
  /**
   * 扫描 cron prompt 是否存在威胁
   */
  scan(prompt: string, mode: ScanMode = 'strict'): ScanResult {
    if (!prompt?.trim()) return { safe: true, threats: [] };

    // 1. Check invisible Unicode first
    const unicodeCheck = checkInvisibleUnicode(prompt);
    if (!unicodeCheck.safe) return unicodeCheck;

    // 2. Match patterns
    const patterns = mode === 'relaxed' ? RELAXED_PATTERNS : STRICT_PATTERNS;
    const threats: ScanResult['threats'] = [];

    for (const p of patterns) {
      const match = prompt.match(p.pattern);
      if (match) {
        threats.push({
          name: p.name,
          description: p.description,
          match: match[0].slice(0, 80),
        });
      }
    }

    if (threats.length > 0) {
      logger.warn('cronScan:threats_detected', {
        mode,
        threatCount: threats.length,
        threatNames: threats.map((t) => t.name),
      });
      return { safe: false, threats };
    }

    return { safe: true, threats: [] };
  }

  /**
   * 批量扫描多个 prompt
   */
  scanAll(prompts: string[], mode: ScanMode = 'strict'): ScanResult[] {
    return prompts.map((p) => this.scan(p, mode));
  }

  /**
   * 宽松模式 — 仅检查最严重的 4 种威胁 + 不可见 Unicode
   */
  scanRelaxed(prompt: string): ScanResult {
    return this.scan(prompt, 'relaxed');
  }
}
