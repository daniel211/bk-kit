#!/usr/bin/env node
/**
 * bk.mjs — User-facing CLI entry point.
 *
 * One binary for all three kits. The platform is no longer baked in at build time: each command
 * resolves it from --kit, the project's .bk-version.json, or the project's own layout — see
 * lib/kit-resolver.mjs. Only '0.12.3' is still substituted by the build.
 */

import { Command } from 'commander';
import { registerInit } from '../commands/cmd-init.mjs';
import { registerDoctor } from '../commands/cmd-doctor.mjs';
import { registerUpdate } from '../commands/cmd-update.mjs';
import { registerDocs } from '../commands/cmd-docs.mjs';
import { registerMetrics } from '../commands/cmd-metrics.mjs';

const program = new Command();
program
  .name('bk')
  .description('beer-kit — iOS, Android and Flutter development kits for Claude Code')
  .version('0.12.3');

registerInit(program);
registerDoctor(program);
registerUpdate(program);
registerDocs(program);
registerMetrics(program);

// parseAsync, not parse: the init and doctor actions are async (doctor dynamically imports
// the installed kit's preflight module). With the sync parse() the returned promise is
// dropped, so a rejection inside an action would surface as an unhandled rejection instead of
// an error message.
program.parseAsync();
