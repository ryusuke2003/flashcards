'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, card } = require('./helpers/app');

const normal = (name, id) => [name, '2026-01-01', id, 'normal', '[]'];
const combined = (name, id, sources) => [name, '2026-01-01', id, 'combined', JSON.stringify(sources)];
const ids = cards => Array.from(cards, entry => entry.id).sort();
const plain = value => JSON.parse(JSON.stringify(value));

function setup() {
  const base = loadApp();
  return loadApp([
    card(base.app, 'A', 'A due', 'answer', '', { id: 'a-due', box: 1, due: '2026-10-04', wrong: 2, last_wrong: '2026-10-03', added: '2026-10-04' }),
    card(base.app, 'A', 'A fresh', 'answer', '', { id: 'a-fresh', added: '2026-10-04' }),
    card(base.app, 'B', 'B due', 'answer', '', { id: 'b-due', box: 2, due: '2026-10-01', right: 8 }),
    card(base.app, 'B', 'B future', 'answer', '', { id: 'b-future', box: 5, due: '2026-11-01', right: 12 }),
    card(base.app, 'B', 'excluded', 'answer', 'x', { id: 'excluded', box: 1, due: '' }),
    card(base.app, 'B', 'incomplete', '', '', { id: 'incomplete' }),
    card(base.app, 'C', 'C due', 'answer', '', { id: 'c-due', box: 1, due: '' }),
    card(base.app, '', 'untyped', 'answer', '', { id: 'untyped', box: 1, due: '' })
  ], [normal('A', 'a'), normal('B', 'b'), normal('C', 'c')]);
}

test('legacy registry gains stable IDs without changing card rows or creation dates', () => {
  const base = loadApp();
  const env = loadApp([card(base.app, 'A', 'Q', 'A', '', { id: 'card-a' })], [['A', '2025-01-02'], ['空', '2025-01-03']], {}, { legacySchema: true });
  const before = plain(env.cards.rows);
  const first = plain(env.app.getDecksWithRegistry());
  assert.equal(first.length, 2);
  assert.equal(first.find(deck => deck.key === '空').total, 0);
  assert.deepEqual(env.cards.rows, before);
  assert.deepEqual(env.decks.rows[0], Array.from(env.app.DECK_HEADERS));
  assert.equal(env.decks.rows[1][1], '2025-01-02');
  assert.equal(env.decks.rows[2][1], '2025-01-03');
  assert.notEqual(first[0].id, first[1].id);
  assert.ok(first.every(deck => deck.id && deck.kind === 'normal'));
  assert.deepEqual(plain(env.app.getDecksWithRegistry()), first);
});

test('creating a combined deck stores references only and every study mode uses their union', () => {
  const { app, cards, decks } = setup();
  const before = plain(cards.rows);
  const result = app.createCombinedDeck('試験対策', ['a', 'b', 'a']);
  assert.deepEqual(cards.rows, before);
  assert.equal(decks.getLastRow(), 5);
  assert.equal(result.deck.kind, 'combined');
  assert.deepEqual(plain(result.deck.sourceDeckIds), ['a', 'b']);
  assert.deepEqual(plain(result.deck.sourceKeys), ['A', 'B']);
  const session = app.getSession('試験対策');
  assert.equal(session.counts.total, 4);
  assert.equal(session.counts.due, 2);
  assert.equal(session.counts.fresh, 1);
  assert.equal(session.counts.mistakesToday, 1);
  assert.equal(session.counts.addedToday, 2);
  assert.deepEqual(ids(session.queue), ['a-due', 'a-fresh', 'b-due']);
  assert.deepEqual(ids(app.getDueCards('試験対策')), ['a-due', 'b-due']);
  assert.deepEqual(ids(app.getTodaysMistakes(50, '試験対策')), ['a-due']);
  assert.deepEqual(ids(app.getTodaysAddedCards('試験対策')), ['a-due', 'a-fresh']);
  assert.deepEqual(ids(app.getWeakCards(20, '試験対策')), ['a-due', 'b-due', 'b-future']);
  const summary = app.getDecksWithRegistry().find(deck => deck.key === '試験対策');
  assert.equal(summary.total, session.counts.total);
  assert.equal(summary.due, session.counts.due);
  assert.deepEqual(cards.rows, before);
});

