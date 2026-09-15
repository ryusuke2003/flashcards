/**
 * @OnlyCurrentDoc
 */
/**
 * 単語帳 — Google Sheets をデータベースに使う日本語向けフラッシュカード。
 *
 * 1 行 = 1 カード。学習履歴もすべて `cards` シートに保存するため、
 * Mac / iPhone から同じ Web アプリを開けば同じ状態を共有できます。
 */

var APP_VERSION = '2.2.0-ja';
var SHEET_NAME = 'cards';
var UNTYPED_DECK_LABEL = '未分類';

var HEADERS = [
  'id', 'type', 'front_side', 'back_side', 'notes',
  'box', 'due', 'last_seen', 'right', 'wrong', 'added', 'flag', 'exclude', 'last_wrong', 'last_wrong_reviewed'
];

var BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
var MAX_BOX = 5;
var NEW_PER_SESSION = 10;
var SESSION_LIMIT = 50;
var PRACTICE_LIMIT = 20;
var ERROR_DRILL_LIMIT = 50;
var FLAG_MARK = '⚑';
var EXCLUDE_MARK = 'x';

var COL = {};
for (var i = 0; i < HEADERS.length; i++) COL[HEADERS[i]] = i + 1;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('単語帳')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}

// -----------------------------------------------------------------------------
// Google Sheets メニュー
// -----------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎴 単語帳')
    .addItem('アプリを開く ↗', 'menuOpenApp_')
    .addSeparator()
    .addItem('シートを診断', 'menuCheckSheet_')
    .addSeparator()
    .addItem('この単語帳について', 'menuAbout_')
    .addToUi();
}

function menuOpenApp_() {
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert(
      '🎴 単語帳',
      'まだ Web アプリとしてデプロイされていません。\n\nApps Script の「デプロイ」→「新しいデプロイ」から Web アプリとして公開してください。',
      ui.ButtonSet.OK
    );
    return;
  }

  var safeUrl = escapeHtmlAttribute_(url);
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;padding:10px">' +
      '<p style="margin:0 0 14px">単語帳を新しいタブで開きます。</p>' +
      '<a href="' + safeUrl + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;background:#4f8cff;color:#fff;text-decoration:none;' +
        'font-weight:700;padding:10px 16px;border-radius:10px">🎴 単語帳を開く ↗</a>' +
    '</div>'
  ).setWidth(320).setHeight(135);

  ui.showModalDialog(html, '🎴 単語帳');
}

