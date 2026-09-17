var DECK_SHEET_NAME = 'decks';
var DECK_HEADERS = ['type', 'created'];
var MAX_DECK_NAME_LENGTH = 80;

/**
 * 現行クライアント用のデッキ一覧。
 *
 * 既存の cards.type から作られるデッキを decks シートへ自動登録し、
 * cards が 0 枚の明示的な空デッキも一覧へ含める。
 */
function getDecksWithRegistry() {
  var decks = getDecks();
  var cardDeckKeys = decks
    .map(function (deck) { return deckKey_(deck.key); })
    .filter(function (key) { return !!key; });

  ensureDeckRegistryIncludesKeys_(cardDeckKeys);
  return mergeDeckSummariesWithRegistry_(decks, readRegisteredDeckKeys_());
}

/**
 * 空の状態から新しいデッキを作成する。
 * カード行は作らず、decks シートへデッキ名だけを登録する。
 */
function createDeck(name) {
  var deck = normalizeNewDeckName_(name);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var registered = readRegisteredDeckKeys_();
    if (registered.indexOf(deck) !== -1 || cardSheetContainsDeck_(deck)) {
      throw new Error('同じ名前のデッキがすでにあります。');
    }

    var sheet = getDeckSheet_();
    var row = Math.max(2, sheet.getLastRow() + 1);
    if (row > sheet.getMaxRows()) sheet.insertRowAfter(sheet.getMaxRows());

    setPlainTextValue_(sheet.getRange(row, 1), deck);
    setPlainTextValue_(sheet.getRange(row, 2), today_());

    return {
      ok: true,
      deck: emptyDeckSummary_(deck)
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeNewDeckName_(value) {
  var deck = deckKey_(value);
  if (!deck) throw new Error('デッキ名を入力してください。');
  if (deck === UNTYPED_DECK_LABEL) {
    throw new Error('「' + UNTYPED_DECK_LABEL + '」は未分類カード用の名前なので使用できません。');
  }
  if (/\r|\n/.test(deck)) throw new Error('デッキ名は1行で入力してください。');
  if (deck.length > MAX_DECK_NAME_LENGTH) {
    throw new Error('デッキ名は' + MAX_DECK_NAME_LENGTH + '文字以内にしてください。');
  }
  return deck;
}

function getDeckSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DECK_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(DECK_SHEET_NAME);
    sheet.getRange(1, 1, 1, DECK_HEADERS.length).setValues([DECK_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  ensureDeckSchema_(sheet);
  return sheet;
}

function ensureDeckSchema_(sheet) {
  if (sheet.getMaxColumns() < DECK_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), DECK_HEADERS.length - sheet.getMaxColumns());
  }

  var header = sheet.getRange(1, 1, 1, DECK_HEADERS.length).getValues()[0];
  var blank = header.every(function (value) { return value === '' || value === null; });
  if (blank) {
    sheet.getRange(1, 1, 1, DECK_HEADERS.length).setValues([DECK_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  for (var i = 0; i < DECK_HEADERS.length; i++) {
    var actual = String(header[i] == null ? '' : header[i]).trim();
    if (actual !== DECK_HEADERS[i]) {
      throw new Error('decks シートの列構成が不正です。A1:B1 を type, created にしてください。');
    }
  }
}

function readRegisteredDeckKeys_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DECK_SHEET_NAME);
  if (!sheet) return [];

  ensureDeckSchema_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var seen = Object.create(null);
  var keys = [];

  values.forEach(function (row) {
    var key = deckKey_(row[0]);
    if (!key || Object.prototype.hasOwnProperty.call(seen, key)) return;
    seen[key] = true;
    keys.push(key);
  });

  return keys;
}

function registeredDeckExists_(deckType) {
  var key = deckKey_(deckType);
  if (!key) return false;
  return readRegisteredDeckKeys_().indexOf(key) !== -1;
}

function ensureDeckRegistryIncludesKeys_(keys) {
  var normalized = [];
  var wanted = Object.create(null);

  (keys || []).forEach(function (value) {
    var key = deckKey_(value);
    if (!key || Object.prototype.hasOwnProperty.call(wanted, key)) return;
    wanted[key] = true;
    normalized.push(key);
  });
  if (!normalized.length) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var existing = Object.create(null);
    readRegisteredDeckKeys_().forEach(function (key) { existing[key] = true; });
    var missing = normalized.filter(function (key) {
      return !Object.prototype.hasOwnProperty.call(existing, key);
    });
    if (!missing.length) return;

    var sheet = getDeckSheet_();
    var startRow = Math.max(2, sheet.getLastRow() + 1);
    var requiredLastRow = startRow + missing.length - 1;
    if (requiredLastRow > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
    }

    missing.forEach(function (key, index) {
      setPlainTextValue_(sheet.getRange(startRow + index, 1), key);
      setPlainTextValue_(sheet.getRange(startRow + index, 2), today_());
    });
  } finally {
    lock.releaseLock();
  }
}

function cardSheetContainsDeck_(deckType) {
  var key = deckKey_(deckType);
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var values = sheet.getRange(2, COL.type, lastRow - 1, 1).getDisplayValues();
  return values.some(function (row) {
    return deckKey_(row[0]) === key;
  });
}

function mergeDeckSummariesWithRegistry_(decks, registeredKeys) {
  var grouped = Object.create(null);

  (decks || []).forEach(function (deck) {
    var key = deckKey_(deck && deck.key);
    grouped[key] = deck;
  });

  (registeredKeys || []).forEach(function (value) {
    var key = deckKey_(value);
    if (!key || Object.prototype.hasOwnProperty.call(grouped, key)) return;
    grouped[key] = emptyDeckSummary_(key);
  });

  return Object.keys(grouped)
    .map(function (key) { return grouped[key]; })
    .sort(function (a, b) {
      if (!a.key && b.key) return 1;
      if (a.key && !b.key) return -1;
      return a.name.localeCompare(b.name, 'ja');
    });
}

function emptyDeckSummary_(deckType) {
  var key = deckKey_(deckType);
  return {
    key: key,
    name: key || UNTYPED_DECK_LABEL,
    total: 0,
    due: 0,
    fresh: 0,
    mistakesToday: 0,
    flagged: 0
  };
}
