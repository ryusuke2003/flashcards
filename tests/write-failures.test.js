'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, card } = require('./helpers/app');

const normal = (name, id) => [name, new Date('2026-01-01T00:00:00Z'), id, 'normal', '[]'];
const combined = ['まとめ', '', 'combo', 'combined', '["a","b"]'];
const events = [
  { eventId: 'correct-a', cardId: 'ca', rowHint: 2, correct: true },
  { eventId: 'wrong-a', cardId: 'ca', rowHint: 2, correct: false },
  { eventId: 'correct-b', cardId: 'cb', rowHint: 3, correct: true },
  { eventId: 'practice-a', cardId: 'practice', rowHint: 4, correct: true, practice: true }
];

function setup(initialized = true) {
  const base = loadApp();
  const statsKey = base.app.dailyStudyDateProperty_(base.app.today_());
  const stats = initialized ? {
    [statsKey]: '{ "deck:A": 3, "deck:B": 2, "deck:other": 9 }',
    [base.app.GRADE_EVENT_HISTORY_KEY]: '[ "older-event" ]'
  } : {};
  const env = loadApp([
    card(base.app, 'A', 'QA', 'AA', '', {
      id: 'ca', box: 1, right: 4, wrong: 2, last_seen: new Date('2026-10-03T00:00:00Z'),
      last_wrong: '2026-10-03', flag: '⚑'
    }),
    card(base.app, 'B', 'QB', 'AB', '', { id: 'cb' }),
    card(base.app, 'A', 'practice Q', 'practice A', '', {
      id: 'practice', box: 2, right: 7, due: '2026-10-07', last_wrong: '2026-10-03'
    })
  ], [normal('A', 'a'), normal('B', 'b'), combined], { unrelated: 'preserved', ...stats });
  env.app.getDecksWithRegistry();
  return { ...env, statsKey };
}

const snapshotRows = sheet => sheet.rows.slice(0, sheet.getLastRow()).map(row => row.slice());
function snapshot(env) {
  return { cards: snapshotRows(env.cards), decks: snapshotRows(env.decks), properties: { ...env.properties } };
}
function assertRestored(env, before) {
  assert.deepEqual(snapshot(env), before);
  assert.equal(env.cache.get(env.app.deckSummaryCacheKey_(env.app.today_())), null);
}

// Sheets can buffer writes and a failed flush can apply none, some, or all of them.
// Exercise both discarded and retained pending writes; no assumption of atomicity.
function bufferWrites(env, failures = [], sheets = [env.cards, env.decks]) {
  let pending = [];
  let flushCount = 0;
  let locked = false;
  const copy = value => Array.isArray(value) ? value.map(copy) : value;
  for (const sheet of sheets) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...coordinates) => {
      const range = getRange(...coordinates);
      for (const method of ['setValues', 'setValue', 'setRichTextValues', 'setRichTextValue', 'clearContent']) {
        const write = range[method];
        range[method] = (...args) => {
          const values = args.map(copy);
          pending.push(() => write.apply(range, values));
          return range;
        };
      }
      return range;
    };
  }
  const getLock = env.app.LockService.getScriptLock;
  env.app.LockService.getScriptLock = () => {
    const lock = getLock();
    return {
      waitLock(timeout) { lock.waitLock(timeout); locked = true; },
      releaseLock() {
        assert.equal(pending.length, 0, 'writes must be flushed before releasing the lock');
        locked = false;
        lock.releaseLock();
      }
    };
  };
  env.app.SpreadsheetApp.flush = () => {
    assert.equal(locked, true);
    const failure = failures[flushCount++];
    if (failure) {
      pending.splice(0, failure.apply).forEach(write => write());
      if (!failure.retain) pending = [];
      throw new Error('flush failed');
    }
    const writes = pending;
    pending = [];
    writes.forEach(write => write());
  };
  return { get flushCount() { return flushCount; }, get locked() { return locked; } };
}

function failPropertyOnce(env, key, afterWrite) {
  const getProperties = env.app.PropertiesService.getDocumentProperties;
  let armed = true;
  env.app.PropertiesService.getDocumentProperties = () => {
    const properties = getProperties();
    const setProperty = properties.setProperty.bind(properties);
    properties.setProperty = (name, value) => {
      if (armed && name === key) {
        armed = false;
        if (afterWrite) setProperty(name, value);
        throw new Error('property save failed');
      }
      setProperty(name, value);
    };
    return properties;
  };
}

