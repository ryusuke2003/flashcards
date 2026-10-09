'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, card } = require('./helpers/app');
const { loadUI } = require('./helpers/ui');

const normal = (name, id) => [name, '', id, 'normal', '[]'];
const combined = ['まとめ', '', 'combo', 'combined', '["a","b"]'];
const plain = value => JSON.parse(JSON.stringify(value));

function setup() {
  const base = loadApp();
  return loadApp([
    card(base.app, 'A', 'QA', 'AA', '', { id: 'ca', box: 1, due: '2026-10-04', last_wrong: '2026-10-04' }),
    card(base.app, 'B', 'QB', 'AB', '', { id: 'cb' })
  ], [normal('A', 'a'), normal('B', 'b'), combined]);
}

test('a 2000-card combined home reads cards once and reuses them for missing study-count baselines', () => {
  const base = loadApp();
  const rows = Array.from({ length: 2000 }, (_, i) => card(base.app, i % 2 ? 'B' : 'A', 'Q' + i, 'A', '', {
    id: 'c-' + i, last_seen: i < 10 ? '2026-10-04' : ''
  }));
  rows.push(card(base.app, 'B', '   ', 'A', '', { id: 'blank-question', last_seen: '2026-10-04' }));
  rows.push(card(base.app, 'B', 'Q', 'A', 'x', { id: 'excluded', last_seen: '2026-10-04' }));
  const statsKey = base.app.dailyStudyDateProperty_('2026-10-04');
  const { app, cards, properties } = loadApp(rows, [normal('A', 'a'), normal('B', 'b'), combined], {
    [statsKey]: JSON.stringify({ 'deck:A': 7, 'deck:other': 91 })
  });
  app.countCardsSeenTodayInDeck_ = () => { throw new Error('unexpected second card read'); };
  const session = app.getSession('まとめ');
  assert.equal(session.queue.length, 50);
  assert.equal(session.todayStudyCount, 12);
  assert.deepEqual(JSON.parse(properties[statsKey]), { 'deck:A': 7, 'deck:other': 91, 'deck:B': 5 });
  assert.equal(cards.operations.filter(op => op.method === 'getValues' && op.row === 2 && op.width === app.HEADERS.length).length, 1);
  assert.equal(app.getSession('A').todayStudyCount, 7);
  assert.equal(app.getSession('B').todayStudyCount, 5);
});

test('home includes counts for an untyped deck and an empty combined deck', () => {
  const base = loadApp();
  const { app, properties } = loadApp([
    card(base.app, '', 'Q', 'A', '', { id: 'untyped', last_seen: '2026-10-04' })
  ], [['空まとめ', '', 'empty', 'combined', '[]']]);
  assert.equal(app.getSession('').todayStudyCount, 1);
  assert.equal(app.getSession('空まとめ').todayStudyCount, 0);
  assert.deepEqual(JSON.parse(properties[app.dailyStudyDateProperty_(app.today_())]), { 'deck:': 1 });
});

test('cached listing skips sheet reads, force refresh sees direct edits, and entries expire after 45 seconds', () => {
  const { app, cards, decks, advanceTime } = setup();
  const first = plain(app.getDecksWithRegistry());
  cards.operations.length = decks.operations.length = 0;
  assert.deepEqual(plain(app.getDecksWithRegistry()), first);
  assert.equal(cards.operations.length + decks.operations.length, 0);
  cards.rows.push(card(app, 'A', 'direct edit', 'A', '', { id: 'direct' }));
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').total, 1);
  assert.equal(app.getDecksWithRegistry(true).find(deck => deck.key === 'A').total, 2);
  cards.rows.push(card(app, 'A', 'another edit', 'A', '', { id: 'direct-2' }));
  advanceTime(44000);
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').total, 2);
  advanceTime(2000);
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').total, 3);
});

