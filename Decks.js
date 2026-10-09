var DECK_SHEET_NAME = 'decks';
var DECK_HEADERS = ['type', 'created', 'deck_id', 'kind', 'source_deck_ids'];
var MAX_DECK_NAME_LENGTH = 80;
var UNTYPED_DECK_ID = 'deck-untyped';

/** カードをコピーせず集計し、45秒再利用する。forceRefresh=trueならシートから再取得する。 */
function getDecksWithRegistry(forceRefresh) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var cacheHit = false;
  try {
    var today = today_();
    var cacheKey = deckSummaryCacheKey_(today);
    if (forceRefresh === true) invalidateDeckSummaries_();
    else {
      var cached = readDeckSummariesCache_(cacheKey);
      if (cached) {
        cacheHit = true;
        return cached;
      }
    }
    var cards = readCards_(getSheet_(), true);
    prepareDeckRegistry_(cards.map(function (card) { return deckKey_(card.type); }));
    var records = readDeckRecords_();
    var active = cards.filter(isActiveCard_);
    var selections = records.map(function (record) { return deckSelection_(record.key, records); });
    if (active.some(function (card) { return !deckKey_(card.type); })) {
      selections.push(deckSelection_('', records));
    }
    var summaries = selections.map(function (deck) {
      var selected = cardsForDeckSelection_(active, deck);
      return Object.assign({}, deck, {
        total: selected.length,
        due: selected.filter(function (card) { return card.box !== '' && isDue_(card.due, today); }).length,
        fresh: selected.filter(function (card) { return card.box === ''; }).length,
        mistakesToday: selected.filter(function (card) { return isPendingMistake_(card, today); }).length,
        flagged: selected.filter(function (card) { return card.flag === FLAG_MARK; }).length
      });
    }).sort(compareDeckNames_);
    writeDeckSummariesCache_(cacheKey, summaries);
    return summaries;
  } finally {
    // キャッシュ再利用時にはシートへアクセスしない。初回のID・デッキ登録は確定してから解放する。
    if (cacheHit) lock.releaseLock();
    else releaseSheetLock_(lock, false);
  }
}

function createDeck(name) {
  return createDeckRecord_(name, 'normal', []);
}

function createCombinedDeck(name, sourceDeckIds) {
  return createDeckRecord_(name, 'combined', sourceDeckIds);
}

function createDeckRecord_(name, kind, sourceDeckIds) {
  var key = normalizeNewDeckName_(name);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    prepareDeckRegistryFromCards_();
    var records = readDeckRecords_();
    assertDeckNameAvailable_(key, records);
    var ids = kind === 'combined' ? validateSourceDeckIds_(sourceDeckIds, records, 2) : [];
    var sheet = getDeckSheet_();
    var row = Math.max(2, sheet.getLastRow() + 1);
    var record = [key, today_(), 'deck-' + Utilities.getUuid(), kind, JSON.stringify(ids)];
    applyDeckChanges_(getSheet_(), [], sheet, [{ row: row, values: record }]);
    return { ok: true, deck: deckSelection_(key, readDeckRecords_()) };
  } finally {
    releaseSheetLock_(lock, true);
  }
}

/** 名前・参照先を同時に保存する。編集時は参照先が0個でも空デッキとして残せる。 */
function updateCombinedDeck(oldName, newName, sourceDeckIds) {
  var key = deckKey_(oldName);
  var newKey = normalizeNewDeckName_(newName);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    prepareDeckRegistryFromCards_();
    var records = readDeckRecords_();
    var record = records.filter(function (item) { return item.key === key; })[0];
    if (!record || record.kind !== 'combined') throw new Error('まとめデッキが見つかりません。');
    assertDeckNameAvailable_(newKey, records, record.id);
    var ids = validateSourceDeckIds_(sourceDeckIds, records, 0);
    var values = [newKey, record.created, record.id, 'combined', JSON.stringify(ids)];
    applyDeckChanges_(getSheet_(), [], getDeckSheet_(), [{ row: record.row, values: values }]);
    return { ok: true, deck: deckSelection_(newKey, readDeckRecords_()), movedCards: 0 };
  } finally {
    releaseSheetLock_(lock, true);
  }
}

