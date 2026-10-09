'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, card } = require('./helpers/app');
const { loadUI } = require('./helpers/ui');

function setup() {
  const base = loadApp();
  const env = loadApp([
    card(base.app, 'A', 'QA', 'answer', '', { id: 'ca', box: 1, due: '2026-10-04' }),
    card(base.app, 'B', 'QB', 'answer', '', { id: 'cb' }),
    card(base.app, 'C', 'QC', 'answer', '', { id: 'cc' })
  ], [
    ['A', '', 'a', 'normal', '[]'],
    ['B', '', 'b', 'normal', '[]'],
    ['C', '', 'c', 'normal', '[]'],
    ['まとめ', '', 'combo', 'combined', '["a","b"]']
  ]);
  return env;
}

test('create UI selects only normal sources, validates the minimum and opens the combined home', () => {
  const { app, cards } = setup();
  const page = loadUI(app);
  page.get('create-deck-btn').click();
  page.get('create-deck-kind').value = 'combined';
  page.get('create-deck-kind').dispatch('change');
  assert.equal(page.get('create-deck-sources-section').classList.contains('hidden'), false);
  const options = page.get('create-deck-sources').querySelectorAll('*').filter(node => node.tagName === 'INPUT');
  assert.deepEqual(options.map(node => node.value), ['a', 'b', 'c', 'deck-untyped']);
  page.get('create-deck-name').value = '試験対策';
  page.checkSource('create-deck-sources', 'a');
  page.get('create-deck-save').click();
  assert.match(page.get('toast').textContent, /2つ以上/);
  assert.ok(!page.calls.some(call => call.method === 'createCombinedDeck'));
  page.checkSource('create-deck-sources', 'b');
  page.get('create-deck-save').click();
  assert.equal(page.ui.getState().currentDeck.kind, 'combined');
  assert.equal(page.get('selected-deck-name').textContent, '試験対策');
  assert.equal(page.get('home-sources').textContent, '参照先：A / B');
  assert.equal(page.get('home').classList.contains('hidden'), false);
  assert.equal(cards.getLastRow(), 4);
});

test('combined editor can change sources without changing its name and can become empty', () => {
  const { app } = setup();
  const page = loadUI(app);
  const deck = app.getDecksWithRegistry().find(item => item.key === 'まとめ');
  page.ui.openRenameDeck(deck);
  assert.equal(page.get('rename-deck-sources-section').classList.contains('hidden'), false);
  for (const input of page.get('rename-deck-sources').querySelectorAll('input:checked')) input.checked = false;
  page.get('rename-deck-save').click();
  assert.equal(app.getDeckSelection_('まとめ').sourceKeys.length, 0);
  page.chooseDeck('まとめ');
  assert.match(page.get('home-sources').textContent, /参照するデッキ/);
  assert.equal(page.get('add-card-btn').disabled, true);
  assert.equal(page.get('start-btn').disabled, true);
});

test('card creation in a combined deck offers source destinations and creates one source card', () => {
  const { app, cards } = setup();
  const page = loadUI(app);
  page.chooseDeck('まとめ');
  page.get('add-card-btn').click();
  assert.equal(page.get('add-source-section').classList.contains('hidden'), false);
  assert.deepEqual(page.get('add-source-deck').children.map(option => option.value), ['a', 'b']);
  page.get('add-source-deck').value = 'b';
  page.get('add-front').value = 'new Q';
  page.get('add-back').value = 'new A';
  page.get('add-save').click();
  assert.equal(cards.getLastRow(), 5);
  assert.equal(cards.rows[4][app.COL.type - 1], 'B');
  assert.equal(page.ui.getState().sessionData.counts.total, 3);
});

test('pending source grades block overlapping decks until sync and then show fresh shared counts', () => {
  const { app } = setup();
  const page = loadUI(app, { delayGrades: true, pendingGrades: [{
    eventId: 'pending-1', cardId: 'ca', rowHint: 2, correct: true,
    practice: false, deckKey: 'A', sourceDeckKey: 'A'
  }] });
  assert.equal(page.ui.hasPendingForDeck('まとめ'), true);
  assert.equal(page.ui.hasPendingForDeck('A'), true);
  assert.equal(page.ui.hasPendingForDeck('C'), false);
  page.chooseDeck('まとめ');
  assert.ok(!page.calls.some(call => call.method === 'getSession'));
  assert.equal(page.get('loading').classList.contains('hidden'), false);
  page.flushGrades();
  assert.equal(page.ui.hasPendingForDeck('まとめ'), false);
  assert.equal(page.get('home').classList.contains('hidden'), false);
  assert.equal(page.ui.getState().sessionData.counts.due, 0);
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
});