function assertGradedOnce(env, initialized = true) {
  const { app, cards, properties, statsKey } = env;
  assert.equal(cards.rows[1][app.COL.right - 1], 5);
  assert.equal(cards.rows[1][app.COL.wrong - 1], 3);
  assert.equal(cards.rows[1][app.COL.box - 1], 1);
  assert.equal(cards.rows[2][app.COL.right - 1], 1);
  assert.equal(cards.rows[3][app.COL.right - 1], 7);
  assert.equal(cards.rows[3][app.COL.box - 1], 2);
  assert.equal(cards.rows[3][app.COL.due - 1], '2026-10-07');
  assert.equal(cards.rows[3][app.COL.last_wrong_reviewed - 1], '2026-10-03');
  assert.deepEqual(JSON.parse(properties[statsKey]), initialized ?
    { 'deck:A': 6, 'deck:B': 3, 'deck:other': 9 } : { 'deck:A': 3, 'deck:B': 1 });
  assert.deepEqual(JSON.parse(properties[app.GRADE_EVENT_HISTORY_KEY]),
    [...(initialized ? ['older-event'] : []), ...events.map(event => event.eventId)]);
}

for (const [name, failure] of [
  ['no writes applied', { apply: 0, retain: false }],
  ['partially applied writes retained', { apply: 1, retain: true }],
  ['all writes applied before failure', { apply: Infinity, retain: false }]
]) {
  test(`failed grade flush restores the batch and permits one retry: ${name}`, () => {
    const env = setup();
    const before = snapshot(env);
    const writes = bufferWrites(env, [failure]);
    assert.throws(() => env.app.gradeCardsQueued(events), /flush failed/);
    assertRestored(env, before);
    assert.equal(writes.locked, false);
    assert.equal(env.app.gradeCardsQueued(events).completedEventIds.length, events.length);
    assertGradedOnce(env);
    const saved = snapshot(env);
    assert.equal(env.app.gradeCardsQueued(events).duplicateEventIds.length, events.length);
    assert.deepEqual(snapshot(env), saved);
  });
}

for (const initialized of [true, false]) {
  for (const property of ['study count', 'event history']) {
    for (const afterWrite of [false, true]) {
      test(`grade ${property} failure ${afterWrite ? 'after' : 'before'} saving restores ${initialized ? 'existing' : 'absent'} properties`, () => {
        const env = setup(initialized);
        const before = snapshot(env);
        bufferWrites(env);
        failPropertyOnce(env, property === 'study count' ? env.statsKey : env.app.GRADE_EVENT_HISTORY_KEY, afterWrite);
        assert.throws(() => env.app.gradeCardsQueued(events), /property save failed/);
        assertRestored(env, before);
        env.app.gradeCardsQueued(events);
        assertGradedOnce(env, initialized);
      });
    }
  }
}

test('a partially applied grade setValues failure restores every attempted row before retrying', () => {
  const env = setup();
  const before = snapshot(env);
  const getRange = env.cards.getRange.bind(env.cards);
  let armed = true;
  env.cards.getRange = (row, column, ...size) => {
    const range = getRange(row, column, ...size);
    const setValues = range.setValues.bind(range);
    range.setValues = values => {
      setValues(values);
      if (armed && row === 3 && column === env.app.COL.box) {
        armed = false;
        throw new Error('row save failed');
      }
      return range;
    };
    return range;
  };
  assert.throws(() => env.app.gradeCardsQueued(events), /row save failed/);
  assertRestored(env, before);
  env.app.gradeCardsQueued(events);
  assertGradedOnce(env);
});

test('failure preparing an event count does not persist its grade or consume its event ID', () => {
  const env = setup();
  const increment = env.app.incrementDailyStudyCount_;
  let calls = 0;
  env.app.incrementDailyStudyCount_ = (...args) => {
    if (++calls === 2) throw new Error('baseline read failed');
    return increment(...args);
  };
  const result = env.app.gradeCardsQueued(events);
  assert.deepEqual(Array.from(result.failed, event => event.eventId), ['wrong-a']);
  assert.equal(env.cards.rows[1][env.app.COL.right - 1], 5);
  assert.equal(env.cards.rows[1][env.app.COL.wrong - 1], 2);
  assert.equal(env.cards.rows[1][env.app.COL.box - 1], 2);
  env.app.gradeCardsQueued(events);
  // The retry must apply the failed event alone, preserving previously completed events.
  assert.equal(env.app.gradeCardsQueued(events).duplicateEventIds.length, events.length);
  assert.equal(env.cards.rows[1][env.app.COL.right - 1], 5);
  assert.equal(env.cards.rows[1][env.app.COL.wrong - 1], 3);
  assert.deepEqual(JSON.parse(env.properties[env.statsKey]), { 'deck:A': 6, 'deck:B': 3, 'deck:other': 9 });
});