/** 通常デッキの所属名を変更する。まとめデッキは参照元のカードを移動しない。 */
function renameDeck(oldName, newName) {
  var oldKey = deckKey_(oldName);
  var newKey = normalizeNewDeckName_(newName);
  if (oldKey === newKey) throw new Error('現在と同じデッキ名です。');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    prepareDeckRegistryFromCards_();
    var records = readDeckRecords_();
    var record = records.filter(function (item) { return item.key === oldKey; })[0];
    var cardsSheet = getSheet_();
    var cardsToMove = !record || record.kind === 'normal' ? deckCardRows_(cardsSheet, oldKey, newKey) : [];
    if (!record && !cardsToMove.length) throw new Error('変更元のデッキが見つかりません。');
    assertDeckNameAvailable_(newKey, records);
    var sheet = getDeckSheet_();
    var row = record ? record.row : Math.max(2, sheet.getLastRow() + 1);
    var id = record ? record.id : 'deck-' + Utilities.getUuid();
    var changes = [{ row: row, values: [newKey, record ? record.created : today_(), id,
      record ? record.kind : 'normal', JSON.stringify(record ? record.sourceIds : [])] }];
    // 未分類のカードを名前付きデッキへ移した場合も、既存の参照は移動先へ引き継ぐ。
    if (!oldKey) {
      records.forEach(function (item) {
        if (item.kind === 'combined' && item.sourceIds.indexOf(UNTYPED_DECK_ID) !== -1) {
          changes.push({ row: item.row, values: [item.key, item.created, item.id, item.kind,
            JSON.stringify(item.sourceIds.map(function (sourceId) { return sourceId === UNTYPED_DECK_ID ? id : sourceId; }))] });
        }
      });
    }
    var saveStudyCounts = !record || record.kind === 'normal' ? prepareDailyStudyDeckMove_(oldKey, newKey) : null;
    applyDeckChanges_(cardsSheet, cardsToMove, sheet, changes, saveStudyCounts);
    return { ok: true, deck: deckSelection_(newKey, readDeckRecords_()), movedCards: cardsToMove.length };
  } finally {
    releaseSheetLock_(lock, true);
  }
}

/** 通常デッキはカードを未分類へ移し、まとめデッキは設定だけを削除する。 */
function deleteDeck(name) {
  var key = deckKey_(name);
  if (!key) throw new Error('未分類デッキは削除できません。');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    prepareDeckRegistryFromCards_();
    var records = readDeckRecords_();
    var record = records.filter(function (item) { return item.key === key; })[0];
    if (!record) throw new Error('削除するデッキが見つかりません。');
    var cardsSheet = getSheet_();
    var moves = record.kind === 'normal' ? deckCardRows_(cardsSheet, key, '') : [];
    var changes = [{ row: record.row, values: DECK_HEADERS.map(function () { return ''; }) }];
    records.forEach(function (item) {
      if (item.kind === 'combined' && item.sourceIds.indexOf(record.id) !== -1) {
        changes.push({ row: item.row, values: [item.key, item.created, item.id, item.kind,
          JSON.stringify(item.sourceIds.filter(function (id) { return id !== record.id; }))] });
      }
    });
    var saveStudyCounts = record.kind === 'normal' ? prepareDailyStudyDeckMove_(key, '') : null;
    applyDeckChanges_(cardsSheet, moves, getDeckSheet_(), changes, saveStudyCounts);
    return { ok: true, movedCards: moves.length, kind: record.kind };
  } finally {
    releaseSheetLock_(lock, true);
  }
}

function deckCardRows_(sheet, oldKey, newKey) {
  var lastRow = sheet.getLastRow();
  var rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var result = [];
  rows.forEach(function (row, index) {
    if (rowHasAnyData_(row) && deckKey_(row[COL.type - 1]) === oldKey) {
      result.push({ row: index + 2, original: row[COL.type - 1], value: newKey });
    }
  });
  return result;
}

/** 書き込み失敗時にはカードの所属と参照設定を一緒に復元する。呼び出し元がScriptLockを保持する。 */
function applyDeckChanges_(cardsSheet, cardEntries, deckSheet, changes, afterWrite) {
  var attemptedCards = [];
  var attemptedDecks = [];
  var statsKey = dailyStudyDateProperty_(today_());
  var properties = afterWrite ? PropertiesService.getDocumentProperties() : null;
  var originalStats = properties ? properties.getProperty(statsKey) : null;
  var attemptedStats = false;
  try {
    groupConsecutiveDeckRows_(cardEntries).forEach(function (group) {
      attemptedCards = attemptedCards.concat(group);
      var range = cardsSheet.getRange(group[0].row, COL.type, group.length, 1);
      if (!group[0].value) {
        range.clearContent();
      } else {
        range.setNumberFormat('@');
        range.setRichTextValues(group.map(function (entry) {
          return [SpreadsheetApp.newRichTextValue().setText(entry.value).build()];
        }));
      }
    });
    changes.forEach(function (change) {
      if (change.row > deckSheet.getMaxRows()) deckSheet.insertRowsAfter(deckSheet.getMaxRows(), change.row - deckSheet.getMaxRows());
      var original = deckSheet.getRange(change.row, 1, 1, DECK_HEADERS.length).getValues()[0];
      attemptedDecks.push({ row: change.row, values: original });
      writeDeckRow_(deckSheet, change.row, change.values);
    });
    if (afterWrite) {
      attemptedStats = true;
      afterWrite();
    }
  } catch (err) {
    try {
      attemptedDecks.reverse().forEach(function (entry) { writeDeckRow_(deckSheet, entry.row, entry.values); });
      attemptedCards.forEach(function (entry) { setPlainTextValue_(cardsSheet.getRange(entry.row, COL.type), entry.original); });
      if (attemptedStats) {
        if (originalStats == null) properties.deleteProperty(statsKey);
        else properties.setProperty(statsKey, originalStats);
      }
    } catch (rollbackErr) {
      throw new Error('デッキの変更を元に戻せませんでした。cards と decks シートを確認してください。');
    }
    throw err;
  }
}