function menuCheckSheet_() {
  SpreadsheetApp.getUi().alert(
    '🎴 シート診断',
    checkSheetHealth(),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function menuAbout_() {
  SpreadsheetApp.getUi().alert(
    '🎴 単語帳',
    '日本語向け Flashcards v' + APP_VERSION + '\n\n`type` 列をデッキ名として使い、`id` 列はカードの固定識別子として扱います。カードと学習履歴はこの Google スプレッドシートだけに保存します。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// -----------------------------------------------------------------------------
// 公開 API（Index.html から google.script.run で呼び出す）
// -----------------------------------------------------------------------------

/**
 * `type` 列をデッキ名として集計し、最初のデッキ選択画面に返します。
 * type が空のカードは「未分類」デッキとしてまとめます。
 */
function getDecks() {
  var cards = readCards_(getSheet_()).filter(isActiveCard_);
  var today = today_();
  var grouped = Object.create(null);

  cards.forEach(function (card) {
    var key = deckKey_(card.type);
    if (!Object.prototype.hasOwnProperty.call(grouped, key)) {
      grouped[key] = {
        key: key,
        name: key || UNTYPED_DECK_LABEL,
        total: 0,
        due: 0,
        fresh: 0,
        mistakesToday: 0,
        flagged: 0
      };
    }

    var deck = grouped[key];
    deck.total++;
    if (card.box === '') deck.fresh++;
    if (card.box !== '' && isDue_(card.due, today)) deck.due++;
    if (isPendingMistake_(card, today)) deck.mistakesToday++;
    if (card.flag === FLAG_MARK) deck.flagged++;
  });

  return Object.keys(grouped)
    .map(function (key) { return grouped[key]; })
    .sort(function (a, b) {
      if (!a.key && b.key) return 1;
      if (a.key && !b.key) return -1;
      return a.name.localeCompare(b.name, 'ja');
    });
}

function getSession(deckType) {
  var sheet = getSheet_();
  var cards = filterCardsByDeck_(readCards_(sheet).filter(isActiveCard_), deckType);
  var today = today_();

  var due = cards.filter(function (card) {
    return card.box !== '' && isDue_(card.due, today);
  });

  var fresh = cards.filter(function (card) {
    return card.box === '';
  });

  var candidates = due.concat(fresh)
    .map(function (card) {
      return {
        card: card,
        fresh: card.box === '',
        attempts: (Number(card.right) || 0) + (Number(card.wrong) || 0),
        randomOrder: Math.random()
      };
    })
    .sort(function (a, b) {
      if (a.attempts !== b.attempts) return a.attempts - b.attempts;
      return a.randomOrder - b.randomOrder;
    });

  var freshCount = 0;
  var queue = candidates.filter(function (item) {
    if (!item.fresh) return true;
    if (freshCount >= NEW_PER_SESSION) return false;
    freshCount++;
    return true;
  })
    .slice(0, SESSION_LIMIT)
    .map(function (item) { return item.card; });

  var mistakesToday = cards.filter(function (card) {
    return isPendingMistake_(card, today);
  }).length;

  var boxCounts = {};
  for (var box = 1; box <= MAX_BOX; box++) boxCounts[box] = 0;
  cards.forEach(function (card) {
    var n = Number(card.box);
    if (n >= 1 && n <= MAX_BOX) boxCounts[n]++;
  });

  var normalizedDeck = deckType == null ? null : deckKey_(deckType);
  return {
    appVersion: APP_VERSION,
    today: today,
    deck: normalizedDeck == null ? null : {
      key: normalizedDeck,
      name: normalizedDeck || UNTYPED_DECK_LABEL
    },
    queue: queue,
    counts: {
      total: cards.length,
      due: due.length,
      fresh: fresh.length,
      mistakesToday: mistakesToday,
      flagged: cards.filter(function (card) { return card.flag === FLAG_MARK; }).length,
      box: boxCounts
    },
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
  };
}

function getDueCards(deckType) {
  var today = today_();
  var cards = filterCardsByDeck_(readCards_(getSheet_()).filter(isActiveCard_), deckType)
    .filter(function (card) {
      return card.box !== '' && isDue_(card.due, today);
    });

  cards.sort(function (a, b) {
    return String(a.due || '').localeCompare(String(b.due || ''));
  });

  return cards.slice(0, SESSION_LIMIT);
}

function getTodaysMistakes(limit, deckType) {
  var max = clampLimit_(limit, ERROR_DRILL_LIMIT);
  var today = today_();
  var cards = filterCardsByDeck_(readCards_(getSheet_()).filter(isActiveCard_), deckType)
    .filter(function (card) {
      return isPendingMistake_(card, today);
    });
  shuffle_(cards);
  return cards.slice(0, max);
}

function getWeakCards(limit, deckType) {
  var max = clampLimit_(limit, PRACTICE_LIMIT);
  var cards = filterCardsByDeck_(readCards_(getSheet_()).filter(isActiveCard_), deckType)
    .filter(function (card) {
      return card.box !== '';
    });

  cards.forEach(function (card) {
    var right = Number(card.right) || 0;
    var wrong = Number(card.wrong) || 0;
    var attempts = right + wrong;
    var errorRate = attempts ? wrong / attempts : 0;
    var box = Number(card.box) || 1;
    card._weakScore = (errorRate * 100) + ((MAX_BOX - box) * 12) + Math.min(wrong, 10);
  });

  cards.sort(function (a, b) {
    return b._weakScore - a._weakScore;
  });

  return cards.slice(0, max).map(function (card) {
    delete card._weakScore;
    return card;
  });
}

/**
 * 通常学習ではスケジュールと正誤回数を更新します。
 * practice=true のときは「今日の間違い」「苦手カード」用の復習なので、
 * 学習スケジュールを変更しません。
 */
function gradeCard(rowNumber, correct, practice) {
  var row = validateRow_(rowNumber);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    if (row > sheet.getLastRow()) throw new Error('カードの行が見つかりません。アプリを再読み込みしてください。');

    var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    if (!String(values[COL.front_side - 1] || '').trim()) {
      throw new Error('この行にはカードがありません。アプリを再読み込みしてください。');
    }

    var lastWrong = normalizeDate_(values[COL.last_wrong - 1]);
    if ((practice || correct) && lastWrong) {
      sheet.getRange(row, COL.last_wrong_reviewed).setValue(lastWrong);
      values[COL.last_wrong_reviewed - 1] = lastWrong;
    }
    if (practice) return { ok: true, practice: true };

    var currentBox = Number(values[COL.box - 1]) || 0;
    var newBox = correct ? Math.min(MAX_BOX, currentBox > 0 ? currentBox + 1 : 2) : 1;
    var today = today_();
    var due = addDays_(today, BOX_INTERVALS[newBox]);
    var right = Number(values[COL.right - 1]) || 0;
    var wrong = Number(values[COL.wrong - 1]) || 0;

    sheet.getRange(row, COL.box).setValue(newBox);
    sheet.getRange(row, COL.due).setValue(due);
    sheet.getRange(row, COL.last_seen).setValue(today);

    if (correct) {
      sheet.getRange(row, COL.right).setValue(right + 1);
    } else {
      sheet.getRange(row, COL.wrong).setValue(wrong + 1);
      sheet.getRange(row, COL.last_wrong).setValue(today);
      sheet.getRange(row, COL.last_wrong_reviewed).clearContent();
    }

    return { ok: true, box: newBox, due: due };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 現行クライアント用。cardId を正として対象行を特定し、rowHint は一致した場合だけ高速化に使う。
 */
function updateCardById(cardId, rowHint, patch) {
  var id = normalizeCardLookupId_(cardId);
  patch = patch || {};

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var row = resolveCardRowById_(sheet, id, rowHint);
    applyCardPatch_(sheet, row, patch);
    return { ok: true, row: row, cardId: id };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 旧デプロイ済みクライアントとの互換用。新しいクライアントは updateCardById() を使う。
 */
function updateCard(rowNumber, patch) {
  var row = validateRow_(rowNumber);
  patch = patch || {};

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    if (row > sheet.getLastRow()) throw new Error('カードの行が見つかりません。アプリを再読み込みしてください。');
    applyCardPatch_(sheet, row, patch);
    return { ok: true, row: row };
  } finally {
    lock.releaseLock();
  }
}

function applyCardPatch_(sheet, row, patch) {
  var allowed = ['front_side', 'back_side', 'notes', 'flag', 'exclude'];

  allowed.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    var value = patch[key] == null ? '' : String(patch[key]);
    var range = sheet.getRange(row, COL[key]);
    setPlainTextValue_(range, value);
  });
}

function checkSheetHealth() {
  var sheet = getSheet_();
  var width = Math.min(sheet.getMaxColumns(), HEADERS.length);
  var got = sheet.getRange(1, 1, 1, width).getValues()[0];
  var headerProblems = [];

  for (var i = 0; i < HEADERS.length; i++) {
    var actual = i < got.length ? String(got[i] || '').trim() : '';
    if (actual !== HEADERS[i]) {
      headerProblems.push('列 ' + columnName_(i + 1) + ': 「' + (actual || '空欄') + '」→ 正しくは「' + HEADERS[i] + '」');
    }
  }

  if (headerProblems.length) {
    return '❌ cards シートの列名または順番に問題があります。\n\n' + headerProblems.join('\n');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return '✅ 列構成は正しいです。\n\nまだカードはありません。';
  }

  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var seenIds = Object.create(null);
  var problems = [];
  var totalProblems = 0;
  var maxShown = 30;

  function addProblem_(message) {
    totalProblems++;
    if (problems.length < maxShown) problems.push(message);
  }

  rows.forEach(function (row, offset) {
    if (!rowHasAnyData_(row)) return;

    var rowNumber = offset + 2;
    var id = cardIdText_(row[COL.id - 1]);
    var front = String(row[COL.front_side - 1] == null ? '' : row[COL.front_side - 1]).trim();
    var back = String(row[COL.back_side - 1] == null ? '' : row[COL.back_side - 1]).trim();
    var boxValue = row[COL.box - 1];

    if (!id) {
      addProblem_('行 ' + rowNumber + ': id が空欄です。アプリ起動時に固定IDを自動付与します。');
    } else if (Object.prototype.hasOwnProperty.call(seenIds, id)) {
      addProblem_('行 ' + rowNumber + ': id「' + id + '」が行 ' + seenIds[id] + ' と重複しています。');
    } else {
      seenIds[id] = rowNumber;
    }

    if (!front) addProblem_('行 ' + rowNumber + ': front_side が空欄です。');
    if (!back) addProblem_('行 ' + rowNumber + ': back_side が空欄です。');

    if (boxValue !== '' && boxValue !== null) {
      var box = Number(boxValue);
      if (!isFinite(box) || Math.floor(box) !== box || box < 1 || box > MAX_BOX) {
        addProblem_('行 ' + rowNumber + ': box は 1〜' + MAX_BOX + ' の整数か空欄にしてください。');
      }
    }
  });

  if (totalProblems) {
    if (totalProblems > problems.length) {
      problems.push('ほか ' + (totalProblems - problems.length) + ' 件の問題があります。');
    }
    return '❌ cards シートに ' + totalProblems + ' 件の問題があります。\n\n' + problems.join('\n');
  }

  return '✅ 問題ありません。\n\n列構成、カードIDの一意性、問題・答え、box 値を確認しました。id は固定識別子としてそのまま維持されます。';
}

// -----------------------------------------------------------------------------
// シート読み書き
// -----------------------------------------------------------------------------

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  ensureSchema_(sheet);
  return sheet;
}

function ensureSchema_(sheet) {
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }

  var row = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var completelyBlank = row.every(function (value) { return value === '' || value === null; });

  if (completelyBlank) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  var needsMistakeReviewMigration = row[COL.last_wrong_reviewed - 1] === '' || row[COL.last_wrong_reviewed - 1] === null;
  var changed = false;
  for (var i = 0; i < HEADERS.length; i++) {
    if (row[i] === '' || row[i] === null) {
      row[i] = HEADERS[i];
      changed = true;
    }
  }
  if (changed) sheet.getRange(1, 1, 1, HEADERS.length).setValues([row]);
  if (needsMistakeReviewMigration) migrateLastWrongReviewed_(sheet);
}

function migrateLastWrongReviewed_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var today = today_();
  var lastWrongValues = sheet.getRange(2, COL.last_wrong, lastRow - 1, 1).getValues();
  var reviewedValues = lastWrongValues.map(function (row) {
    var lastWrong = normalizeDate_(row[0]);
    return [lastWrong && lastWrong < today ? lastWrong : ''];
  });

  sheet.getRange(2, COL.last_wrong_reviewed, reviewedValues.length, 1).setValues(reviewedValues);
}

