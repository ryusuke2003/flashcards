'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('deck list offers per-deck rename and delete actions outside the home screen', () => {
  assert.doesNotMatch(html, /id="rename-deck-btn"|id="delete-deck-btn"/);
  assert.match(script, /renameButton\.addEventListener\('click', function \(\) \{ openRenameDeck\(deck\); \}\)/);
  assert.match(script, /deleteButton\.addEventListener\('click', function \(\) \{ openDeleteDeck\(deck\); \}\)/);
  assert.match(script, /renameButton\.appendChild\(createDeckActionIcon\(/);
  assert.match(script, /deleteButton\.appendChild\(createDeckActionIcon\(/);
  assert.match(script, /renameButton\.setAttribute\('aria-label'/);
  assert.match(script, /deleteButton\.setAttribute\('aria-label'/);
  assert.match(script, /if \(deck\.key\) \{[\s\S]*?manage\.appendChild\(deleteButton\)/);
  assert.match(html, /id="rename-deck-overlay"/);
  assert.match(html, /id="rename-deck-current"/);
  assert.match(html, /カードも新しいデッキ名に移動します/);
  assert.match(html, /id="rename-deck-name"[^>]*maxlength="80"/);
});

test('successful rename refreshes the deck list', () => {
  assert.match(script, /callServer\('renameDeck', \[oldKey, newName\]/);
  assert.match(script, /managedDeck = Object\.assign\(\{\}, deck\)/);
  assert.match(script, /managedDeck = null;[\s\S]*?loadDecks\(\);[\s\S]*?callServer\('renameDeck'/);
  assert.match(script, /\$\('rename-deck-save'\)\.addEventListener\('click', saveRenamedDeck\)/);
  assert.match(script, /hasPendingForDeck\(oldKey\)/);
});

test('Enter cannot submit either deck dialog, while IME conversion can still complete', () => {
  const source = script.match(/function preventDeckEnterSubmission\(event\) \{[\s\S]*?\n  \}/);
  assert.ok(source);
  const preventDeckEnterSubmission = vm.runInNewContext('(' + source[0] + ')');
  for (const type of ['keydown', 'keyup']) {
    assert.match(script, new RegExp("\\$\\(overlayId\\)\\.addEventListener\\('" + type + "', preventDeckEnterSubmission, true\\)"));
  }
  assert.match(script, /\['create-deck-overlay', 'rename-deck-overlay'\]\.forEach/);
  assert.match(html, /id="rename-deck-save"[^>]*type="button"/);
  assert.doesNotMatch(script, /\$\('rename-deck-name'\)\.addEventListener\('keydown'/);

  let prevented = 0;
  const preventDefault = () => { prevented++; };
  preventDeckEnterSubmission({ key: 'Enter', target: { tagName: 'INPUT' }, preventDefault });
  preventDeckEnterSubmission({ key: 'Enter', isComposing: true, target: { tagName: 'INPUT' }, preventDefault });
  assert.equal(prevented, 0);
  preventDeckEnterSubmission({ key: 'Enter', target: { tagName: 'BUTTON' }, preventDefault });
  assert.equal(prevented, 1);
  preventDeckEnterSubmission({ key: 'A', target: { tagName: 'BUTTON' }, preventDefault });
  assert.equal(prevented, 1);
});

test('deck deletion requires confirmation and returns to the refreshed deck list', () => {
  assert.match(html, /id="delete-deck-overlay"/);
  assert.match(html, /単語は削除せず「未分類」に移動/);
  assert.match(script, /callServer\('deleteDeck', \[key\]/);
  assert.match(script, /managedDeck = Object\.assign\(\{\}, deck\)/);
  assert.match(script, /callServer\('deleteDeck',[\s\S]*?loadDecks\(\);/);
});
