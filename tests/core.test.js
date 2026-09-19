'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadApp() {
  const sandbox = {
    console,
    Date,
    Math,
    Utilities: {
      formatDate(date) {
        return formatIsoDate(date);
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
  for (const filename of ['Code.js', 'GradeSync.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    vm.runInContext(source, sandbox, { filename });
  }
  return sandbox;
}

function makeValues(app, overrides) {
  const values = app.HEADERS.map(() => '');
  for (const [key, value] of Object.entries(overrides || {})) {
    values[app.COL[key] - 1] = value;
  }
  return values;
}

test('filterCardsByDeck_ distinguishes all cards from the untyped deck', () => {
  const app = loadApp();
  const cards = [
    { id: '1', type: 'A1' },
    { id: '2', type: '' },
    { id: '3', type: ' セキスペ ' }
  ];

  assert.deepEqual(Array.from(app.filterCardsByDeck_(cards, null)).map((card) => card.id), ['1', '2', '3']);
  assert.deepEqual(Array.from(app.filterCardsByDeck_(cards, '')).map((card) => card.id), ['2']);
  assert.deepEqual(Array.from(app.filterCardsByDeck_(cards, 'セキスペ')).map((card) => card.id), ['3']);
});

test('isDue_ treats blank and past dates as due but not future dates', () => {
  const app = loadApp();
  const today = '2026-09-16';

  assert.equal(app.isDue_('', today), true);
  assert.equal(app.isDue_('2026-09-15', today), true);
  assert.equal(app.isDue_('2026-9-16', today), true);
  assert.equal(app.isDue_('2026-09-17', today), false);
});

test('isPendingMistake_ keeps an older unresolved mistake pending until reviewed', () => {
  const app = loadApp();
  const today = '2026-09-16';

  assert.equal(app.isPendingMistake_({ last_wrong: '2026-09-15', last_wrong_reviewed: '' }, today), true);
  assert.equal(app.isPendingMistake_({ last_wrong: '2026-09-15', last_wrong_reviewed: '2026-09-14' }, today), true);
  assert.equal(app.isPendingMistake_({ last_wrong: '2026-09-15', last_wrong_reviewed: '2026-09-15' }, today), false);
  assert.equal(app.isPendingMistake_({ last_wrong: '2026-09-17', last_wrong_reviewed: '' }, today), false);
});

test('isAddedToday_ matches the normalized added date to today', () => {
  const app = loadApp();
  const today = '2026-09-19';

  assert.equal(app.isAddedToday_({ added: '2026-9-19' }, today), true);
  assert.equal(app.isAddedToday_({ added: '2026-09-18' }, today), false);
  assert.equal(app.isAddedToday_({ added: '' }, today), false);
});

test('getSession exposes addedToday only for active cards in the selected deck', () => {
  const app = loadApp();
  const cards = [
    { id: '1', type: 'A1', front_side: 'Q1', back_side: 'A1', exclude: '', box: '', added: '2026-09-19' },
    { id: '2', type: 'A1', front_side: 'Q2', back_side: 'A2', exclude: '', box: '', added: '2026-09-18' },
    { id: '3', type: 'A1', front_side: 'Q3', back_side: 'A3', exclude: 'x', box: '', added: '2026-09-19' },
    { id: '4', type: 'セキスペ', front_side: 'Q4', back_side: 'A4', exclude: '', box: '', added: '2026-09-19' }
  ];

  app.getSheet_ = () => ({});
  app.readCards_ = () => cards;
  app.today_ = () => '2026-09-19';
  app.SpreadsheetApp = {
    getActiveSpreadsheet() {
      return { getUrl: () => 'https://example.test/sheet' };
    }
  };

  const session = app.getSession('A1');

  assert.equal(session.counts.addedToday, 1);
  assert.equal(session.counts.total, 2);
});

test('getTodaysAddedCards returns only active cards added today in the selected deck', () => {
  const app = loadApp();
  const cards = [
    { id: 'a', type: 'A1', front_side: 'Q1', back_side: 'A1', exclude: '', added: '2026-09-19', right: 2, wrong: 1, _row: 2 },
    { id: 'b', type: 'A1', front_side: 'Q2', back_side: 'A2', exclude: '', added: '2026-09-19', right: '', wrong: '', _row: 3 },
    { id: 'c', type: 'A1', front_side: 'Q3', back_side: 'A3', exclude: '', added: '2026-09-18', right: '', wrong: '', _row: 4 },
    { id: 'd', type: 'A1', front_side: 'Q4', back_side: 'A4', exclude: 'x', added: '2026-09-19', right: '', wrong: '', _row: 5 },
    { id: 'e', type: 'セキスペ', front_side: 'Q5', back_side: 'A5', exclude: '', added: '2026-09-19', right: '', wrong: '', _row: 6 }
  ];

  app.getSheet_ = () => ({});
  app.readCards_ = () => cards;
  app.today_ = () => '2026-09-19';

  const selected = Array.from(app.getTodaysAddedCards('A1'));

  assert.deepEqual(selected.map((card) => card.id), ['b', 'a']);
});

test('clampLimit_ falls back for invalid limits and caps large limits', () => {
  const app = loadApp();

  assert.equal(app.clampLimit_(undefined, 20), 20);
  assert.equal(app.clampLimit_(0, 20), 20);
  assert.equal(app.clampLimit_(7.9, 20), 7);
  assert.equal(app.clampLimit_(100, 20), 20);
});

test('normalizeGradeEvent_ trims identifiers and accepts row as a fallback hint', () => {
  const app = loadApp();
  const event = app.normalizeGradeEvent_({
    eventId: ' event-1 ',
    cardId: ' card-1 ',
    row: '3',
    correct: 1,
    practice: 0
  });

  assert.equal(event.eventId, 'event-1');
  assert.equal(event.cardId, 'card-1');
  assert.equal(event.rowHint, 3);
  assert.equal(event.correct, true);
  assert.equal(event.practice, false);
  assert.throws(() => app.normalizeGradeEvent_({ eventId: 'bad id' }), /不正な採点イベントID/);
});

test('applyGradeToState_ advances a correct new card and increments right', () => {
  const app = loadApp();
  const values = makeValues(app, {
    id: 'card-1',
    front_side: 'Q',
    back_side: 'A',
    box: '',
    right: '',
    wrong: ''
  });

  app.applyGradeToState_(values, true, '2026-09-16');

  assert.equal(values[app.COL.box - 1], 2);
  assert.equal(values[app.COL.due - 1], '2026-09-18');
  assert.equal(values[app.COL.last_seen - 1], '2026-09-16');
  assert.equal(values[app.COL.right - 1], 1);
  assert.equal(values[app.COL.wrong - 1], '');
});

test('applyGradeToState_ resets an incorrect card and records the latest mistake', () => {
  const app = loadApp();
  const values = makeValues(app, {
    id: 'card-2',
    front_side: 'Q',
    back_side: 'A',
    box: 4,
    right: 5,
    wrong: 2,
    last_wrong: '2026-09-10',
    last_wrong_reviewed: '2026-09-10'
  });

  app.applyGradeToState_(values, false, '2026-09-16');

  assert.equal(values[app.COL.box - 1], 1);
  assert.equal(values[app.COL.due - 1], '2026-09-17');
  assert.equal(values[app.COL.last_seen - 1], '2026-09-16');
  assert.equal(values[app.COL.right - 1], 5);
  assert.equal(values[app.COL.wrong - 1], 3);
  assert.equal(values[app.COL.last_wrong - 1], '2026-09-16');
  assert.equal(values[app.COL.last_wrong_reviewed - 1], '');
});

test('applyGradeToState_ keeps a correct card at the maximum box', () => {
  const app = loadApp();
  const values = makeValues(app, {
    id: 'card-3',
    front_side: 'Q',
    back_side: 'A',
    box: 5,
    right: 3,
    wrong: 1
  });

  app.applyGradeToState_(values, true, '2026-09-16');

  assert.equal(values[app.COL.box - 1], 5);
  assert.equal(values[app.COL.due - 1], '2026-10-02');
  assert.equal(values[app.COL.right - 1], 4);
});

test('markMistakeReviewedInState_ records the latest mistake only once', () => {
  const app = loadApp();
  const values = makeValues(app, {
    last_wrong: '2026-09-15',
    last_wrong_reviewed: '2026-09-14'
  });

  assert.equal(app.markMistakeReviewedInState_(values), true);
  assert.equal(values[app.COL.last_wrong_reviewed - 1], '2026-09-15');
  assert.equal(app.markMistakeReviewedInState_(values), false);
});

function makeIdSheet(idsByRow) {
  const rows = Object.keys(idsByRow).map(Number);
  const lastRow = Math.max(...rows);

  return {
    getLastRow() {
      return lastRow;
    },
    getRange(row, column, numRows) {
      if (numRows == null) {
        return {
          getDisplayValue() {
            return idsByRow[row] || '';
          }
        };
      }
      return {
        getDisplayValues() {
          const values = [];
          for (let offset = 0; offset < numRows; offset++) {
            values.push([idsByRow[row + offset] || '']);
          }
          return values;
        }
      };
    }
  };
}

test('resolveCardRowById_ ignores a stale row hint and resolves by stable card ID', () => {
  const app = loadApp();
  const sheet = makeIdSheet({ 2: 'card-a', 3: 'card-b' });

  assert.equal(app.resolveCardRowById_(sheet, 'card-b', 2), 3);
});

test('resolveCardRowById_ rejects duplicate stable card IDs', () => {
  const app = loadApp();
  const sheet = makeIdSheet({ 2: 'card-a', 3: 'card-b', 4: 'card-b' });

  assert.throws(() => app.resolveCardRowById_(sheet, 'card-b', 0), /重複/);
});
