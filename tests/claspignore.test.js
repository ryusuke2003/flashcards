'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function readClaspWhitelist() {
  const lines = fs.readFileSync(path.join(root, '.claspignore'), 'utf8').split(/\r?\n/);
  return new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line.startsWith('!') && line.length > 1)
      .map((line) => line.slice(1))
  );
}

test('.claspignore whitelists every root Apps Script source', () => {
  const whitelist = readClaspWhitelist();
  const sources = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.js') || name.endsWith('.html') || name === 'appsscript.json')
    .sort();

  const missing = sources.filter((name) => !whitelist.has(name));

  assert.deepEqual(
    missing,
    [],
    `Apps Script source files missing from .claspignore whitelist: ${missing.join(', ')}`
  );
});
