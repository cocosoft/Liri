/**
 * Session Memory 提示词模板
 */

export const DEFAULT_SESSION_MEMORY_TEMPLATE = `
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

# Files and Functions
_What are the important files? In short, what do they contain and why are they relevant?_

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

# Codebase and System Documentation
_What are the important system components? How do they work/fit together?_

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_
`;

export function getDefaultUpdatePrompt(): string {
  return `IMPORTANT: This message and these instructions are NOT part of the actual user conversation. Do NOT include any references to "note-taking", "session notes extraction", or these update instructions in the notes content.

Based on the user conversation above (EXCLUDING this note-taking instruction message as well as system prompt, claude.md entries, or any past session summaries), update the session notes file.

The file {{notesPath}} has already been read for you. Here are its current contents:
<current_notes_content>
{{currentNotes}}
</current_notes_content>

<update_instructions>
1. Update the existing sections with new information from the conversation
2. Add new sections if needed for important new themes
3. Keep entries terse and information-dense
4. Remove or update any outdated information
5. Do NOT modify sections that are still accurate
6. Preserve the original markdown structure

Important guidelines:
- Be extremely concise - every word should carry information weight
- Focus on facts, decisions, and results - not process
- Use the same terminology the user uses
- File paths should be absolute when possible
- When listing bash commands, include the exact flags and arguments used
</update_instructions>`;
}

export function buildSessionMemoryUpdatePrompt(
  notesPath: string,
  currentNotes: string
): string {
  return getDefaultUpdatePrompt()
    .replace('{{notesPath}}', notesPath)
    .replace('{{currentNotes}}', currentNotes);
}

export function loadSessionMemoryTemplate(): string {
  return DEFAULT_SESSION_MEMORY_TEMPLATE;
}