function writeDeckRow_(sheet, row, values) {
  if (values.every(function (value) { return value === '' || value == null; })) {
    sheet.getRange(row, 1, 1, DECK_HEADERS.length).clearContent();
    return;
  }
  var range = sheet.getRange(row, 1, 1, DECK_HEADERS.length);
  range.setNumberFormat('@');
  range.setRichTextValues([values.map(function (value) {
    return SpreadsheetApp.newRichTextValue().setText(value instanceof Date ? normalizeDate_(value) : String(value == null ? '' : value)).build();
  })]);
  if (values[1] instanceof Date) sheet.getRange(row, 2).setValue(values[1]);
}

function groupConsecutiveDeckRows_(entries) {
  var groups = [];
  (entries || []).forEach(function (entry) {
    var group = groups[groups.length - 1];
    if (group && group[group.length - 1].row + 1 === entry.row) group.push(entry);
    else groups.push([entry]);
  });
  return groups;
}

function normalizeNewDeckName_(value) {
  var deck = deckKey_(value);
  if (!deck) throw new Error('デッキ名を入力してください。');
  if (deck === UNTYPED_DECK_LABEL) throw new Error('「' + UNTYPED_DECK_LABEL + '」は未分類カード用の名前なので使用できません。');
  if (/\r|\n/.test(deck)) throw new Error('デッキ名は1行で入力してください。');
  if (deck.length > MAX_DECK_NAME_LENGTH) throw new Error('デッキ名は' + MAX_DECK_NAME_LENGTH + '文字以内にしてください。');
  return deck;
}

function assertDeckNameAvailable_(key, records, exceptId) {
  if (records.some(function (record) { return record.key === key && record.id !== exceptId; })) {
    throw new Error('同じ名前のデッキがすでにあります。');
  }
}

function getDeckSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DECK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DECK_SHEET_NAME);
    sheet.getRange(1, 1, 1, DECK_HEADERS.length).setValues([DECK_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    ensureDeckSchema_(sheet);
  }
  return sheet;
}

/** 旧A:B列を保持したままC:E列だけ拡張する。 */
function ensureDeckSchema_(sheet) {
  if (sheet.getMaxColumns() < DECK_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), DECK_HEADERS.length - sheet.getMaxColumns());
  var header = sheet.getRange(1, 1, 1, DECK_HEADERS.length).getValues()[0];
  for (var i = 0; i < DECK_HEADERS.length; i++) {
    var actual = String(header[i] == null ? '' : header[i]).trim();
    if (actual && actual !== DECK_HEADERS[i]) throw new Error('decks シートの列構成が不正です。列名を確認してください。');
  }
  if (header.some(function (value, index) { return value !== DECK_HEADERS[index]; })) {
    sheet.getRange(1, 1, 1, DECK_HEADERS.length).setValues([DECK_HEADERS]);
  }
}

/** 呼び出し元のScriptLock内で、既存デッキの固定IDを一度だけ付与する。 */
function prepareDeckRegistry_(keys) {
  var sheet = getDeckSheet_();
  var records = readDeckRecords_();
  records.forEach(function (record) {
    if (!record.id || !record.rawKind) {
      writeDeckRow_(sheet, record.row, [record.key, record.created, record.id || 'deck-' + Utilities.getUuid(), record.kind, JSON.stringify(record.sourceIds)]);
    }
  });
  var existing = Object.create(null);
  records.forEach(function (record) { existing[record.key] = record.kind; });
  (keys || []).forEach(function (key) {
    key = deckKey_(key);
    if (!key) return;
    if (existing[key] === 'combined') throw new Error('まとめデッキ「' + key + '」に直接所属するカードがあります。通常デッキへ移してください。');
    if (existing[key]) return;
    var row = Math.max(2, sheet.getLastRow() + 1);
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
    writeDeckRow_(sheet, row, [key, today_(), 'deck-' + Utilities.getUuid(), 'normal', '[]']);
    existing[key] = 'normal';
  });
}

function prepareDeckRegistryFromCards_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  prepareDeckRegistry_(rows.filter(rowHasAnyData_).map(function (row) { return row[COL.type - 1]; }));
}

