'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const script = scriptMatch ? scriptMatch[1] : '';

test('deck list exposes a new-deck button and modal', () => {
  assert.match(html, /id="create-deck-btn"[^>]*>＋ 新規デッキを作成<\/button>/);
  assert.match(html, /id="create-deck-overlay"/);
  assert.match(html, /id="create-deck-name"[^>]*maxlength="80"/);
  assert.match(html, /id="create-deck-save"[^>]*>作成<\/button>/);
});

test('deck list loads registry-backed empty decks', () => {
  assert.match(script, /callServer\('getDecksWithRegistry', \[\]/);
});

test('creating a deck opens the new empty deck home', () => {
  assert.match(script, /callServer\('createDeck', \[name\]/);
  assert.match(script, /currentDeck = result\.deck;/);
  assert.match(script, /currentDeck = result\.deck;[\s\S]*?sessionData = null;[\s\S]*?loadHome\(\);/);
});

test('new deck form can be submitted with Enter', () => {
  assert.match(script, /\$\('create-deck-name'\)\.addEventListener\('keydown'/);
  assert.match(script, /event\.key !== 'Enter'/);
  assert.match(script, /saveNewDeck\(\)/);
});

test('Index.html inline script remains valid JavaScript', () => {
  assert.ok(script, 'inline script should exist');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'Index.html' }));
});
