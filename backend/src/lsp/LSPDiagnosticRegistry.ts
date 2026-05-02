import { randomUUID } from 'crypto'

import type { DiagnosticFile, Diagnostic } from './types.js'

const MAX_DIAGNOSTICS_PER_FILE = 10
const MAX_TOTAL_DIAGNOSTICS = 30
const MAX_DELIVERED_FILES = 500
const MAX_CACHED_DIAGNOSTICS = 1000

export type PendingLSPDiagnostic = {
  serverName: string
  files: DiagnosticFile[]
  timestamp: number
  attachmentSent: boolean
}

const pendingDiagnostics = new Map<string, PendingLSPDiagnostic>()
const preDeliveredDiagnostics = new Map<string, Diagnostic[]>()

let diagnosticIdCounter = 0

export function registerPendingLSPDiagnostic(params: {
  serverName: string
  files: DiagnosticFile[]
}): void {
  const diagnosticId = `lsp-diag-${++diagnosticIdCounter}-${Date.now()}`

  pendingDiagnostics.set(diagnosticId, {
    serverName: params.serverName,
    files: params.files,
    timestamp: Date.now(),
    attachmentSent: false,
  })

  cleanupOldDiagnostics()
}

function severityToNumber(severity: string | undefined): number {
  switch (severity) {
    case 'Error': return 1
    case 'Warning': return 2
    case 'Info': return 3
    case 'Hint': return 4
    default: return 4
  }
}

function createDiagnosticKey(diag: Diagnostic): string {
  return JSON.stringify({
    message: diag.message,
    severity: diag.severity,
    range: diag.range,
    source: diag.source || null,
    code: diag.code || null,
  })
}

function deduplicateDiagnosticFiles(allFiles: DiagnosticFile[]): DiagnosticFile[] {
  const fileMap = new Map<string, Set<string>>()
  const dedupedFiles: DiagnosticFile[] = []

  for (const file of allFiles) {
    if (!fileMap.has(file.uri)) {
      fileMap.set(file.uri, new Set())
      dedupedFiles.push({ uri: file.uri, diagnostics: [] })
    }

    const seenDiagnostics = fileMap.get(file.uri)!
    const dedupedFile = dedupedFiles.find(f => f.uri === file.uri)!
    const preDelivered = preDeliveredDiagnostics.get(file.uri) || []

    for (const diag of file.diagnostics) {
      try {
        const key = createDiagnosticKey(diag)
        const alreadyDelivered = preDelivered.some(
          d => createDiagnosticKey(d) === key,
        )

        if (seenDiagnostics.has(key) || alreadyDelivered) {
          continue
        }

        seenDiagnostics.add(key)
        dedupedFile.diagnostics.push(diag)
      } catch {
        dedupedFile.diagnostics.push(diag)
      }
    }
  }

  return dedupedFiles.filter(f => f.diagnostics.length > 0)
}

export function checkForLSPDiagnostics(): Array<{
  serverName: string
  files: DiagnosticFile[]
}> {
  const allFiles: DiagnosticFile[] = []
  const serverNames = new Set<string>()
  const diagnosticsToMark: PendingLSPDiagnostic[] = []

  for (const diagnostic of pendingDiagnostics.values()) {
    if (!diagnostic.attachmentSent) {
      allFiles.push(...diagnostic.files)
      serverNames.add(diagnostic.serverName)
      diagnosticsToMark.push(diagnostic)
    }
  }

  if (allFiles.length === 0) return []

  const dedupedFiles = deduplicateDiagnosticFiles(allFiles)

  for (const diagnostic of diagnosticsToMark) {
    diagnostic.attachmentSent = true
  }

  for (const [id, diagnostic] of pendingDiagnostics) {
    if (diagnostic.attachmentSent) {
      pendingDiagnostics.delete(id)
    }
  }

  // Apply volume limits
  const limitedFiles: DiagnosticFile[] = []
  let totalDiagnostics = 0

  for (const file of dedupedFiles) {
    const limitedDiags = file.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const remaining = MAX_TOTAL_DIAGNOSTICS - totalDiagnostics

    if (remaining <= 0) break

    limitedFiles.push({
      uri: file.uri,
      diagnostics: limitedDiags.slice(0, remaining),
    })

    totalDiagnostics += limitedFiles[limitedFiles.length - 1].diagnostics.length
  }

  // Cache delivered diagnostics for cross-turn dedup
  for (const file of limitedFiles) {
    const existing = preDeliveredDiagnostics.get(file.uri) || []
    preDeliveredDiagnostics.set(
      file.uri,
      [...existing, ...file.diagnostics].slice(-MAX_CACHED_DIAGNOSTICS),
    )
  }

  return limitedFiles.map(file => ({
    serverName: Array.from(serverNames)[0] || 'unknown',
    files: [file],
  }))
}

export function clearLSPDiagnostics(): void {
  pendingDiagnostics.clear()
}

function cleanupOldDiagnostics(): void {
  if (pendingDiagnostics.size <= MAX_DELIVERED_FILES) return

  const entries = Array.from(pendingDiagnostics.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)

  const toRemove = entries.slice(0, entries.length - MAX_DELIVERED_FILES)
  for (const [id] of toRemove) {
    pendingDiagnostics.delete(id)
  }
}