function readCards_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  ensureStableCardIdsInRows_(sheet, rows);

  var cards = [];

  for (var r = 0; r < rows.length; r++) {
    var values = rows[r];
    var card = { _row: r + 2 };
    var hasData = false;

    for (var c = 0; c < HEADERS.length; c++) {
      var key = HEADERS[c];
      var value = values[c];
      if (value !== '' && value !== null) hasData = true;
      card[key] = serializeCell_(key, value);
    }

    if (hasData) cards.push(card);
  }

  return cards;
}

function ensureStableCardIdsInRows_(sheet, rows) {
  var seen = Object.create(null);
  var missingOffsets = [];

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!rowHasAnyData_(row)) continue;

    var id = cardIdText_(row[COL.id - 1]);
    if (!id) {
      missingOffsets.push(r);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(seen, id)) {
      throw new Error('カードID「' + id + '」が行 ' + seen[id] + ' と行 ' + (r + 2) + ' で重複しています。シート診断で確認してください。');
    }
    seen[id] = r + 2;
  }

  if (!missingOffsets.length) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    missingOffsets.forEach(function (offset) {
      var rowNumber = offset + 2;
      var currentId = cardIdText_(sheet.getRange(rowNumber, COL.id).getDisplayValue());

      if (currentId) {
        if (Object.prototype.hasOwnProperty.call(seen, currentId)) {
          throw new Error('カードID「' + currentId + '」が重複しています。シート診断で確認してください。');
        }
        rows[offset][COL.id - 1] = currentId;
        seen[currentId] = rowNumber;
        return;
      }

      var generated = makeStableCardId_(seen);
      setPlainTextValue_(sheet.getRange(rowNumber, COL.id), generated);
      rows[offset][COL.id - 1] = generated;
      seen[generated] = rowNumber;
    });
  } finally {
    lock.releaseLock();
  }
}

