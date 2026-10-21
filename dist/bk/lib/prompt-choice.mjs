/**
 * prompt-choice.mjs — Ask the user to pick one of a few named choices (used by `bk init`).
 *
 * Streams are injected so the helper is unit-testable. Accepts the choice name or its 1-based
 * number. Empty input, a closed stream, or a second invalid answer fall back to the default:
 * the first invalid answer re-asks once, never loops.
 */

import { createInterface } from 'node:readline';

/**
 * @param {object} args
 * @param {string} args.question — heading line printed above the choices
 * @param {{value:string, description?:string}[]} args.choices
 * @param {string} args.defaultValue — must be one of the choices' values
 * @param {NodeJS.ReadableStream} [args.input=process.stdin]
 * @param {NodeJS.WritableStream} [args.output=process.stdout]
 * @returns {Promise<string>} the chosen value
 */
export async function askChoice({ question, choices, defaultValue, input = process.stdin, output = process.stdout }) {
  const rl = createInterface({ input, output, terminal: false });
  // Lines are queued rather than read via rl.question: piped input can deliver (and close)
  // before the second question is asked, and a question-only reader would lose those lines.
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  rl.on('close', () => { closed = true; waiting.splice(0).forEach((w) => w('')); });
  const ask = (text) => {
    output.write(text);
    if (lines.length) return Promise.resolve(lines.shift());
    if (closed) return Promise.resolve('');
    return new Promise((resolve) => waiting.push(resolve));
  };

  output.write(`${question}\n`);
  choices.forEach((c, i) => {
    const mark = c.value === defaultValue ? ' (default)' : '';
    output.write(`  ${i + 1}) ${c.value}${mark}${c.description ? ` — ${c.description}` : ''}\n`);
  });

  const parse = (raw) => {
    const answer = raw.trim().toLowerCase();
    if (answer === '') return defaultValue;
    const byNumber = choices[Number(answer) - 1];
    if (/^\d+$/.test(answer) && byNumber) return byNumber.value;
    return choices.find((c) => c.value === answer)?.value ?? null;
  };

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const picked = parse(await ask(`Choice [${defaultValue}]: `));
      if (picked !== null) return picked;
      if (attempt === 0) output.write('Not a valid choice, try again.\n');
    }
    output.write(`Not a valid choice, using ${defaultValue}.\n`);
    return defaultValue;
  } finally {
    rl.close();
  }
}