test('source additions, edits, flags and deletions are shared without creating copies', () => {
  const { app, cards } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  const added = app.createCard('A', { front_side: 'new', back_side: 'answer' });
  assert.ok(app.getSession('まとめ').queue.some(entry => entry.id === added.cardId));
  app.updateCardById('a-due', 2, { back_side: 'updated', flag: app.FLAG_MARK });
  const fromCombined = app.getSession('まとめ').queue.find(entry => entry.id === 'a-due');
  assert.equal(fromCombined.back_side, 'updated');
  assert.equal(app.getSession('A').counts.flagged, 1);
  assert.equal(app.getSession('まとめ').counts.flagged, 1);
  const count = cards.getLastRow();
  app.deleteCardById('a-due', 2);
  assert.equal(cards.getLastRow(), count - 1);
  assert.ok(!app.getSession('A').queue.some(entry => entry.id === 'a-due'));
  assert.ok(!app.getSession('まとめ').queue.some(entry => entry.id === 'a-due'));
});

test('combined card creation saves to a selected source and rejects removed or unrelated sources', () => {
  const { app, cards } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b', app.UNTYPED_DECK_ID]);
  const count = cards.getLastRow();
  const result = app.createCard('まとめ', { front_side: '=Q', back_side: 'answer' }, 'b');
  assert.equal(cards.getLastRow(), count + 1);
  assert.equal(result.card.type, 'B');
  assert.equal(result.card.front_side, '=Q');
  assert.ok(app.getSession('B').queue.some(entry => entry.id === result.cardId));
  assert.throws(() => app.createCard('まとめ', { front_side: 'Q', back_side: 'A' }, 'c'), /追加先/);
  assert.throws(() => app.createCard('まとめ', { front_side: 'Q', back_side: 'A' }), /追加先/);
  app.updateCombinedDeck('まとめ', 'まとめ', ['a']);
  assert.throws(() => app.createCard('まとめ', { front_side: 'Q', back_side: 'A' }, 'b'), /追加先/);
  assert.equal(cards.getLastRow(), count + 1);
});

test('empty untyped source is selectable and can receive a card from a combined deck', () => {
  const { app, cards } = loadApp([], [normal('空', 'empty')]);
  app.createCombinedDeck('まとめ', ['empty', app.UNTYPED_DECK_ID]);
  assert.equal(app.getSession('まとめ').counts.total, 0);
  const result = app.createCard('まとめ', { front_side: 'Q', back_side: 'A' }, app.UNTYPED_DECK_ID);
  assert.equal(result.card.type, '');
  assert.equal(cards.getLastRow(), 2);
  assert.equal(app.getSession('まとめ').counts.total, 1);
});

test('source renaming preserves its ID and every combined reference', () => {
  const { app, cards } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  const result = app.renameDeck('A', 'ネットワーク');
  assert.equal(result.deck.id, 'a');
  const deck = app.getDeckSelection_('まとめ');
  assert.deepEqual(plain(deck.sourceDeckIds), ['a', 'b']);
  assert.deepEqual(plain(deck.sourceKeys), ['ネットワーク', 'B']);
  assert.equal(cards.rows[1][app.COL.type - 1], 'ネットワーク');
  assert.equal(app.getSession('まとめ').counts.total, 4);
});

test('renaming untyped updates existing references to follow the moved cards', () => {
  const { app } = setup();
  app.createCombinedDeck('まとめ', ['a', app.UNTYPED_DECK_ID]);
  const result = app.renameDeck('', '分類済み');
  const deck = app.getDeckSelection_('まとめ');
  assert.ok(deck.sourceDeckIds.includes(result.deck.id));
  assert.ok(!deck.sourceDeckIds.includes(app.UNTYPED_DECK_ID));
  assert.deepEqual(plain(deck.sourceKeys), ['A', '分類済み']);
  assert.equal(app.getSession('まとめ').counts.total, 3);
});

test('source deletion removes references while cards move to untyped without being auto-included', () => {
  const { app, cards } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  const count = cards.getLastRow();
  app.deleteDeck('A');
  assert.equal(cards.getLastRow(), count);
  assert.equal(cards.rows[1][app.COL.type - 1], '');
  assert.deepEqual(plain(app.getDeckSelection_('まとめ').sourceDeckIds), ['b']);
  assert.equal(app.getSession('まとめ').counts.total, 2);
  app.deleteDeck('B');
  const session = app.getSession('まとめ');
  assert.equal(session.counts.total, 0);
  assert.equal(session.queue.length, 0);
  assert.equal(app.getDueCards('まとめ').length, 0);
  assert.equal(app.getTodaysMistakes(50, 'まとめ').length, 0);
  assert.equal(app.getTodaysAddedCards('まとめ').length, 0);
  assert.equal(app.getWeakCards(20, 'まとめ').length, 0);
  assert.equal(app.getTodayStudyCount('まとめ').count, 0);
  assert.ok(app.getDecksWithRegistry().some(deck => deck.key === 'まとめ'));
});

