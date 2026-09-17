'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const script = scriptMatch ? scriptMatch[1] : '';

test('deck home exposes card creation without exposing deck creation', () => {
  assert.match(html, /id="add-card-btn"[^>]*>＋ 新しいカードを追加<\/button>/);
  assert.match(html, /id="add-card-overlay"/);
  assert.match(html, /id="add-front"/);
  assert.match(html, /id="add-back"/);
  assert.match(html, /id="add-notes"/);
  assert.doesNotMatch(html, /新しいデッキを追加/);
});

test('card creation submits the currently selected deck and refreshes home', () => {
  assert.ok(script, 'inline script should exist');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'Index.html' }));
  assert.match(script, /callServer\('createCard', \[deckKey, input\]/);
  assert.match(script, /sessionData = null;[\s\S]*?refreshHomeFromServer\(false\)/);
  assert.match(script, /if \(!input\.front_side\.trim\(\) \|\| !input\.back_side\.trim\(\)\)/);
});
