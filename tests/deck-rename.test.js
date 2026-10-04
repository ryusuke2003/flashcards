'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { loadApp: loadFullApp, card } = require('./helpers/app');

function loadApp(cards, decks, stats, options = {}) {
  return loadFullApp(cards, decks, stats, { ...options, today: '2026-09-25' });
}

test('renaming a deck moves every matching card and its study count', () => {
  const base = loadApp([], []);
  const statsKey = base.app.dailyStudyDateProperty_('2026-09-25');
  const setup = loadApp([
    card(base.app, 'A1'),
    card(base.app, ' A1 ', 'hidden Q', 'hidden A', 'x'),
    card(base.app, 'B1'),
    card(base.app, 'A1')
  ], [['A1', '2026-01-01'], ['B1', '2026-01-02']], {
    [statsKey]: JSON.stringify({ 'deck:A1': 5, 'deck:B1': 2 })
  });

  const result = setup.app.renameDeck('A1', ' ネットワーク ');

  assert.equal(result.deck.key, 'ネットワーク');
  assert.equal(result.movedCards, 3);
  assert.deepEqual(setup.cards.rows.slice(1).map(row => row[setup.app.COL.type - 1]),
    ['ネットワーク', 'ネットワーク', 'B1', 'ネットワーク']);
  assert.deepEqual(setup.decks.rows.slice(1).map(row => row.slice(0, 2)), [['ネットワーク', '2026-01-01'], ['B1', '2026-01-02']]);
  assert.deepEqual(JSON.parse(setup.properties[statsKey]), { 'deck:B1': 2, 'deck:%E3%83%8D%E3%83%83%E3%83%88%E3%83%AF%E3%83%BC%E3%82%AF': 5 });
});

test('renaming an empty registered deck keeps it empty', () => {
  const setup = loadApp([], [['空', '2026-01-01']]);
  const result = setup.app.renameDeck('空', '新しい名前');

  assert.equal(result.movedCards, 0);
  assert.deepEqual(setup.decks.rows[1].slice(0, 2), ['新しい名前', '2026-01-01']);
});

test('renaming the untyped deck ignores blank rows and registers the new deck', () => {
  const base = loadApp([], []);
  const setup = loadApp([
    card(base.app, ''),
    base.app.HEADERS.map(() => ''),
    card(base.app, '', 'excluded Q', 'excluded A', 'x'),
    card(base.app, 'B1')
  ], [['B1', '2026-01-02']]);

  const result = setup.app.renameDeck('', '分類済み');

  assert.equal(result.movedCards, 2);
  assert.deepEqual(setup.cards.rows.slice(1).map(row => row[setup.app.COL.type - 1]),
    ['分類済み', '', '分類済み', 'B1']);
  assert.deepEqual(setup.decks.rows.slice(1).map(row => row.slice(0, 2)), [['B1', '2026-01-02'], ['分類済み', '2026-09-25']]);
});

test('existing deck names are rejected without changing cards or registry', () => {
  const base = loadApp([], []);
  const setup = loadApp([card(base.app, 'A1'), card(base.app, 'B1')], [['A1', ''], ['B1', '']]);

  assert.throws(() => setup.app.renameDeck('A1', 'B1'), /すでにあります/);
  assert.deepEqual(setup.cards.rows.slice(1).map(row => row[setup.app.COL.type - 1]), ['A1', 'B1']);
  assert.deepEqual(setup.decks.rows.slice(1).map(row => row.slice(0, 2)).map(row => row[0]), ['A1', 'B1']);
});

test('a deck name beginning with an equals sign is saved as text', () => {
  const base = loadApp([], []);
  const setup = loadApp([card(base.app, 'A1')], [['A1', '2026-01-01']]);

  const result = setup.app.renameDeck('A1', '=SUM(1,2)');

  assert.equal(result.deck.key, '=SUM(1,2)');
  assert.equal(setup.cards.rows[1][setup.app.COL.type - 1], '=SUM(1,2)');
  assert.equal(setup.decks.rows[1][0], '=SUM(1,2)');
});

test('a failed card write restores already changed card types', () => {
  const base = loadApp([], []);
  const setup = loadApp([
    card(base.app, 'A1'),
    card(base.app, 'B1'),
    card(base.app, 'A1')
  ], [['A1', '2026-01-01']], {}, { failAtRow: 4 });

  assert.throws(() => setup.app.renameDeck('A1', '新しい名前'), /write failed/);
  assert.deepEqual(setup.cards.rows.slice(1).map(row => row[setup.app.COL.type - 1]), ['A1', 'B1', 'A1']);
  assert.equal(setup.decks.rows[1][0], 'A1');
});

test('deleting a deck moves its cards to untyped without deleting their data', () => {
  const base = loadApp([], []);
  const statsKey = base.app.dailyStudyDateProperty_('2026-09-25');
  const first = card(base.app, 'A1', 'Q1', 'A1');
  first[base.app.COL.box - 1] = 3;
  const hidden = card(base.app, ' A1 ', 'Q2', 'A2', 'x');
  const other = card(base.app, 'B1', 'Q3', 'A3');
  const setup = loadApp([first, hidden, other], [['A1', '2026-01-01'], ['B1', '2026-01-02']], {
    [statsKey]: JSON.stringify({ 'deck:A1': 3, 'deck:': 2 })
  });

  const result = setup.app.deleteDeck('A1');

  assert.equal(result.movedCards, 2);
  assert.deepEqual(setup.cards.rows.slice(1).map(row => row[setup.app.COL.type - 1]), ['', '', 'B1']);
  assert.equal(setup.cards.rows[1][setup.app.COL.box - 1], 3);
  assert.equal(setup.cards.rows[2][setup.app.COL.exclude - 1], 'x');
  assert.deepEqual(setup.decks.rows.slice(1).map(row => row.slice(0, 2)), [['', ''], ['B1', '2026-01-02']]);
  assert.deepEqual(JSON.parse(setup.properties[statsKey]), { 'deck:': 5 });
});

test('deleting an empty deck removes only its registry entry', () => {
  const setup = loadApp([], [['空', '2026-01-01']]);

  const result = setup.app.deleteDeck('空');

  assert.equal(result.movedCards, 0);
  assert.deepEqual(setup.decks.rows[1].slice(0, 2), ['', '']);
});

test('the untyped deck cannot be deleted', () => {
  const base = loadApp([], []);
  const setup = loadApp([card(base.app, '')], []);

  assert.throws(() => setup.app.deleteDeck(''), /未分類デッキは削除できません/);
  assert.equal(setup.cards.rows[1][setup.app.COL.front_side - 1], 'Q');
});

test('a failed registry write restores moved cards and the registry', () => {
  const base = loadApp([], []);
  const setup = loadApp([card(base.app, 'A1')], [['A1', '2026-01-01']], {}, {
    deckOptions: { failClearAtRow: 2 }
  });

  assert.throws(() => setup.app.deleteDeck('A1'), /clear failed/);
  assert.equal(setup.cards.rows[1][setup.app.COL.type - 1], 'A1');
  assert.deepEqual(setup.decks.rows[1].slice(0, 2), ['A1', '2026-01-01']);
});