test('listing cache rolls over at midnight and study cards always reflect direct sheet edits', () => {
  const { app, cards } = setup();
  app.getDecksWithRegistry();
  cards.rows[1][app.COL.front_side - 1] = 'edited question';
  assert.equal(app.getSession('A').queue[0].front_side, 'edited question');
  app.today_ = () => '2026-10-05';
  cards.operations.length = 0;
  const decks = app.getDecksWithRegistry();
  assert.equal(decks.find(deck => deck.key === 'A').due, 1);
  assert.ok(cards.operations.some(op => op.method === 'getValues' && op.row === 2));
});

const mutations = [
  ['card creation', app => app.createCard('A', { front_side: 'new', back_side: 'A' }), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').total, 3)],
  ['card content editing', app => app.updateCardById('ca', 2, { back_side: '' }), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').total, 1)],
  ['flagging', app => app.updateCardById('ca', 2, { flag: '⚑' }), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').flagged, 1)],
  ['exclusion', app => app.updateCardById('ca', 2, { exclude: 'x' }), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').total, 1)],
  ['card deletion', app => app.deleteCardById('ca', 2), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').total, 1)],
  ['queued grading', app => app.gradeCardsQueued([{ eventId: 'grade', cardId: 'ca', rowHint: 2, correct: true }]), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').due, 0)],
  ['practice grading', app => app.gradeCardsQueued([{ eventId: 'practice', cardId: 'ca', rowHint: 2, correct: true, practice: true }]), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').mistakesToday, 0)],
  ['legacy grading', app => app.gradeCard(2, true, false), decks => assert.equal(decks.find(deck => deck.key === 'A').due, 0)],
  ['legacy editing', app => app.updateCard(2, { flag: '⚑' }), decks => assert.equal(decks.find(deck => deck.key === 'A').flagged, 1)],
  ['deck creation', app => app.createDeck('新規'), decks => assert.equal(decks.find(deck => deck.key === '新規').total, 0)],
  ['combined creation', app => app.createCombinedDeck('新まとめ', ['a', 'b']), decks => assert.equal(decks.find(deck => deck.key === '新まとめ').total, 2)],
  ['source rename', app => app.renameDeck('A', '新A'), decks => {
    assert.ok(!decks.some(deck => deck.key === 'A'));
    assert.equal(decks.find(deck => deck.key === 'まとめ').sources[0].name, '新A');
  }],
  ['combined source editing', app => app.updateCombinedDeck('まとめ', 'まとめ', ['b']), decks => assert.equal(decks.find(deck => deck.key === 'まとめ').total, 1)],
  ['source deletion', app => app.deleteDeck('A'), decks => {
    assert.equal(decks.find(deck => deck.key === 'まとめ').total, 1);
    assert.equal(decks.find(deck => deck.key === '').total, 1);
  }],
  ['combined deletion', app => app.deleteDeck('まとめ'), decks => assert.ok(!decks.some(deck => deck.key === 'まとめ'))]
];
for (const [name, mutate, verify] of mutations) {
  test(`${name} invalidates both normal and combined listing summaries`, () => {
    const { app } = setup();
    app.getDecksWithRegistry();
    mutate(app);
    verify(app.getDecksWithRegistry());
  });
}

test('cache eviction, malformed data and unavailable cache never prevent reading or saving', () => {
  const { app, cache, cards } = setup();
  const key = app.deckSummaryCacheKey_(app.today_());
  app.getDecksWithRegistry();
  cache.remove(key);
  cards.rows.push(card(app, 'A', 'external', 'A', '', { id: 'external' }));
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').total, 2);
  cache.put(key, 'invalid JSON', 45);
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').total, 2);
  cache.put(key, JSON.stringify({ decks: [], expiresAt: Date.now() - 1 }), 45);
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').total, 2);
  app.CacheService.getScriptCache = () => { throw new Error('cache unavailable'); };
  app.updateCardById('ca', 2, { flag: '⚑' });
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').flagged, 1);
});

test('an oversized cache write falls back to the freshly computed summaries', () => {
  const { app, cache } = setup();
  cache.put = () => { throw new Error('cache size limit'); };
  assert.equal(app.getDecksWithRegistry().length, 3);
  assert.equal(app.getDecksWithRegistry().length, 3);
});

test('mutation commits pending sheet writes before invalidating summaries and releasing its lock', () => {
  const { app, cache } = setup();
  app.getDecksWithRegistry();
  const originalLock = app.LockService.getScriptLock;
  const originalRemove = cache.remove;
  let locked = false;
  let flushed = false;
  let removed = false;
  app.LockService.getScriptLock = () => {
    const lock = originalLock();
    return {
      waitLock(timeout) { lock.waitLock(timeout); locked = true; },
      releaseLock() { locked = false; lock.releaseLock(); }
    };
  };
  app.SpreadsheetApp.flush = () => { assert.equal(locked, true); flushed = true; };
  cache.remove = key => {
    assert.equal(locked, true);
    assert.equal(flushed, true);
    removed = true;
    originalRemove(key);
  };
  app.updateCardById('ca', 2, { flag: '⚑' });
  assert.equal(removed, true);
  assert.equal(locked, false);
});

test('a flush failure invalidates summaries and releases the mutation lock', () => {
  const { app, cache } = setup();
  app.getDecksWithRegistry();
  app.SpreadsheetApp.flush = () => { throw new Error('flush failed'); };
  assert.throws(() => app.updateCardById('ca', 2, { flag: '⚑' }), /flush failed/);
  assert.equal(cache.get(app.deckSummaryCacheKey_(app.today_())), null);
  app.SpreadsheetApp.flush = () => {};
  assert.equal(app.getDecksWithRegistry().find(deck => deck.key === 'A').flagged, 1);
});

test('a flush failure while building a listing removes its cache entry and releases the lock', () => {
  const { app, cache } = setup();
  app.SpreadsheetApp.flush = () => { throw new Error('flush failed'); };
  assert.throws(() => app.getDecksWithRegistry(), /flush failed/);
  assert.equal(cache.get(app.deckSummaryCacheKey_(app.today_())), null);
  app.SpreadsheetApp.flush = () => {};
  assert.equal(app.getDecksWithRegistry().length, 3);
});

test('a failed deck mutation clears cached summaries after restoring the original data', () => {
  const base = loadApp();
  const { app, cards, cache } = loadApp([
    card(base.app, 'A', 'Q', 'A', '', { id: 'ca' })
  ], [normal('A', 'a')], {}, { deckOptions: { failAtRow: 2 } });
  const original = plain(app.getDecksWithRegistry());
  assert.throws(() => app.renameDeck('A', '新A'), /write failed/);
  assert.equal(cards.rows[1][app.COL.type - 1], 'A');
  assert.equal(cache.get(app.deckSummaryCacheKey_(app.today_())), null);
  assert.deepEqual(plain(app.getDecksWithRegistry()), original);
});

test('2000 consecutive missing IDs are saved in one batch and remain stable on the next read', () => {
  const base = loadApp();
  const rows = Array.from({ length: 2000 }, (_, i) => card(base.app, 'A', 'Q' + i));
  const { app, cards } = loadApp(rows);
  const original = plain(cards.rows.map(row => row.slice(1)));
  const first = Array.from(app.readCards_(cards), entry => entry.id);
  assert.equal(new Set(first).size, 2000);
  assert.ok(first.every(id => /^card-/.test(id)));
  assert.deepEqual(cards.rows.map(row => row.slice(1)), original);
  const writes = cards.operations.filter(op => op.method === 'setRichTextValues');
  assert.deepEqual(writes, [{ method: 'setRichTextValues', row: 2, column: app.COL.id, height: 2000, width: 1 }]);
  assert.ok(!cards.operations.some(op => op.method === 'getDisplayValue' || op.method === 'setRichTextValue'));
  cards.operations.length = 0;
  assert.deepEqual(Array.from(app.readCards_(cards), entry => entry.id), first);
  assert.ok(!cards.operations.some(op => op.method === 'setRichTextValues'));
});

test('batch ID assignment preserves existing numeric/text IDs and completely blank rows', () => {
  const base = loadApp();
  const { app, cards } = loadApp([
    card(base.app, 'A', 'existing', 'A', '', { id: 42 }),
    card(base.app, 'A', 'new 1'), card(base.app, 'A', 'new 2'),
    base.app.HEADERS.map(() => ''),
    card(base.app, 'A', 'existing text', 'A', '', { id: '=literal-id' }),
    card(base.app, 'A', 'new 3')
  ]);
  const result = app.readCards_(cards);
  assert.equal(result.length, 5);
  assert.equal(cards.rows[1][0], 42);
  assert.equal(cards.rows[5][0], '=literal-id');
  assert.deepEqual(cards.rows[4], Array.from(base.app.HEADERS, () => ''));
  assert.deepEqual(cards.operations.filter(op => op.method === 'setRichTextValues').map(op => [op.row, op.height]), [[3, 2], [7, 1]]);
});

test('duplicate IDs are rejected before any new IDs are written', () => {
  const base = loadApp();
  const { app, cards } = loadApp([
    card(base.app, 'A'),
    card(base.app, 'A', 'Q', 'A', '', { id: 'duplicate' }),
    card(base.app, 'A', 'Q', 'A', '', { id: 'duplicate' })
  ]);
  assert.throws(() => app.readCards_(cards), /重複/);
  assert.equal(cards.rows[1][0], '');
  assert.ok(!cards.operations.some(op => op.method === 'setRichTextValues'));
});

test('retrying a failed ID batch preserves IDs already written and never creates duplicates', () => {
  const base = loadApp();
  const { app, cards } = loadApp([
    card(base.app, 'A'),
    card(base.app, 'A', 'existing', 'A', '', { id: 'existing' }),
    card(base.app, 'A')
  ], [], {}, { failAtRow: 4 });
  assert.throws(() => app.readCards_(cards), /write failed/);
  const persisted = cards.rows.slice(1).map(row => row[0]);
  assert.ok(persisted.every(Boolean));
  const retried = Array.from(app.readCards_(cards), entry => entry.id);
  assert.deepEqual(retried, persisted);
  assert.equal(new Set(retried).size, 3);
});

test('ID assignment takes the mutation lock before reading and preserves another client ID', () => {
  const base = loadApp();
  const { app, cards } = loadApp([card(base.app, 'A')]);
  const original = app.LockService.getScriptLock;
  app.LockService.getScriptLock = () => {
    const lock = original();
    return {
      waitLock(timeout) { lock.waitLock(timeout); cards.rows[1][0] = 'other-client'; },
      releaseLock: () => lock.releaseLock()
    };
  };
  assert.equal(app.readCards_(cards)[0].id, 'other-client');
  assert.ok(!cards.operations.some(op => op.method === 'setRichTextValues'));
});

test('home UI displays the returned study count without a separate request', () => {
  const { app } = setup();
  const page = loadUI(app);
  page.chooseDeck('まとめ');
  assert.equal(page.get('today-study-count').textContent, '今日の学習 0問');
  assert.equal(page.calls.filter(call => call.method === 'getSession').length, 1);
  assert.equal(page.calls.filter(call => call.method === 'getTodayStudyCount').length, 0);
  page.ui.enqueueGrade(app.getDueCards('まとめ')[0], true, false);
  page.ui.processGradeQueue();
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
  assert.equal(page.calls.filter(call => call.method === 'getTodayStudyCount').length, 0);
});

test('the listing refresh button bypasses cache and shows directly imported cards', () => {
  const { app, cards } = setup();
  const page = loadUI(app);
  cards.rows.push(card(app, 'A', 'imported', 'A'));
  page.get('refresh-decks-btn').click();
  assert.equal(page.calls.at(-1).method, 'getDecksWithRegistry');
  assert.deepEqual(page.calls.at(-1).args, [true]);
  assert.match(page.get('deck-list').children[0].textContent, /2枚/);
  assert.match(cards.rows[3][0], /^card-/);
});
