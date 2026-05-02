import type { LSPToolImpl } from './LSPToolImpl'

export type CallHierarchyItem = {
  name: string
  kind: string
  uri: string
  filePath: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  selectionRange: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  detail?: string
}

export type CallHierarchyNode = {
  item: CallHierarchyItem
  incomingCalls: CallHierarchyNode[]
  outgoingCalls: CallHierarchyNode[]
}

export class CallHierarchy {
  constructor(private lsp: LSPToolImpl) {}

  async prepareCallHierarchy(
    documentUri: string,
    line: number,
    character: number,
  ): Promise<CallHierarchyItem[]> {
    try {
      const raw = await this.lsp.sendRequest('textDocument/prepareCallHierarchy', {
        textDocument: { uri: documentUri },
        position: { line, character },
      })
      if (!raw) return []

      const items: any[] = Array.isArray(raw) ? raw : [raw].filter(Boolean)
      return items.map((item: any) => this.normalizeItem(item))
    } catch {
      return []
    }
  }

  async getIncomingCalls(item: CallHierarchyItem): Promise<CallHierarchyItem[]> {
    try {
      const raw = await this.lsp.sendRequest('callHierarchy/incomingCalls', {
        item: {
          name: item.name,
          kind: this.getKindNumber(item.kind),
          uri: item.uri,
          range: item.range,
          selectionRange: item.selectionRange,
        },
      })
      if (!raw) return []

      const calls: any[] = Array.isArray(raw) ? raw : []
      return calls.map((call: any) => this.normalizeItem(call.from || call))
    } catch {
      return []
    }
  }

  async getOutgoingCalls(item: CallHierarchyItem): Promise<CallHierarchyItem[]> {
    try {
      const raw = await this.lsp.sendRequest('callHierarchy/outgoingCalls', {
        item: {
          name: item.name,
          kind: this.getKindNumber(item.kind),
          uri: item.uri,
          range: item.range,
          selectionRange: item.selectionRange,
        },
      })
      if (!raw) return []

      const calls: any[] = Array.isArray(raw) ? raw : []
      return calls.map((call: any) => this.normalizeItem(call.to || call))
    } catch {
      return []
    }
  }

  async buildCallHierarchy(
    documentUri: string,
    line: number,
    character: number,
    maxDepth: number = 2,
  ): Promise<CallHierarchyNode[]> {
    const items = await this.prepareCallHierarchy(documentUri, line, character)
    const nodes: CallHierarchyNode[] = []

    for (const item of items) {
      const node: CallHierarchyNode = {
        item,
        incomingCalls: [],
        outgoingCalls: [],
      }

      if (maxDepth > 0) {
        const incoming = await this.getIncomingCalls(item)
        const outgoing = await this.getOutgoingCalls(item)

        for (const inc of incoming.slice(0, 10)) {
          node.incomingCalls.push({
            item: inc,
            incomingCalls: [],
            outgoingCalls: [],
          })
        }

        for (const out of outgoing.slice(0, 10)) {
          node.outgoingCalls.push({
            item: out,
            incomingCalls: [],
            outgoingCalls: [],
          })
        }
      }

      nodes.push(node)
    }

    return nodes
  }

  private normalizeItem(item: any): CallHierarchyItem {
    const uri = item.uri || ''
    let filePath = uri
    if (filePath.startsWith('file://')) {
      filePath = decodeURIComponent(filePath.replace(/^file:\/\//, ''))
      if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1)
      }
    }

    return {
      name: item.name || '',
      kind: item.kind !== undefined ? String(item.kind) : 'unknown',
      uri,
      filePath: filePath.replace(/\\/g, '/'),
      range: item.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      selectionRange: item.selectionRange || item.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      detail: item.detail,
    }
  }

  private getKindNumber(kind: string | number): number {
    if (typeof kind === 'number') return kind
    return parseInt(kind, 10) || 0
  }
}
