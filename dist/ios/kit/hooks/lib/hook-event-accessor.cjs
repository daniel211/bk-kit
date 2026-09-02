/**
 * hook-event-accessor.cjs — Canonical accessors for Claude Code hook event JSON.
 *
 * Claude Code hook events have evolved through multiple field-naming conventions
 * across versions. This module provides a single source of truth for reading
 * common fields, with fallback chains covering all known variants.
 *
 * Use these accessors instead of reading event fields directly to prevent
 * schema drift bugs (P0-3, RC-2).
 *
 * Exports:
 *   getToolName(data)       — primary tool name (e.g. "Task", "Edit")
 *   getToolInput(data)      — tool input object
 *   getSubagentType(data)   — agent identifier for Task events ("bk-git-manager", etc.)
 *   getDispatchTarget(data) — subagent type if Task, else tool name
 *   getFilePath(data)       — file path from Edit/Write/Read events
 *   getCwd(data)            — working directory from event
 *   getSessionId(data)      — session identifier
 *   getTranscriptPath(data) — transcript path for SubagentStop events
 *   getParallelBatch(data)  — array of parallel calls if batched (legacy/external)
 */

'use strict';

/**
 * Get the tool name from a hook event.
 * Variants: data.tool_name (canonical), data.tool.name, data.tool (legacy string)
 */
function getToolName(data) {
  if (!data) return '';
  if (typeof data.tool_name === 'string') return data.tool_name;
  if (data.tool && typeof data.tool.name === 'string') return data.tool.name;
  if (typeof data.tool === 'string') return data.tool;
  return '';
}

/**
 * Get the tool input object from a hook event.
 * Variants: data.tool_input (canonical), data.tool.input, data.input (legacy)
 */
function getToolInput(data) {
  if (!data) return {};
  if (data.tool_input && typeof data.tool_input === 'object') return data.tool_input;
  if (data.tool && typeof data.tool.input === 'object') return data.tool.input;
  if (data.input && typeof data.input === 'object') return data.input;
  return {};
}

/**
 * Get the subagent type for a Task event (e.g. "bk-git-manager", "bk-planner").
 * For non-Task events, returns empty string.
 */
function getSubagentType(data) {
  const input = getToolInput(data);
  return input.subagent_type || '';
}

/**
 * Get the dispatch target — subagent type for Task events, else tool name.
 * Useful for hooks that filter by what's being dispatched.
 */
function getDispatchTarget(data) {
  return getSubagentType(data) || getToolName(data);
}

/**
 * Get the file path from an Edit/Write/Read event.
 * Variants: tool_input.file_path, tool_input.path, top-level file_path (legacy)
 */
function getFilePath(data) {
  const input = getToolInput(data);
  return input.file_path || input.path || data.file_path || '';
}

/**
 * Get the cwd from a hook event.
 */
function getCwd(data) {
  if (!data) return '';
  return data.cwd || data.workspace?.path || '';
}

/**
 * Get the session ID.
 */
function getSessionId(data) {
  if (!data) return null;
  return data.session_id || data.sessionId || null;
}

/**
 * Get the transcript path (for SubagentStop / Stop events).
 */
function getTranscriptPath(data) {
  if (!data) return null;
  return data.transcript_path || data.transcriptPath || null;
}

/**
 * Get a batched parallel call array if the event represents a batch.
 * Real Claude Code does NOT batch parallel calls in single events — each call
 * arrives as separate event. This accessor exists for legacy/external orchestrator
 * compatibility (data.parallel_prompts, data.tool_calls).
 *
 * @returns {Array|null} array of {prompt, subagent_type} or null
 */
function getParallelBatch(data) {
  if (!data) return null;
  if (Array.isArray(data.parallel_prompts) && data.parallel_prompts.length > 1) {
    return data.parallel_prompts;
  }
  if (Array.isArray(data.tool_calls) && data.tool_calls.length > 1) {
    return data.tool_calls.map(c => ({
      prompt: c.input?.prompt || c.tool_input?.prompt || '',
      subagent_type: c.input?.subagent_type || c.tool_input?.subagent_type || ''
    }));
  }
  return null;
}

module.exports = {
  getToolName,
  getToolInput,
  getSubagentType,
  getDispatchTarget,
  getFilePath,
  getCwd,
  getSessionId,
  getTranscriptPath,
  getParallelBatch
};
