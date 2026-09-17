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
  for (const filename of ['Code.js', 'CardCreate.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    vm.runInContext(source, sandbox, { filename });
  }
  return sandbox;
}

test('normalizeNewCardInput_ requires both question and answer', () => {
  const app = loadApp();

  assert.throws(() => app.normalizeNewCardInput_({ front_side: '   ', back_side: 'A' }), /問題と答え/);
  assert.throws(() => app.normalizeNewCardInput_({ front_side: 'Q', back_side: '\n' }), /問題と答え/);

  const card = app.normalizeNewCardInput_({ front_side: ' Q ', back_side: ' A ', notes: 'memo' });
  assert.equal(card.front_side, ' Q ');
  assert.equal(card.back_side, ' A ');
  assert.equal(card.notes, 'memo');
});

test('deckExistsForCreate_ only accepts an existing active deck', () => {
  const app = loadApp();
  const cards = [
    { type: 'A1', front_side: 'Q1', back_side: 'A1', exclude: '' },
    { type: 'hidden', front_side: 'Q2', back_side: 'A2', exclude: 'x' },
    { type: '', front_side: 'Q3', back_side: 'A3', exclude: '' }
  ];

  assert.equal(app.deckExistsForCreate_(cards, ' A1 '), true);
  assert.equal(app.deckExistsForCreate_(cards, ''), true);
  assert.equal(app.deckExistsForCreate_(cards, 'hidden'), false);
  assert.equal(app.deckExistsForCreate_(cards, 'new-deck'), false);
});

test('buildNewCardValues_ creates a fresh card row in the selected deck', () => {
  const app = loadApp();
  const card = { front_side: '=1+1', back_side: '2', notes: 'note' };
  const values = app.buildNewCardValues_('card-1', ' セキスペ ', card, '2026-09-18');

  assert.equal(values.length, app.HEADERS.length);
  assert.equal(values[app.COL.id - 1], 'card-1');
  assert.equal(values[app.COL.type - 1], 'セキスペ');
  assert.equal(values[app.COL.front_side - 1], '=1+1');
  assert.equal(values[app.COL.back_side - 1], '2');
  assert.equal(values[app.COL.notes - 1], 'note');
  assert.equal(values[app.COL.added - 1], '2026-09-18');
  assert.equal(values[app.COL.box - 1], '');
  assert.equal(values[app.COL.due - 1], '');
  assert.equal(values[app.COL.right - 1], '');
  assert.equal(values[app.COL.wrong - 1], '');
});
