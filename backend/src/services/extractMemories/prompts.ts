export function buildExtractMemoryPrompt(
  messageCount: number,
  existingMemories: string,
): string {
  const manifest = existingMemories
    ? `\n\n## Existing Memories\n\n${existingMemories}\n\nCheck this list before writing — update existing memories rather than creating duplicates.`
    : ''

  return [
    `You are a memory extraction agent. Analyze the most recent ${messageCount} messages and extract durable memories.`,

    manifest,

    '',
    '## Memory Types',
    '',
    '- **user_fact**: Facts about the user (name, role, team, preferences)',
    '- **user_preference**: User preferences, likes, dislikes',
    '- **project_knowledge**: Facts about the project, architecture, setup',
    '- **code_pattern**: Patterns, conventions, idioms used in the codebase',
    '- **decision**: Technical decisions made and their rationale',
    '',
    '## Extraction Rules',
    '',
    '- Only extract information that is explicitly stated',
    '- Do not infer or assume — use only what is directly observable',
    '- Skip trivial or obvious information',
    '- Focus on information that would be useful in future conversations',
    '- If nothing new is worth remembering, say so explicitly',
    '- Limit to 5 memories maximum per extraction',
    '',
    '## Output Format',
    '',
    'For each memory, output:',
    '```',
    'TYPE: <memory_type>',
    'TITLE: <brief title>',
    'CONTENT: <key information, 1-3 sentences>',
    'CONFIDENCE: <0.0-1.0>',
    '```',
  ].join('\n')
}

export function buildSummarizePrompt(
  conversationSummary: string,
): string {
  return [
    'Summarize the key facts and decisions from this conversation fragment.',
    'Focus on information that would be valuable to remember for future interactions.',
    '',
    'Conversation:',
    conversationSummary,
    '',
    'Provide a concise summary in 3-5 bullet points.',
  ].join('\n')
}
