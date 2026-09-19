'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const script = scriptMatch ? scriptMatch[1] : '';

test('Index.html inline script is valid JavaScript', () => {
  assert.ok(script, 'inline script should exist');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'Index.html' }));
});

test('study session separates previous navigation from quitting', () => {
  assert.match(html, /id="prev-btn"[^>]*>←<\/button>/);
  assert.match(html, /id="quit-btn"[^>]*>×<\/button>/);
  assert.match(script, /\$\('prev-btn'\)\.addEventListener\('click', previousCard\)/);
  assert.match(script, /\$\('quit-btn'\)\.addEventListener\('click', quitSession\)/);
});

test('previous navigation keeps completed cards out of the resumable normal queue', () => {
  assert.match(script, /function remainingUngradedQueue\(\)[\s\S]*?_gradedInSession/);
  assert.match(script, /card\._gradedInSession = true/);
  assert.match(script, /card\._scheduleAdvancedInSession = !practice/);
  assert.match(script, /if \(!card\._scheduleAdvancedInSession\)/);
});


test('deck home shows how many cards were added today', () => {
  assert.match(html, /id="added-today-count"[^>]*>0<\/div><div class="l">今日追加した問題<\/div>/);
  assert.match(script, /\$\('added-today-count'\)\.textContent = data\.counts\.addedToday \|\| 0/);
  assert.match(script, /normalizeDateText\(card\.added\) === data\.today/);
});
