'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadApp() {
  const sandbox = {
    console,
    Date,
    Math,
    Utilities: {
      formatDate() {
        return '2026-09-18';
      },
      getUuid() {
        return 'test-uuid';
      }
    },
    Session: {
      getScriptTimeZone() {
        return 'UTC';
      }
    }
  };

  vm.createContext(sandbox);
  for (const filename of ['Code.js', 'Decks.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    vm.runInContext(source, sandbox, { filename });
  }
  return sandbox;
}

test('normalizeNewDeckName_ trims names and rejects ambiguous or invalid names', () => {
  const app = loadApp();

  assert.equal(app.normalizeNewDeckName_('  ネットワーク  '), 'ネットワーク');
  assert.throws(() => app.normalizeNewDeckName_('   '), /デッキ名/);
  assert.throws(() => app.normalizeNewDeckName_('未分類'), /未分類カード用/);
  assert.throws(() => app.normalizeNewDeckName_('line1\nline2'), /1行/);
  assert.throws(() => app.normalizeNewDeckName_('a'.repeat(81)), /80文字以内/);
});

test('mergeDeckSummariesWithRegistry_ keeps card counts and adds registered empty decks', () => {
  const app = loadApp();
  const existing = [{
    key: 'A1',
    name: 'A1',
    total: 611,
    due: 102,
    fresh: 464,
    mistakesToday: 26,
    flagged: 0
  }];

  const merged = Array.from(app.mergeDeckSummariesWithRegistry_(existing, ['A1', ' 新規 ' , '新規']));

  assert.equal(merged.length, 2);
  const a1 = merged.find((deck) => deck.key === 'A1');
  const empty = merged.find((deck) => deck.key === '新規');
  assert.equal(a1.total, 611);
  assert.equal(a1.fresh, 464);
  assert.equal(empty.total, 0);
  assert.equal(empty.due, 0);
  assert.equal(empty.fresh, 0);
  assert.equal(empty.mistakesToday, 0);
});

test('emptyDeckSummary_ returns a zero-card deck that can be opened before cards exist', () => {
  const app = loadApp();
  const deck = app.emptyDeckSummary_(' セキュリティ ');

  assert.equal(deck.key, 'セキュリティ');
  assert.equal(deck.name, 'セキュリティ');
  assert.equal(deck.total, 0);
  assert.equal(deck.flagged, 0);
});