test('pending grade from a combined deck blocks its source even after selecting another deck', () => {
  const { app } = setup();
  const page = loadUI(app, { delayGrades: true, pendingGrades: [{
    eventId: 'pending-2', cardId: 'ca', rowHint: 2, correct: true,
    practice: false, deckKey: 'まとめ', sourceDeckKey: 'A'
  }] });
  page.chooseDeck('A');
  assert.equal(page.ui.getState().sessionData, null);
  page.flushGrades();
  assert.equal(page.get('selected-deck-name').textContent, 'A');
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
});

test('legacy saved events use the combined source scope for sync waits', () => {
  const { app } = setup();
  const page = loadUI(app, { delayGrades: true, pendingGrades: [{
    eventId: 'legacy', cardId: 'ca', rowHint: 2, correct: true, deckKey: 'まとめ'
  }] });
  assert.equal(page.ui.hasPendingForDeck('A'), true);
  assert.equal(page.ui.hasPendingForDeck('B'), true);
  assert.equal(page.ui.hasPendingForDeck('C'), false);
});

test('combined study shows source name and canceling shared card deletion preserves the card', () => {
  const { app, cards } = setup();
  const page = loadUI(app, { confirmResult: false });
  page.chooseDeck('まとめ');
  page.get('due-btn').click();
  assert.match(page.get('mode-label').textContent, /元デッキ：A/);
  page.get('edit-btn').click();
  page.get('edit-delete').click();
  assert.equal(page.confirms.length, 1);
  assert.match(page.confirms[0], /他のまとめデッキからも消えます/);
  assert.equal(cards.getLastRow(), 4);
  assert.equal(page.ui.getState().queue.length, 1);
});

test('deck deletion explains reference changes and combined deletion preserves original cards', () => {
  const { app, cards } = setup();
  const page = loadUI(app);
  page.ui.openDeleteDeck(app.getDeckSelection_('A'));
  assert.match(page.get('delete-deck-effect').textContent, /まとめ/);
  page.get('delete-deck-cancel').click();
  page.ui.openDeleteDeck(app.getDeckSelection_('まとめ'));
  assert.match(page.get('delete-deck-effect').textContent, /参照設定だけ/);
  page.get('delete-deck-confirm').click();
  assert.equal(cards.getLastRow(), 4);
  assert.ok(!app.getDecksWithRegistry().some(deck => deck.key === 'まとめ'));
});

test('a delayed home response cannot overwrite a newer optimistic study count', () => {
  const { app } = setup();
  const page = loadUI(app, { delaySessions: true });
  page.chooseDeck('まとめ');
  page.flushNextSession();
  page.ui.refreshHomeFromServer(false);
  page.ui.enqueueGrade(app.getDueCards('まとめ')[0], true, false);
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
  page.flushNextSession();
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
});

test('an old home study count remains stale after the newer grade has synced', () => {
  const { app } = setup();
  const page = loadUI(app, { delaySessions: true, delayGrades: true });
  page.chooseDeck('まとめ');
  page.flushNextSession();
  page.ui.refreshHomeFromServer(false);
  page.ui.enqueueGrade(app.getDueCards('まとめ')[0], true, false);
  page.ui.processGradeQueue();
  page.flushGrades();
  page.flushNextSession();
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
  page.flushNextSession();
  assert.equal(page.get('today-study-count').textContent, '今日の学習 1問');
});

test('a delayed home refresh does not interrupt an already started study session', () => {
  const { app } = setup();
  const page = loadUI(app, { delaySessions: true });
  page.chooseDeck('まとめ');
  page.flushNextSession();
  page.ui.refreshHomeFromServer(false);
  page.get('start-btn').click();
  assert.equal(page.get('session').classList.contains('hidden'), false);
  page.flushNextSession();
  assert.equal(page.get('session').classList.contains('hidden'), false);
});

test('out-of-order home responses do not restore obsolete review targets', () => {
  const { app } = setup();
  const page = loadUI(app, { delaySessions: true });
  page.chooseDeck('まとめ');
  page.flushNextSession();
  page.ui.refreshHomeFromServer(false);
  app.gradeCardsQueued([{ eventId: 'external-grade', cardId: 'ca', rowHint: 2, correct: true }]);
  page.ui.refreshHomeFromServer(false);
  page.flushLastSession();
  assert.equal(page.ui.getState().sessionData.counts.due, 0);
  page.flushNextSession();
  assert.equal(page.ui.getState().sessionData.counts.due, 0);
});
