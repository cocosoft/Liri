export type DiagnosticSeverity = 'Error' | 'Warning' | 'Info' | 'Hint'

export type DiagnosticFile = {
  uri: string
  diagnostics: DiagnosticEntry[]
}

export type DiagnosticEntry = {
  message: string
  severity: DiagnosticSeverity
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export type PendingDiagnostic = {
  serverName: string
  files: DiagnosticFile[]
  timestamp: number
  delivered: boolean
}

export class DiagnosticRegistry {
  private pendingDiagnostics: Map<string, PendingDiagnostic> = new Map()
  private deliveredKeys: Map<string, Set<string>> = new Map()
  private maxDeliveredFiles = 500

  registerDiagnostics(
    serverName: string,
    files: DiagnosticFile[],
  ): void {
    const id = `${serverName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.pendingDiagnostics.set(id, {
      serverName,
      files,
      timestamp: Date.now(),
      delivered: false,
    })
  }

  getPendingDiagnostics(): Map<string, PendingDiagnostic> {
    return new Map(this.pendingDiagnostics)
  }

  getNewDiagnostics(): PendingDiagnostic[] {
    const undelivered: PendingDiagnostic[] = []
    for (const [id, diag] of this.pendingDiagnostics) {
      if (!diag.delivered) {
        const newFiles = diag.files.map(f => ({
          ...f,
          diagnostics: this.filterNewDiagnosticsForFile(f),
        }))
        if (newFiles.some(f => f.diagnostics.length > 0)) {
          undelivered.push({ ...diag, files: newFiles })
        }
        diag.delivered = true
      }
    }
    return undelivered
  }

  private filterNewDiagnosticsForFile(file: DiagnosticFile): DiagnosticEntry[] {
    let deliveredSet = this.deliveredKeys.get(file.uri)
    if (!deliveredSet) {
      deliveredSet = new Set()
      this.deliveredKeys.set(file.uri, deliveredSet)
    }
    const newDiags = file.diagnostics.filter(d => {
      const key = `${d.severity}_${d.message}_${d.range.start.line}_${d.range.start.character}`
      if (deliveredSet!.has(key)) return false
      deliveredSet!.add(key)
      return true
    })
    this.enforceMaxDeliveredFiles()
    return newDiags
  }

  private enforceMaxDeliveredFiles(): void {
    if (this.deliveredKeys.size > this.maxDeliveredFiles) {
      const sortedKeys = [...this.deliveredKeys.keys()]
        .sort(() => 0.5 - Math.random())
      while (this.deliveredKeys.size > this.maxDeliveredFiles) {
        const key = sortedKeys.pop()
        if (key) this.deliveredKeys.delete(key)
      }
    }
  }

  clearAll(): void {
    this.pendingDiagnostics.clear()
  }

  clearDelivered(): void {
    this.deliveredKeys.clear()
  }

  getStats(): {
    pendingCount: number
    totalPendingFileDiagnostics: number
    deliveredFileCount: number
  } {
    let totalDiagnostics = 0
    for (const diag of this.pendingDiagnostics.values()) {
      for (const file of diag.files) {
        totalDiagnostics += file.diagnostics.length
      }
    }
    return {
      pendingCount: this.pendingDiagnostics.size,
      totalPendingFileDiagnostics: totalDiagnostics,
      deliveredFileCount: this.deliveredKeys.size,
    }
  }
}

export function mapSeverity(severity: number | undefined): DiagnosticSeverity {
  switch (severity) {
    case 1: return 'Error'
    case 2: return 'Warning'
    case 3: return 'Info'
    case 4: return 'Hint'
    default: return 'Error'
  }
}

export function formatDiagnosticsForFile(
  params: {
    uri: string
    diagnostics: Array<{
      message: string
      severity?: number
      range: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      source?: string
      code?: string | number
    }>
  },
): DiagnosticFile {
  const uri = params.uri.startsWith('file://')
    ? decodeURI(params.uri)
    : params.uri

  const diagnostics: DiagnosticEntry[] = params.diagnostics.map(d => ({
    message: d.message,
    severity: mapSeverity(d.severity),
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    source: d.source,
    code: d.code !== undefined && d.code !== null ? String(d.code) : undefined,
  }))

  return { uri, diagnostics }
}

export const globalDiagnosticRegistry = new DiagnosticRegistry()
