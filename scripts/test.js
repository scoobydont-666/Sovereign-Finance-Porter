'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(root, 'test', f));
if (!files.length) throw new Error('No tests discovered.');
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
const count = /^# tests (\d+)$/m.exec(result.stdout || '');
const skipped = /^# skipped (\d+)$/m.exec(result.stdout || '');
if (result.status !== 0 || !count || Number(count[1]) === 0 || !skipped || Number(skipped[1]) !== 0) {
  process.stderr.write('Test gate failed: failed, missing, empty or skipped suite.\n');
  process.exitCode = 1;
}