test('combined rename, source editing and deletion never move or delete source cards', () => {
  const { app, cards } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  const before = plain(cards.rows);
  const oldId = app.getDeckSelection_('まとめ').id;
  app.updateCombinedDeck('まとめ', '新まとめ', ['b', 'c']);
  assert.equal(app.getDeckSelection_('新まとめ').id, oldId);
  assert.deepEqual(plain(app.getDeckSelection_('新まとめ').sourceKeys), ['B', 'C']);
  app.renameDeck('新まとめ', '別名');
  assert.equal(app.getDeckSelection_('別名').id, oldId);
  app.updateCombinedDeck('別名', '別名', []);
  assert.equal(app.getSession('別名').counts.total, 0);
  app.deleteDeck('別名');
  assert.deepEqual(cards.rows, before);
  assert.ok(!app.getDecksWithRegistry().some(deck => deck.key === '別名'));
});

test('creation rejects duplicate names, insufficient sources, unknown sources and nested combined decks', () => {
  const { app, cards } = setup();
  assert.throws(() => app.createCombinedDeck('A', ['a', 'b']), /すでにあります/);
  assert.throws(() => app.createCombinedDeck('まとめ', ['a', 'a']), /2つ以上/);
  assert.throws(() => app.createCombinedDeck('まとめ', ['a', 'unknown']), /通常デッキ/);
  assert.throws(() => app.createCombinedDeck('まとめ', null), /選択/);
  const first = app.createCombinedDeck('まとめ', ['a', 'b']);
  assert.throws(() => app.createCombinedDeck('入れ子', ['a', first.deck.id]), /通常デッキ/);
  assert.throws(() => app.updateCombinedDeck('まとめ', 'A', ['a', 'b']), /すでにあります/);
  assert.throws(() => app.updateCombinedDeck('まとめ', 'まとめ', [first.deck.id]), /通常デッキ/);
  assert.throws(() => app.createDeck('まとめ'), /すでにあります/);
  assert.equal(cards.getLastRow(), 9);
});

test('normal and combined study counts share idempotent grading of the original cards', () => {
  const { app, cards, properties } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  app.createCombinedDeck('別まとめ', ['a', 'c']);
  const events = [{ eventId: 'event-1', cardId: 'a-due', rowHint: 2, correct: true, practice: false }];
  assert.equal(app.getTodayStudyCount('まとめ').count, 0);
  assert.equal(app.gradeCardsQueued(events).completedEventIds.length, 1);
  assert.equal(cards.rows[1][app.COL.box - 1], 2);
  assert.equal(app.getSession('A').counts.due, 0);
  assert.equal(app.getSession('まとめ').counts.due, 1);
  assert.equal(app.getTodayStudyCount('A').count, 1);
  assert.equal(app.getTodayStudyCount('まとめ').count, 1);
  assert.equal(app.getTodayStudyCount('別まとめ').count, 1);
  app.gradeCardsQueued(events);
  assert.equal(app.getTodayStudyCount('まとめ').count, 1);
  app.gradeCardsQueued([{ eventId: 'event-2', cardId: 'b-due', rowHint: 4, correct: false, practice: true }]);
  assert.equal(app.getTodayStudyCount('B').count, 1);
  assert.equal(app.getTodayStudyCount('まとめ').count, 2);
  assert.equal(cards.rows[3][app.COL.box - 1], 2);
  const stats = JSON.parse(properties[app.dailyStudyDateProperty_(app.today_())]);
  assert.ok(!Object.hasOwn(stats, app.dailyStudyDeckProperty_('まとめ')));
  app.renameDeck('A', '新A');
  assert.equal(app.getTodayStudyCount('まとめ').count, 2);
});

test('duplicate references/cards are deduplicated and missing sources never select all cards', () => {
  const { app, decks } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  decks.rows[4][4] = JSON.stringify(['a', 'a', 'missing']);
  const selection = app.getDeckSelection_('まとめ');
  assert.deepEqual(plain(selection.sourceKeys), ['A']);
  const source = { id: 'same', type: 'A' };
  assert.equal(app.cardsForDeckSelection_([source, { ...source }], selection).length, 1);
  decks.rows[4][4] = JSON.stringify(['missing']);
  assert.equal(app.getSession('まとめ').counts.total, 0);
  decks.rows[4][4] = 'invalid JSON';
  assert.throws(() => app.getSession('まとめ'), /参照設定が不正/);
});

test('failure updating dependent references restores source cards, registry and study counts', () => {
  const base = loadApp();
  const env = loadApp([card(base.app, 'A', 'Q', 'A', '', { id: 'card-a' })], [
    normal('A', 'a'), normal('B', 'b'), combined('まとめ', 'combo', ['a', 'b'])
  ], { [base.app.dailyStudyDateProperty_('2026-10-04')]: JSON.stringify({ 'deck:A': 3 }) }, {
    deckOptions: { failAtRow: 4 }
  });
  const before = plain(env.decks.rows);
  assert.throws(() => env.app.deleteDeck('A'), /write failed/);
  assert.deepEqual(env.decks.rows, before);
  assert.equal(env.cards.rows[1][env.app.COL.type - 1], 'A');
  assert.equal(env.app.getTodayStudyCount('A').count, 3);
});

