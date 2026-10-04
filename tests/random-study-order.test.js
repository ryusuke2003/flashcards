'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, card } = require('./helpers/app');

function setup() {
  const base = loadApp();
  const rows = Array.from({ length: 120 }, (_, index) => card(base.app, index % 2 ? 'B' : 'A', 'Q', 'answer', '', {
    id: 'card-' + index, box: 1, due: '2026-10-04', added: '2026-10-04',
    right: index, wrong: index >= 118 ? 100 : 0, last_wrong: '2026-10-04'
  }));
  const { app } = loadApp(rows, [
    ['A', '', 'a', 'normal', '[]'], ['B', '', 'b', 'normal', '[]'],
    ['まとめ', '', 'combined', 'combined', '["a","b"]']
  ]);
  app.Math = Object.create(Math);
  return app;
}

const modes = [
  { name: 'normal', get: (app, deck) => app.getSession(deck).queue, limit: 50, prioritized: true },
  { name: 'due', get: (app, deck) => app.getDueCards(deck), limit: 50 },
  { name: 'mistakes', get: (app, deck) => app.getTodaysMistakes(50, deck), limit: 50 },
  { name: 'added today', get: (app, deck) => app.getTodaysAddedCards(deck), limit: 50, prioritized: true },
  { name: 'weak', get: (app, deck) => app.getWeakCards(20, deck), limit: 20, prioritized: true }
];

for (const deck of ['A', 'まとめ']) {
  for (const mode of modes) {
    test(`${mode.name} randomizes extracted questions in ${deck} while preserving eligibility and limits`, () => {
      const app = setup();
      app.Math.random = () => 0;
      const first = Array.from(mode.get(app, deck));
      app.Math.random = () => 0.999;
      const second = Array.from(mode.get(app, deck));
      const firstIds = first.map(entry => entry.id);
      const secondIds = second.map(entry => entry.id);
      assert.equal(first.length, mode.limit);
      assert.equal(second.length, mode.limit);
      assert.equal(new Set(firstIds).size, mode.limit);
      assert.notDeepEqual(firstIds, secondIds);
      assert.ok(first.every(entry => deck === 'まとめ' || entry.type === deck));
      if (mode.prioritized) {
        assert.deepEqual(firstIds.slice().sort(), secondIds.slice().sort());
        if (mode.name === 'weak') {
          assert.ok(firstIds.includes('card-118'));
          assert.ok(!firstIds.includes('card-60'));
          assert.ok(first.every(entry => !Object.hasOwn(entry, '_weakScore')));
        } else {
          const eligible = Array.from({ length: 120 }, (_, i) => i).filter(i => deck === 'まとめ' || i % 2 === 0);
          assert.deepEqual(secondIds, eligible.slice(0, 50).map(i => 'card-' + i));
        }
      }
    });
  }
}