test('grades are committed before properties and no final flush can fail after acknowledgement', () => {
  const env = setup();
  const writes = bufferWrites(env, [null, { apply: 0, retain: false }]);
  const getProperties = env.app.PropertiesService.getDocumentProperties;
  env.app.PropertiesService.getDocumentProperties = () => {
    const properties = getProperties();
    const setProperty = properties.setProperty.bind(properties);
    properties.setProperty = (key, value) => {
      assert.equal(writes.flushCount, 1);
      assert.equal(env.cards.rows[1][env.app.COL.right - 1], 5);
      setProperty(key, value);
    };
    return properties;
  };
  assert.equal(env.app.gradeCardsQueued(events).ok, true);
  assertGradedOnce(env);
  assert.equal(writes.locked, false);
});

const deckMutations = [
  ['source rename', app => app.renameDeck('A', '新A')],
  ['source deletion', app => app.deleteDeck('A')],
  ['normal creation', app => app.createDeck('新規')],
  ['combined creation', app => app.createCombinedDeck('新まとめ', ['a', 'b'])],
  ['combined edit', app => app.updateCombinedDeck('まとめ', '新まとめ', ['b'])],
  ['combined deletion', app => app.deleteDeck('まとめ')]
];
for (const [name, mutate] of deckMutations) {
  test(`a partial flush failure restores cards, references and counts for ${name}`, () => {
    const env = setup();
    const before = snapshot(env);
    bufferWrites(env, [{ apply: 1, retain: true }]);
    assert.throws(() => mutate(env.app), /flush failed/);
    assertRestored(env, before);
    const restored = env.app.getDecksWithRegistry();
    assert.equal(restored.find(deck => deck.key === 'まとめ').total, 3);
    assert.equal(restored.find(deck => deck.key === 'まとめ').sources[0].name, 'A');
    assert.equal(mutate(env.app).ok, true);
  });
}

test('a failed source rename restores immediate card writes when buffered registry writes are discarded', () => {
  const env = setup();
  const before = snapshot(env);
  // Match the review reproduction: only registry writes are delayed.
  bufferWrites(env, [{ apply: 0, retain: false }], [env.decks]);
  assert.throws(() => env.app.renameDeck('A', '新A'), /flush failed/);
  assertRestored(env, before);
  assert.equal(env.app.getDecksWithRegistry().find(deck => deck.key === 'まとめ').total, 3);
  assert.equal(env.app.renameDeck('A', '新A').ok, true);
  assert.equal(env.app.getDecksWithRegistry().find(deck => deck.key === 'まとめ').total, 3);
});

test('a property failure after a deck flush restores and flushes cards, registry and counters', () => {
  const env = setup();
  const before = snapshot(env);
  const writes = bufferWrites(env);
  failPropertyOnce(env, env.statsKey, true);
  assert.throws(() => env.app.deleteDeck('A'), /property save failed/);
  assertRestored(env, before);
  assert.equal(writes.locked, false);
  assert.equal(env.app.deleteDeck('A').ok, true);
  assert.equal(env.app.getDecksWithRegistry().find(deck => deck.key === 'まとめ').total, 1);
  assert.deepEqual(JSON.parse(env.properties[env.statsKey]), { 'deck:': 3, 'deck:B': 2, 'deck:other': 9 });
});

test('a deck commit flushes before moving counters and has no flush after the durable save', () => {
  const env = setup();
  const writes = bufferWrites(env, [null, { apply: 0, retain: false }]);
  const getProperties = env.app.PropertiesService.getDocumentProperties;
  env.app.PropertiesService.getDocumentProperties = () => {
    const properties = getProperties();
    const setProperty = properties.setProperty.bind(properties);
    properties.setProperty = (key, value) => {
      assert.equal(writes.flushCount, 1);
      assert.equal(env.cards.rows[1][env.app.COL.type - 1], '新A');
      assert.equal(env.decks.rows[1][0], '新A');
      setProperty(key, value);
    };
    return properties;
  };
  assert.equal(env.app.renameDeck('A', '新A').ok, true);
  assert.equal(writes.locked, false);
});
