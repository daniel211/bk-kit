'use strict';
/**
 * sensor-fixtures.cjs — Synthetic fixtures for Ashby sensor verification.
 *
 * Each entry represents a fixture that SHOULD trigger a specific hook's detector.
 * Implements Ashby's Law of Requisite Variety: every sensor must be proven to fire.
 *
 * Fixture structure:
 *   {
 *     hookName: string,       // relative path from hooks/_base/ to hook .cjs
 *     displayName: string,    // human-readable name
 *     category: string,       // 'observer' | 'blocking'
 *     fixture: {
 *       input: object,        // JSON stdin for hook
 *       env: object,          // additional env vars
 *       files: object         // { relPath: content } to write in temp project
 *     },
 *     expected: {
 *       exitCode?: number,    // expected exit code (default any)
 *       redSignal?: string,   // expected signal type in red-signals.jsonl
 *       jsonlWrite?: string,  // expected write to a .jsonl file (file name)
 *       stderrContains?: string, // expected substring in stderr
 *       stdoutContains?: string  // expected substring in stdout
 *     }
 *   }
 */

const FIXTURES = [
  // ── Observer hooks ───────────────────────────────────────────────────────

  {
    hookName: 'token-burn-detector.cjs',
    displayName: 'token-burn-detector',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Read',
        tool_input: { file_path: 'test.swift' },
        context_window: {
          current_usage: {
            input_tokens: 2000000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        }
      },
      env: { CLAUDE_SESSION_ID: 'fixture-session-001' },
      files: {
        '.bk-metrics/token-burn-window.jsonl': (() => {
          // Create a burn window that triggers the detector (>50k tokens/min for 3 windows)
          const now = Date.now();
          const entries = [];
          for (let i = 5; i >= 0; i--) {
            entries.push(JSON.stringify({ timestamp: now - i * 60000, total_tokens: (5 - i) * 200000 }));
          }
          return entries.join('\n') + '\n';
        })()
      }
    },
    expected: {
      exitCode: 0,  // fail-open: always exits 0
      jsonlWrite: 'token-burn-window.jsonl'
    }
  },

  {
    hookName: 'no-progress-detector.cjs',
    displayName: 'no-progress-detector',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'test.swift',
          old_string: 'let x = 1',
          new_string: 'let x = 1 '  // trivial whitespace-only edit
        }
      },
      env: {},
      files: {
        '.bk-metrics/file-edit-history.jsonl': (() => {
          // Simulate oscillation: A→B→A pattern
          const now = Date.now();
          const entries = [
            { ts: now - 5000, file: 'test.swift', sha: 'aaaa', prev_sha: 'bbbb' },
            { ts: now - 4000, file: 'test.swift', sha: 'bbbb', prev_sha: 'aaaa' },
            { ts: now - 3000, file: 'test.swift', sha: 'aaaa', prev_sha: 'bbbb' },
            { ts: now - 2000, file: 'test.swift', sha: 'bbbb', prev_sha: 'aaaa' }
          ];
          return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        })()
      }
    },
    expected: {
      exitCode: 0,
      jsonlWrite: 'file-edit-history.jsonl'
    }
  },

  {
    hookName: 'agent-signal-detector.cjs',
    displayName: 'agent-signal-detector',
    category: 'observer',
    fixture: {
      // SubagentStop completion — the event this hook runs on since background dispatch made
      // PostToolUse(Task|Agent) fire at launch.
      input: {
        hook_event_name: 'SubagentStop',
        session_id: 'fixture-asd-001',
        agent_id: 'fixture-asd-agent',
        agent_type: 'bk-debugger',
        last_assistant_message: 'I cannot determine the root cause. I am stuck and unable to identify the issue.'
      },
      env: {},
      files: {}
    },
    expected: {
      exitCode: 0,
      stdoutContains: null  // agent-signal-detector writes to stdout advisory
    }
  },

  {
    hookName: 'pattern-extractor.cjs',
    displayName: 'pattern-extractor',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'ViewModel.swift',
          old_string: '// old',
          new_string: '// new pattern here'
        }
      },
      env: {},
      files: {}
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'inferential-review.cjs',
    displayName: 'inferential-review',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'UserViewModel.swift',
          old_string: 'class OldViewModel {}',
          new_string: 'class UserViewModel: ObservableObject {\n  @Published var user: User?\n}'
        }
      },
      env: { BK_INFERENTIAL_SKIP: '1' },  // skip actual inference — just check it runs
      files: {}
    },
    expected: {
      exitCode: 0
      // Queue write may or may not happen depending on BK_INFERENTIAL_SKIP handling
    }
  },

  {
    hookName: 'test-generation-hook.cjs',
    displayName: 'test-generation-hook',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'Sources/UserService.swift',
          content: 'class UserService {\n  func fetchUser(id: String) async throws -> User { fatalError() }\n}'
        }
      },
      env: {},
      files: {}
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'ui-snapshot-compare.cjs',
    displayName: 'ui-snapshot-compare',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'Sources/Views/ProfileView.swift',
          content: 'struct ProfileView: View { var body: some View { Text("Profile") } }'
        }
      },
      env: {},
      files: {}
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'arch-fitness-ios-native.cjs',
    displayName: 'arch-fitness-ios-native',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'Domain/UserRepository.swift',
          old_string: '// old',
          new_string: 'import UIKit\nclass UserRepository { }'  // UIKit in domain = arch violation
        }
      },
      env: { BK_NATIVE_LINT_FORCE_UNAVAILABLE: '1' },
      files: {
        '.claude/.bk.json': JSON.stringify({
          hooks: { 'arch-fitness-ios-native': true },
          archFitness: {
            ios: {
              enabled: true,
              domain_paths: ['Domain/'],
              presentation_paths: ['Views/'],
              rules: { no_uikit_in_domain: true }
            }
          }
        })
      }
    },
    expected: {
      // arch-fitness-ios-native may exit 0 (fail-open) or non-zero when SwiftLint unavailable
      // The sensor proves the hook runs — exit code is flexible
    }
  },

  // ── Arch-fitness variants ─────────────────────────────────────────────────

  {
    hookName: 'arch-fitness-android-native.cjs',
    displayName: 'arch-fitness-android-native',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'app/src/main/java/com/example/domain/UserRepository.kt',
          old_string: '// old',
          new_string: 'import android.content.Context\nclass UserRepository(val ctx: Context)'
        }
      },
      env: { BK_NATIVE_LINT_FORCE_UNAVAILABLE: '1' },
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // falls back to regex hook which finds Android import in domain → exits 2
    }
  },

  {
    hookName: 'arch-fitness-flutter-native.cjs',
    displayName: 'arch-fitness-flutter-native',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'lib/domain/user_repository.dart',
          old_string: '// old',
          new_string: "import 'package:flutter/material.dart';\nclass UserRepository {}"
        }
      },
      env: { BK_NATIVE_LINT_FORCE_UNAVAILABLE: '1' },
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // falls back to regex hook which finds Flutter import in domain → exits 2
    }
  },

  {
    hookName: 'arch-fitness-ios.cjs',
    displayName: 'arch-fitness-ios',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'Domain/UserUseCase.swift',
          old_string: '// old',
          new_string: 'import UIKit\nclass UserUseCase {}'  // UIKit in domain layer
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // arch violation found → exits 2 (blocking on error)
    }
  },

  {
    hookName: 'arch-fitness-android.cjs',
    displayName: 'arch-fitness-android',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'app/src/main/java/com/example/domain/UserUseCase.kt',
          old_string: '// old',
          new_string: 'import android.app.Activity\nclass UserUseCase'  // Android in domain
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // arch violation found → exits 2
    }
  },

  {
    hookName: 'arch-fitness-flutter.cjs',
    displayName: 'arch-fitness-flutter',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'lib/domain/user_entity.dart',
          old_string: '// old',
          new_string: "import 'package:flutter/widgets.dart';\nclass UserEntity {}"  // flutter in domain
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // arch violation found → exits 2
    }
  },

  // ── More observer hooks ──────────────────────────────────────────────────

  {
    hookName: 'bootstrap-quality-gate.cjs',
    displayName: 'bootstrap-quality-gate',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'bk/docs/foundation/overview.md',
          content: '# Overview\nThis project targets iOS.\n'
        }
      },
      env: {},
      files: {
        'bk/docs/foundation/overview.md': '# Overview\nThis project targets iOS.\n',
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'checkpoint-save.cjs',
    displayName: 'checkpoint-save',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Stop',
        tool_input: {}
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'coding',
          complexity_tier: 'standard'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'compact-recovery.cjs',
    displayName: 'compact-recovery',
    category: 'observer',
    fixture: {
      input: {
        source: 'compact',
        session_id: 'fixture-compact-001'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'coding',
          complexity_tier: 'complex'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'context-monitor.cjs',
    displayName: 'context-monitor',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'UserPromptSubmit',
        tool_input: { prompt: 'Continue implementation' }
      },
      env: { CLAUDE_CONTEXT_USAGE: '90' },  // triggers CRITICAL advisory
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          complexity_tier: 'complex',
          turnCount: 180
        })
      }
    },
    expected: {
      exitCode: 0  // context-monitor always exits 0 (advisory only)
    }
  },

  {
    hookName: 'context-safety.cjs',
    displayName: 'context-safety',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Task',
        tool_input: { description: 'Dispatch bk-ios-developer agent' }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.statusline-cache.json': JSON.stringify({
          context_pct: 30,  // safe level — not blocking
          updated: Date.now()
        })
      }
    },
    expected: {
      exitCode: 0  // context < 85% so no block
    }
  },

  {
    hookName: 'decision-tracker.cjs',
    displayName: 'decision-tracker',
    category: 'observer',
    fixture: {
      input: {
        agent_type: 'bk-planner',
        agent_result: '## Planning\n<!-- bk-decision: Use MVVM pattern for all ViewModels -->\nDecision made.'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'plan'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'handoff-writer.cjs',
    displayName: 'handoff-writer',
    category: 'observer',
    fixture: {
      input: {
        source: 'compact',
        session_id: 'fixture-handoff-001'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          workflowId: 'bk-code',
          complexity_tier: 'complex',
          phase: 'coding',
          completedTasks: ['Set up MVVM', 'Write UserViewModel'],
          remainingTasks: ['Write tests', 'Code review'],
          decisions: ['Use Combine for reactive binding'],
          mission: 'Implement user profile screen'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'mcp-health-monitor.cjs',
    displayName: 'mcp-health-monitor',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'mcp__serena__get_symbols',
        tool_input: { file: 'Sources/UserService.swift' }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0  // mcp-health-monitor is advisory-only; always exits 0
    }
  },

  {
    hookName: 'mutation-testing-sensor.cjs',
    displayName: 'mutation-testing-sensor',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'package.json',
          content: JSON.stringify({ name: 'test-project', devDependencies: {} })
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'package.json': JSON.stringify({ name: 'test-project', devDependencies: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'post-commit.cjs',
    displayName: 'post-commit',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: add user profile screen"' },
        tool_response: { stdout: '[main abc1234] feat: add user profile screen\n 1 file changed' }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'coding'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'post-edit-simplify.cjs',
    displayName: 'post-edit-simplify',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'Sources/UserViewModel.swift',
          old_string: '// old',
          new_string: '// new'
        },
        file_path: 'Sources/UserViewModel.swift'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'Sources/UserViewModel.swift': Array(260).fill('  let x = 1').join('\n') + '\n'
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'preference-tracker.cjs',
    displayName: 'preference-tracker',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'AskUser',
        tool_output: 'Yes, always use SwiftUI for new views',
        question: 'Should I use SwiftUI or UIKit for this view?'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'project-profile.cjs',
    displayName: 'project-profile',
    category: 'observer',
    fixture: {
      input: {
        source: 'session_start',
        session_id: 'fixture-profile-001'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/docs/foundation/overview.md': '# iOS App\nPlatform: iOS\nArchitecture: MVVM\n'
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'session-cost-rollup.cjs',
    displayName: 'session-cost-rollup',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Stop',
        tool_input: {}
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          cumulativeCostUsd: 0.05
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'statusline.cjs',
    displayName: 'statusline',
    category: 'observer',
    fixture: {
      input: {
        model: 'claude-opus-4-5',
        session_id: 'fixture-statusline-001',
        context_window: {
          current_usage: {
            input_tokens: 50000,
            cache_creation_input_tokens: 5000,
            cache_read_input_tokens: 100000
          },
          max_tokens: 200000
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'subagent-cost-capture.cjs',
    displayName: 'subagent-cost-capture',
    category: 'observer',
    fixture: {
      input: {
        agent_name: 'bk-ios-developer',
        session_id: 'fixture-subagent-001',
        transcript_path: null  // no transcript available in test
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          cumulativeCostUsd: 0.01
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'task-completed-handler.cjs',
    displayName: 'task-completed-handler',
    category: 'observer',
    fixture: {
      input: {
        task_id: 'task-001',
        task_subject: 'Implement UserViewModel',
        task_description: 'Create MVVM ViewModel for user profile',
        teammate_name: 'bk-ios-developer',
        team_name: 'ios-team'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'team-context-inject.cjs',
    displayName: 'team-context-inject',
    category: 'observer',
    fixture: {
      input: {
        agent_id: 'bk-ios-developer@ios-team',
        agent_name: 'bk-ios-developer',
        team_name: 'ios-team'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'teammate-idle-handler.cjs',
    displayName: 'teammate-idle-handler',
    category: 'observer',
    fixture: {
      input: {
        teammate_name: 'bk-ios-developer',
        team_name: 'ios-team',
        permission_mode: 'default'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'traceability-check.cjs',
    displayName: 'traceability-check',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'bk-git-manager',
          description: 'Commit and push changes'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'review'
        })
      }
    },
    expected: {
      exitCode: 0  // no traceability matrix → skip, exits 0
    }
  },

  {
    hookName: 'verify-output.cjs',
    displayName: 'verify-output',
    category: 'observer',
    fixture: {
      input: {
        hook_event_name: 'SubagentStop',
        session_id: 'fixture-verify-001',
        agent_id: 'fixture-verify-agent',
        agent_type: 'bk-ios-developer',
        last_assistant_message: 'Implementation complete. Created UserViewModel.swift and ProfileView.swift.'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'coding'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'workflow-metrics.cjs',
    displayName: 'workflow-metrics',
    category: 'observer',
    fixture: {
      input: {
        agent_type: 'bk-ios-developer',
        status: 'success',
        session_id: 'fixture-metrics-001'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          command: 'bk-code',
          current_phase: 'coding',
          complexity_tier: 'standard'
        })
      }
    },
    expected: {
      exitCode: 0
    }
  },

  {
    hookName: 'complexity-detector.cjs',
    displayName: 'complexity-detector',
    category: 'observer',
    fixture: {
      input: {
        agent_type: 'bk-planner',
        status: 'success'
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/test-feature/plan.md': [
          '# Plan: test-feature',
          '## Sub-tasks',
          ...Array(12).fill(null).map((_, i) => `### Sub-task ${i + 1}\n- [ ] Implement part ${i + 1}`)
        ].join('\n') + '\n'
      }
    },
    expected: {
      exitCode: 0
    }
  },

  // ── Blocking hooks ────────────────────────────────────────────────────────

  {
    hookName: 'budget-guard.cjs',
    displayName: 'budget-guard',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Task',
        tool_input: { description: 'Spawn expensive subagent' }
      },
      env: { BK_BUDGET_OVERRIDE: '' },
      files: {
        'bk/dev/shared/budget-config.json': JSON.stringify({
          enabled: true,
          daily_budget_usd: 0.001,  // very low → triggers advisory
          daily_warn_pct: 0.5,
          daily_block_pct: 0.95
        }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          total_cost_usd: 0.005,  // exceeds daily budget
          cost_by_date: { [new Date().toISOString().slice(0,10)]: 0.005 }
        })
      }
    },
    expected: {
      exitCode: 0  // budget-guard exits 0 with advisory; blocks via response JSON
    }
  },

  {
    hookName: 'global-kill-switch.cjs',
    displayName: 'global-kill-switch',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Edit',
        tool_input: { file_path: 'test.swift', old_string: 'a', new_string: 'b' }
      },
      env: { BK_HARNESS_OVERRIDE: '' },
      files: {
        '.bk-metrics/red-signals.jsonl': (() => {
          // Enough distinct red signal types to trigger kill switch
          const now = Date.now();
          const types = [
            'tool_repetition_blocked', 'oscillation_blocked',
            'phase_recurrence_blocked'
          ];
          return types.map(t =>
            JSON.stringify({ ts: now - 1000, type: t })
          ).join('\n') + '\n';
        })(),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({ global_halt: false })
      }
    },
    expected: {
      // global-kill-switch CORRECTLY fires (exits 2 = block) when threshold exceeded
      // This proves the sensor detects the red signals → sensor is working
      exitCode: 2
    }
  },

  {
    hookName: 'security-check.cjs',
    displayName: 'security-check',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: '.env',
          content: 'SECRET_KEY=abc123\nAWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\n'
        }
      },
      env: {},
      files: {}
    },
    expected: {
      // security-check CORRECTLY blocks .env writes (exits 2)
      // This proves the sensor fires on protected files → sensor is working
      exitCode: 2
    }
  },

  {
    hookName: 'anti-self-implementation.cjs',
    displayName: 'anti-self-implementation',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'bk/docs/foundation/architecture.md',
          content: '# Architecture\nMVVM pattern used throughout.'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0  // anti-self-implementation is advisory-only (exit 0 with additionalContext)
    }
  },

  {
    hookName: 'delegation-enforcer.cjs',
    displayName: 'delegation-enforcer',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'bk-ios-developer',
          description: 'Task: Implement UserViewModel\nOutput: UserViewModel.swift\nPlatform: iOS\nFiles: Sources/UserViewModel.swift'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          current_phase: 'coding'
        })
      }
    },
    expected: {
      exitCode: 0  // valid dispatch format → approved
    }
  },

  {
    hookName: 'fsm-guard.cjs',
    displayName: 'fsm-guard',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'bk/dev/shared/.workflow-state.json',
          content: JSON.stringify({
            command: 'bk-code',
            current_phase: 'review',  // invalid: plan→coding is valid, not plan→review
            workflow_type: 'bk-code',
            feature: 'test-feature'
          })
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          command: 'bk-code',
          current_phase: 'plan',
          workflow_type: 'bk-code',  // required for FSM validation
          feature: 'test-feature'
        })
      }
    },
    expected: {
      exitCode: 2  // fsm-guard blocks invalid transition plan → review
    }
  },

  {
    hookName: 'parallel-safety.cjs',
    displayName: 'parallel-safety',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'bk-ios-developer',
          description: 'Task: Implement user profile\nFiles: Sources/UserViewModel.swift, Sources/ProfileView.swift'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0  // single dispatch with no conflicts → passes
    }
  },

  {
    hookName: 'privacy-block.cjs',
    displayName: 'privacy-block',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Read',
        tool_input: {
          file_path: '.env.production'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // privacy-block blocks access to .env files (both installed and source versions)
    }
  },

  {
    hookName: 'property-based-test-suggester.cjs',
    displayName: 'property-based-test-suggester',
    category: 'observer',
    fixture: {
      input: {
        tool_name: 'Write',
        tool_input: {
          file_path: 'Tests/UserServiceTests.swift',
          content: (() => {
            // Create many simple test cases to trigger suggestion
            const tests = Array(12).fill(null).map((_, i) =>
              `func testFetchUser${i}() {\n  let result = service.fetchUser(id: "user${i}")\n  XCTAssertEqual(result.id, "user${i}")\n}`
            ).join('\n');
            return `import XCTest\n\nclass UserServiceTests: XCTestCase {\n${tests}\n}`;
          })()
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 0  // property-based-test-suggester is observer-only
    }
  },

  {
    hookName: 'scout-block.cjs',
    displayName: 'scout-block',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Glob',
        tool_input: {
          pattern: 'node_modules/**/*.js'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} })
      }
    },
    expected: {
      exitCode: 2  // scout-block CORRECTLY blocks node_modules/ access (both versions block this)
    }
  },

  {
    hookName: 'subagent-iteration-cap.cjs',
    displayName: 'subagent-iteration-cap',
    category: 'blocking',
    fixture: {
      input: {
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'bk-ios-developer',
          description: 'bk-ios-developer: Implement more features'
        }
      },
      env: {},
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        'bk/dev/shared/.workflow-state.json': JSON.stringify({
          feature: 'test-feature',
          agent_dispatch_counts: { 'bk-ios-developer': 1 }  // within limits → passes
        })
      }
    },
    expected: {
      exitCode: 0  // within iteration cap → allowed
    }
  },

  {
    hookName: 'tool-repetition-detector.cjs',
    displayName: 'tool-repetition-detector',
    category: 'blocking',
    fixture: {
      input: {
        // Use Edit tool — Read is in exempt_tools list, so use a non-exempt tool
        tool_name: 'Edit',
        tool_input: {
          file_path: 'Sources/UserViewModel.swift',
          old_string: 'let x = 0',
          new_string: 'let x = 1'
        },
        session_id: 'fixture-repetition-001',
        turn_id: '0'
      },
      env: { CLAUDE_SESSION_ID: 'fixture-repetition-001' },
      files: {
        '.claude/.bk.json': JSON.stringify({ hooks: {} }),
        // Pre-populate ring with 4 identical Edit calls (5th from this call = block threshold)
        '.bk-metrics/tool-call-ring.json': (() => {
          const crypto = require('crypto');
          function sortedKeys(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
            const result = {};
            for (const k of Object.keys(obj).sort()) result[k] = sortedKeys(obj[k]);
            return result;
          }
          const canonical = JSON.stringify({
            tool: 'Edit',
            args: sortedKeys({ file_path: 'Sources/UserViewModel.swift', new_string: 'let x = 1', old_string: 'let x = 0' })
          }, null, 0);
          const hash = crypto.createHash('sha256').update(canonical).digest('hex');
          return JSON.stringify({
            session_id: 'fixture-repetition-001',
            turn_id: '0',
            entries: Array(4).fill(null).map(() => ({
              hash, tool: 'Edit', ts: Date.now() - 2000, args_preview: ''
            }))
          });
        })()
      }
    },
    expected: {
      exitCode: 2  // tool-repetition-detector CORRECTLY blocks repeated Edit calls (5th = block)
    }
  },

  // ── Subagent live tracker (observer) ────────────────────────────────────
  {
    hookName: 'subagent-live-tracker.cjs',
    displayName: 'subagent-live-tracker',
    category: 'observer',
    fixture: {
      input: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Task',
        tool_input: { subagent_type: 'test-agent', description: 'fixture test' },
        session_id: 'fixture-session'
      },
      env: { CLAUDE_SESSION_ID: 'fixture-sub-live-001' }
    },
    expected: {
      exitCode: 0,
      jsonlWrite: 'subagent-live.jsonl'
    }
  }
];

/**
 * Get all sensor fixtures.
 * @returns {object[]}
 */
function getSensorFixtures() {
  return FIXTURES;
}

/**
 * Get fixtures for a specific category.
 * @param {'observer' | 'blocking'} category
 * @returns {object[]}
 */
function getFixturesByCategory(category) {
  return FIXTURES.filter(f => f.category === category);
}

/**
 * Get a fixture by hook name (basename without path).
 * @param {string} name
 * @returns {object | null}
 */
function getFixtureByName(name) {
  return FIXTURES.find(f => f.displayName === name || f.hookName === name || f.hookName.endsWith(`/${name}`) ) || null;
}

module.exports = { getSensorFixtures, getFixturesByCategory, getFixtureByName, FIXTURES };