test('failed combined source edit restores its original name, ID and references', () => {
  const env = loadApp([], [normal('A', 'a'), normal('B', 'b'), combined('まとめ', 'combo', ['a', 'b'])], {}, {
    deckOptions: { failAtRow: 4 }
  });
  const before = plain(env.decks.rows);
  assert.throws(() => env.app.updateCombinedDeck('まとめ', 'new', []), /write failed/);
  assert.deepEqual(env.decks.rows, before);
});

test('a failed combined creation removes the attempted registry entry and keeps source cards', () => {
  const base = loadApp();
  const env = loadApp([card(base.app, 'A', 'Q', 'A', '', { id: 'card-a' })], [normal('A', 'a'), normal('B', 'b')], {}, {
    deckOptions: { failAtRow: 4 }
  });
  assert.throws(() => env.app.createCombinedDeck('まとめ', ['a', 'b']), /write failed/);
  assert.equal(env.decks.getLastRow(), 3);
  assert.equal(env.cards.getLastRow(), 2);
  assert.equal(env.app.readRegisteredDeckKeys_().length, 2);
});

test('a failure after writing study stats restores the previous stats and deck references', () => {
  const { app, decks, cards, properties } = setup();
  app.createCombinedDeck('まとめ', ['a', 'b']);
  const statsKey = app.dailyStudyDateProperty_(app.today_());
  properties[statsKey] = JSON.stringify({ 'deck:A': 3, 'deck:': 1 });
  const before = plain(decks.rows);
  const original = app.PropertiesService.getDocumentProperties;
  let fail = true;
  app.PropertiesService.getDocumentProperties = () => {
    const store = original();
    return { ...store, setProperty(key, value) {
      store.setProperty(key, value);
      if (fail && key === statsKey) { fail = false; throw new Error('stats failed'); }
    } };
  };
  assert.throws(() => app.deleteDeck('A'), /stats failed/);
  assert.deepEqual(plain(decks.rows), before);
  assert.equal(cards.rows[1][app.COL.type - 1], 'A');
  assert.deepEqual(JSON.parse(properties[statsKey]), { 'deck:A': 3, 'deck:': 1 });
});

test('deleting a source preserves the uninitialized study baseline in both source and destination', () => {
  const base = loadApp();
  const statsKey = base.app.dailyStudyDateProperty_('2026-10-04');
  for (const initial of [{ 'deck:A': 3 }, { 'deck:': 2 }]) {
    const env = loadApp([
      card(base.app, 'A', 'Q', 'A', '', { id: 'a-card', last_seen: '2026-10-04' }),
      card(base.app, '', 'Q', 'A', '', { id: 'untyped-card', last_seen: '2026-10-04' })
    ], [normal('A', 'a')], { [statsKey]: JSON.stringify(initial) });
    env.app.deleteDeck('A');
    assert.equal(env.app.getTodayStudyCount('').count, ('deck:A' in initial ? 3 : 1) + ('deck:' in initial ? 2 : 1));
    const saved = JSON.parse(env.properties[statsKey]);
    assert.ok(!Object.hasOwn(saved, 'deck:A'));
  }
});

test('deck listing reads card names after acquiring the mutation lock, without resurrecting an old deck', () => {
  const env = setup();
  const original = env.app.LockService.getScriptLock;
  let mutate = true;
  env.app.LockService.getScriptLock = () => {
    const lock = original();
    return { waitLock(timeout) {
      lock.waitLock(timeout);
      if (mutate) {
        mutate = false;
        env.decks.rows[1][0] = '新A';
        env.cards.rows.forEach((row, index) => {
          if (index && row[env.app.COL.type - 1] === 'A') row[env.app.COL.type - 1] = '新A';
        });
      }
    }, releaseLock: () => lock.releaseLock() };
  };
  const decks = env.app.getDecksWithRegistry();
  assert.ok(!decks.some(deck => deck.key === 'A'));
  assert.equal(decks.find(deck => deck.key === '新A').total, 2);
});

test('deck listing migrates missing card IDs while already holding its lock', () => {
  const base = loadApp();
  const env = loadApp([card(base.app, 'A')], [normal('A', 'a')]);
  assert.equal(env.app.getDecksWithRegistry()[0].total, 1);
  assert.match(env.cards.rows[1][env.app.COL.id - 1], /^card-/);
});