function makeStableCardId_(seen) {
  var id;
  do {
    id = 'card-' + Utilities.getUuid();
  } while (Object.prototype.hasOwnProperty.call(seen, id));
  return id;
}

function resolveCardRowById_(sheet, cardId, rowHint) {
  var id = normalizeCardLookupId_(cardId);
  var lastRow = sheet.getLastRow();
  var hint = Number(rowHint);

  if (isFinite(hint) && Math.floor(hint) === hint && hint >= 2 && hint <= lastRow) {
    var hintedId = cardIdText_(sheet.getRange(hint, COL.id).getDisplayValue());
    if (hintedId === id) return hint;
  }

  if (lastRow < 2) throw new Error('カードが見つかりません。');

  var ids = sheet.getRange(2, COL.id, lastRow - 1, 1).getDisplayValues();
  var foundRow = 0;

  for (var i = 0; i < ids.length; i++) {
    if (cardIdText_(ids[i][0]) !== id) continue;
    if (foundRow) {
      throw new Error('カードID「' + id + '」が重複しています。シート診断で確認してください。');
    }
    foundRow = i + 2;
  }

  if (!foundRow) throw new Error('カードID「' + id + '」が見つかりません。アプリを再読み込みしてください。');
  return foundRow;
}

function normalizeCardLookupId_(value) {
  var id = cardIdText_(value);
  if (!id) throw new Error('カードIDがありません。アプリを再読み込みしてください。');
  if (id.length > 200) throw new Error('カードIDが長すぎます。');
  return id;
}

