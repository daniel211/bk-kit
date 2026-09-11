#!/usr/bin/env node
/**
 * bk-flutter.mjs — User-facing CLI entry point.
 *
 * This file is renamed to bk-{platform}.mjs at build time.
 * Placeholder 'flutter' is replaced with the actual platform name.
 */

import { Command } from 'commander';
import { registerInit } from '../commands/cmd-init.mjs';
import { registerDoctor } from '../commands/cmd-doctor.mjs';
import { registerUpdate } from '../commands/cmd-update.mjs';
import { registerDocs } from '../commands/cmd-docs.mjs';
import { registerMetrics } from '../commands/cmd-metrics.mjs';

const PLATFORM = 'flutter';

const program = new Command();
program
  .name(`bk-${PLATFORM}`)
  .description(`beer-kit ${PLATFORM} Development Kit for Claude Code`)
  .version('0.7.1');

registerInit(program, PLATFORM);
registerDoctor(program, PLATFORM);
registerUpdate(program, PLATFORM);
registerDocs(program, PLATFORM);
registerMetrics(program);

// parseAsync, not parse: the init and doctor actions are async (doctor dynamically imports
// the installed kit's preflight module). With the sync parse() the returned promise is
// dropped, so a rejection inside an action would surface as an unhandled rejection instead of
// an error message.
program.parseAsync();