function readDeckRecords_() {
  var sheet = getDeckSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var names = Object.create(null);
  var ids = Object.create(null);
  return sheet.getRange(2, 1, lastRow - 1, DECK_HEADERS.length).getValues()
    .map(function (row, index) {
      var key = deckKey_(row[0]);
      if (!key) return null;
      var id = String(row[2] || '').trim();
      var kind = String(row[3] || 'normal');
      if (names[key] || (id && (ids[id] || id === UNTYPED_DECK_ID))) throw new Error('decks シートのデッキ名またはIDが重複しています。');
      if (kind !== 'normal' && kind !== 'combined') throw new Error('デッキの種類が不正です。');
      names[key] = true;
      if (id) ids[id] = true;
      var sourceIds;
      try {
        sourceIds = row[4] ? JSON.parse(String(row[4])) : [];
        if (!Array.isArray(sourceIds) || sourceIds.some(function (source) { return typeof source !== 'string'; })) throw new Error();
      } catch (err) {
        throw new Error('まとめデッキの参照設定が不正です。');
      }
      return { key: key, created: row[1], id: id, kind: kind, rawKind: row[3], sourceIds: sourceIds, row: index + 2 };
    }).filter(function (record) { return !!record; });
}

function validateSourceDeckIds_(values, records, minimum) {
  if (!Array.isArray(values) || values.some(function (id) { return typeof id !== 'string'; })) throw new Error('参照するデッキを選択してください。');
  var ids = values.filter(function (id, index) { return values.indexOf(id) === index; });
  if (ids.length < minimum) throw new Error('通常デッキを2つ以上選択してください。');
  ids.forEach(function (id) {
    if (id === UNTYPED_DECK_ID) return;
    if (!records.some(function (record) { return record.id === id && record.kind === 'normal'; })) {
      throw new Error('参照先には既存の通常デッキだけを選択できます。デッキ一覧を更新してください。');
    }
  });
  return ids;
}

function deckSelection_(deckType, records) {
  var key = deckKey_(deckType);
  var record = records.filter(function (item) { return item.key === key; })[0];
  var kind = record ? record.kind : 'normal';
  var sourceIds = kind === 'combined' ? record.sourceIds.filter(function (id, index, all) { return all.indexOf(id) === index; }) : [];
  var sources = sourceIds.map(function (id) {
    if (id === UNTYPED_DECK_ID) return { id: id, key: '', name: UNTYPED_DECK_LABEL };
    var source = records.filter(function (item) { return item.id === id; })[0];
    if (source && source.kind !== 'normal') throw new Error('まとめデッキを参照先に指定できません。');
    return source ? { id: source.id, key: source.key, name: source.key } : null;
  }).filter(function (source) { return !!source; });
  return {
    key: key, name: key || UNTYPED_DECK_LABEL,
    id: record ? record.id : (!key ? UNTYPED_DECK_ID : ''), kind: kind,
    sourceDeckIds: sourceIds, sources: sources,
    sourceKeys: kind === 'combined' ? sources.map(function (source) { return source.key; }) : [key]
  };
}

function getDeckSelection_(deckType) {
  return deckSelection_(deckType, readDeckRecords_());
}

function cardsForDeckSelection_(cards, deck) {
  var seen = Object.create(null);
  return cards.filter(function (card) {
    if (deck.sourceKeys.indexOf(deckKey_(card.type)) === -1) return false;
    var id = cardIdText_(card.id);
    if (id && seen[id]) return false;
    if (id) seen[id] = true;
    return true;
  });
}

function readRegisteredDeckKeys_() {
  return readDeckRecords_().map(function (record) { return record.key; });
}

function registeredDeckExists_(deckType) {
  return readRegisteredDeckKeys_().indexOf(deckKey_(deckType)) !== -1;
}

function compareDeckNames_(a, b) {
  if (!a.key && b.key) return 1;
  if (a.key && !b.key) return -1;
  return a.name.localeCompare(b.name, 'ja');
}

function mergeDeckSummariesWithRegistry_(decks, registeredKeys) {
  var grouped = Object.create(null);
  (decks || []).forEach(function (deck) { grouped[deckKey_(deck.key)] = deck; });
  (registeredKeys || []).forEach(function (key) {
    key = deckKey_(key);
    if (key && !grouped[key]) grouped[key] = emptyDeckSummary_(key);
  });
  return Object.keys(grouped).map(function (key) { return grouped[key]; }).sort(compareDeckNames_);
}

function emptyDeckSummary_(deckType) {
  var key = deckKey_(deckType);
  return { key: key, name: key || UNTYPED_DECK_LABEL, total: 0, due: 0, fresh: 0, mistakesToday: 0, flagged: 0 };
}
