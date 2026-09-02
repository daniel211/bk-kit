#!/usr/bin/env node
/**
 * bk-android.mjs — User-facing CLI entry point.
 *
 * This file is renamed to bk-{platform}.mjs at build time.
 * Placeholder 'android' is replaced with the actual platform name.
 */

import { Command } from 'commander';
import { registerInit } from '../commands/cmd-init.mjs';
import { registerDoctor } from '../commands/cmd-doctor.mjs';
import { registerUpdate } from '../commands/cmd-update.mjs';
import { registerDocs } from '../commands/cmd-docs.mjs';
import { registerMetrics } from '../commands/cmd-metrics.mjs';

const PLATFORM = 'android';

const program = new Command();
program
  .name(`bk-${PLATFORM}`)
  .description(`beer-kit ${PLATFORM} Development Kit for Claude Code`)
  .version('0.1.2');

registerInit(program, PLATFORM);
registerDoctor(program, PLATFORM);
registerUpdate(program, PLATFORM);
registerDocs(program, PLATFORM);
registerMetrics(program);

program.parse();