function cardIdText_(value) {
  return value == null ? '' : String(value).trim();
}

function rowHasAnyData_(row) {
  return row.some(function (value) { return value !== '' && value !== null; });
}

function serializeCell_(key, value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (key === 'right' || key === 'wrong' || key === 'box') {
    if (value === '' || value === null) return '';
    return Number(value) || 0;
  }
  return value == null ? '' : String(value);
}

/**
 * ユーザー編集テキストを「数式として解釈されない値」として保存します。
 * Range#setValue/setValues は先頭が `=` の文字列を数式として扱うため、
 * RichTextValue を使って必ず文字列として書き込みます。
 */
function setPlainTextValue_(range, value) {
  var text = value == null ? '' : String(value);
  range.setNumberFormat('@');

  if (!text) {
    range.clearContent();
    return;
  }

  var richText = SpreadsheetApp.newRichTextValue()
    .setText(text)
    .build();
  range.setRichTextValue(richText);
}

function isActiveCard_(card) {
  return !card.exclude && !!card.front_side && !!card.back_side;
}

function deckKey_(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * deckType が null / undefined のときだけ全件を返します。
 * 空文字列は「type が空の未分類デッキ」を意味するため、全件扱いにはしません。
 */
function filterCardsByDeck_(cards, deckType) {
  if (deckType === null || typeof deckType === 'undefined') return cards.slice();
  var key = deckKey_(deckType);
  return cards.filter(function (card) {
    return deckKey_(card.type) === key;
  });
}

// -----------------------------------------------------------------------------
// 日付・ユーティリティ
// -----------------------------------------------------------------------------

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeDate_(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var text = String(value).trim();
  var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return text;
  return match[1] + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[3]).slice(-2);
}

function addDays_(iso, days) {
  var parts = iso.split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + Number(days || 0));
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isDue_(due, today) {
  var normalized = normalizeDate_(due);
  return !normalized || normalized <= today;
}

function isPendingMistake_(card, today) {
  var lastWrong = normalizeDate_(card.last_wrong);
  if (!lastWrong || lastWrong > today) return false;

  var reviewed = normalizeDate_(card.last_wrong_reviewed);
  return !reviewed || reviewed < lastWrong;
}

function shuffle_(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function clampLimit_(value, fallback) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), fallback);
}

function validateRow_(value) {
  var row = Number(value);
  if (!isFinite(row) || row < 2 || Math.floor(row) !== row) {
    throw new Error('不正なカード行です。');
  }
  return row;
}

function columnName_(number) {
  var result = '';
  var n = number;
  while (n > 0) {
    var rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function escapeHtmlAttribute_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
