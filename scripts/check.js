'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = ['app.js', 'cli.js', ...fs.readdirSync(path.join(root, 'core')).filter(f => f.endsWith('.js')).map(f => 'core/' + f), ...fs.readdirSync(path.join(root, 'scripts')).filter(f => f.endsWith('.js')).map(f => 'scripts/' + f), ...fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js')).map(f => 'test/' + f)];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('JavaScript syntax check failed: ' + file + '\n' + result.stderr);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes("connect-src 'none'")) throw new Error('Offline CSP is missing.');
if (/\son\w+\s*=/i.test(html) || /<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(html)) throw new Error('Inline handler or remote executable asset is forbidden.');
for (const [, script] of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
  if (!fs.existsSync(path.join(root, script))) throw new Error('Missing browser script.');
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML IDs.');
const runtime = ['app.js', ...files.filter(f => f.startsWith('core/'))].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\b|\.innerHTML\s*=|\beval\s*\(/.test(runtime)) throw new Error('Runtime network, persistence or executable-HTML API requires a reviewed architecture change.');
const result = spawnSync(process.execPath, [path.join(root, 'scripts/test.js')], { stdio: 'inherit', timeout: 150000 });
if (result.status !== 0) process.exitCode = 1;
else process.stdout.write('Syntax, offline surface checks and non-empty test suite passed.\n');
