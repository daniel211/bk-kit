/**
 * agent-classes.cjs — which kit agents write code. One list, shared by hooks that must
 * decide whether a "Files:" section (and the file lock it feeds) means anything for a dispatch.
 *
 * Only a writer's lock prevents a conflict: reviewers, auditors, bk-debugger take a read lock
 * that never blocks another reader, the Write-only report agents (researcher, planner,
 * test-architect, brainstormer) touch only their own report, bk-project-manager / bk-docs-writer
 * edit plans and docs, and bk-git-manager commits rather than edits. None of them has files to
 * name, so asking them for "Files:" is noise.
 */
'use strict';

const CODE_WRITING_AGENTS = new Set([
  'bk-ios-developer', 'bk-android-developer', 'bk-flutter-developer',
  'bk-unit-test-agent', 'bk-device-test-agent', 'bk-code-simplifier'
]);

module.exports = { CODE_WRITING_AGENTS };
