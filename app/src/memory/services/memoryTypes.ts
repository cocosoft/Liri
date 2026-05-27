/**
 * Memory frontmatter example for documentation.
 */
export const MEMORY_FRONTMATTER_EXAMPLE = [
  '---',
  'id: user_preferences',
  'name: User Preferences',
  "description: The user's preferred working style and tools",
  'type: user',
  'createdAt: 2023-01-01T00:00:00Z',
  'updatedAt: 2023-01-01T00:00:00Z',
  'tags: [preferences, workflow]',
  'priority: high',
  'expiresAt: 2024-01-01T00:00:00Z',
  'author: assistant',
  'source: conversation',
  '---',
];

/**
 * Trusting recall section for memory prompts.
 */
export const TRUSTING_RECALL_SECTION = [
  '## Trusting recall',
  '',
  'You may not remember everything perfectly. That is okay — the memory system is designed to help you.',
  'If you are unsure about a detail, it is better to search for the information or ask the user than to make something up.',
  'Your memory is not a replacement for checking the actual state of the project (e.g., by reading files or running commands).',
  'Use your memory as a guide, but always verify important details before acting on them.',
];

/**
 * Individual memory types section for memory prompts.
 */
export const TYPES_SECTION_INDIVIDUAL = [
  '## Memory types',
  '',
  '### User memories',
  'Information about the user themselves: their role, preferences, communication style, and goals.',
  '- Example: "The user is a frontend developer who prefers React over Vue"',
  '- Example: "The user likes detailed explanations with code examples"',
  '- Example: "The user is working on a tight deadline for this project"',
  '',
  '### Feedback memories',
  'Feedback the user has given you about your performance or the tools you use.',
  '- Example: "The user prefers I not summarize code changes"',
  '- Example: "The user found my explanation of Promises helpful"',
  '- Example: "The user asked me to use more emojis in my responses"',
  '',
  '### Project memories',
  'Context about the project that is not derivable from the code itself.',
  '- Example: "The project uses a specific API that requires an API key"',
  '- Example: "The team follows a specific branching strategy"',
  '- Example: "There is a known issue with the third-party library"',
  '',
  '### Reference memories',
  'External references or resources that are relevant to the project.',
  '- Example: "The design specs are available at https://example.com/specs"',
  '- Example: "The API documentation is at https://api.example.com/docs"',
  '- Example: "The team uses Jira for project management: https://jira.example.com"',
];

/**
 * What not to save section for memory prompts.
 */
export const WHAT_NOT_TO_SAVE_SECTION = [
  '## What not to save',
  '',
  'Do not save information that:',
  '- Is derivable from the codebase (e.g., file structure, function names)',
  '- Is temporary or only relevant to the current conversation',
  '- Is sensitive (e.g., API keys, passwords, personal information)',
  '- Is already well-documented elsewhere',
  '- Would violate privacy or security policies',
  '',
  'Memory is for persistent, context-rich information that will be useful across multiple conversations.',
];

/**
 * When to access section for memory prompts.
 */
export const WHEN_TO_ACCESS_SECTION = [
  '## When to access memory',
  '',
  'You should access your memory:',
  '- When starting a new conversation with a user you have interacted with before',
  '- When the user asks about something that might be in your memory',
  '- When you need context that is not immediately available in the current conversation',
  '- When you want to ensure consistency with previous interactions',
  '',
  'You do not need to access your memory for every interaction — use your judgment about what information is relevant.',
];
