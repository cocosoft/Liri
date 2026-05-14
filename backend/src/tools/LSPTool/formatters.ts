/**
 * LSP Tool Formatters
 * 对标CC formatters.ts
 * LSP工具结果格式化
 */

export interface FormattedLocation {
  file: string;
  line: number;
  column?: number;
  text: string;
}

export interface FormattedDefinition {
  file: string;
  line: number;
  column?: number;
  text: string;
}

export interface FormattedReference {
  file: string;
  line: number;
  column: number;
  text: string;
  context?: string;
}

export interface FormattedHover {
  content: string;
  language?: string;
}

export interface FormattedSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  containerName?: string;
}

export function formatLocation(loc: FormattedLocation): string {
  const pos = loc.column !== undefined
    ? `${loc.line}:${loc.column}`
    : `${loc.line}`;

  return `${loc.file}:${pos} — ${loc.text.trim()}`;
}

export function formatDefinition(def: FormattedDefinition): string {
  const pos = def.column !== undefined
    ? `${def.line}:${def.column}`
    : `${def.line}`;

  return [
    `Definition: ${def.file}:${pos}`,
    `  ${def.text.trim()}`,
  ].join('\n');
}

export function formatReferences(
  refs: FormattedReference[],
  options?: { maxRefs?: number; showContext?: boolean },
): string {
  const max = options?.maxRefs ?? 20;
  const limited = refs.slice(0, max);

  const lines = limited.map((ref, i) => {
    const base = `${i + 1}. ${ref.file}:${ref.line}:${ref.column} — ${ref.text.trim()}`;
    if (options?.showContext && ref.context) {
      return `${base}\n   Context: ${ref.context}`;
    }
    return base;
  });

  if (refs.length > max) {
    lines.push(`   ... and ${refs.length - max} more references`);
  }

  return lines.join('\n');
}

export function formatHover(info: FormattedHover): string {
  if (info.language) {
    return `\`\`\`${info.language}\n${info.content}\n\`\`\``;
  }
  return info.content;
}

export function formatSymbolTable(symbols: FormattedSymbol[]): string {
  if (symbols.length === 0) return 'No symbols found.';

  const maxNameLen = Math.max(...symbols.map((s) => s.name.length), 10);
  const maxKindLen = Math.max(...symbols.map((s) => s.kind.length), 8);

  const header = [
    `  ${'Name'.padEnd(maxNameLen)} ${'Kind'.padEnd(maxKindLen)} Location`,
    `  ${''.padEnd(maxNameLen, '—')} ${''.padEnd(maxKindLen, '—')} ————————`,
  ];

  const rows = symbols.map((s) => {
    const pos = `${s.file}:${s.line}:${s.column}`;
    const container = s.containerName ? ` (in ${s.containerName})` : '';
    return `  ${s.name.padEnd(maxNameLen)} ${s.kind.padEnd(maxKindLen)} ${pos}${container}`;
  });

  return [...header, ...rows].join('\n');
}

export function formatSymbolHierarchy(
  symbols: FormattedSymbol[],
): string {
  const tree: Array<{ symbol: FormattedSymbol; depth: number; children: typeof tree }> = [];

  for (const sym of symbols) {
    if (!sym.containerName) {
      tree.push({ symbol: sym, depth: 0, children: [] });
    }
  }

  for (const sym of symbols) {
    if (sym.containerName) {
      const parent = tree.find((t) => t.symbol.name === sym.containerName);
      if (parent) {
        parent.children.push({ symbol: sym, depth: 1, children: [] });
      } else {
        tree.push({ symbol: sym, depth: 0, children: [] });
      }
    }
  }

  function renderNode(
    node: { symbol: FormattedSymbol; depth: number; children: typeof tree },
  ): string {
    const indent = '  '.repeat(node.depth);
    const prefix = node.depth === 0 ? '📦' : '├─';
    const line = `${indent}${prefix} ${node.symbol.name} (${node.symbol.kind})`;

    const children = node.children.map((c) => renderNode(c)).join('\n');
    return children ? `${line}\n${children}` : line;
  }

  return tree.map((n) => renderNode(n)).join('\n');
}

export function truncateSymbolName(name: string, maxLen: number = 60): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + '...';
}

export function groupByFile(
  refs: FormattedReference[],
): Map<string, FormattedReference[]> {
  const groups = new Map<string, FormattedReference[]>();

  for (const ref of refs) {
    const existing = groups.get(ref.file) ?? [];
    existing.push(ref);
    groups.set(ref.file, existing);
  }

  return groups;
}
