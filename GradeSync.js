/**
 * バックグラウンド採点用の冪等・バッチ同期。
 *
 * クライアントは採点直後に次の問題へ進み、複数件の採点結果をまとめて送る。
 * cardId を正として対象カードを特定し、rowHint は一致した場合だけ高速化に使う。
 * 同じ eventId を再送しても、同じ採点や学習数を二重反映しない。
 */

var GRADE_EVENT_HISTORY_KEY = 'processed_grade_events_v1';
var GRADE_EVENT_HISTORY_LIMIT = 500;
var GRADE_BATCH_LIMIT = 10;

/**
 * 旧クライアントとの互換用。新クライアントは gradeCardsQueued() を使う。
 */
function gradeCardQueued(rowNumber, correct, eventId) {
  var result = gradeCardsQueued([{
    eventId: eventId,
    rowHint: rowNumber,
    cardId: '',
    correct: !!correct,
    practice: false
  }]);
  return {
    ok: !result.failed.length,
    duplicate: !!result.duplicateEventIds.length
  };
}

/**
 * 採点イベントを最大10件まとめて処理する。
 *
 * - cardId を正として行を特定する
 * - rowHint の id が一致すれば探索を省略する
 * - 通常学習は学習履歴を更新する
 * - practice=true はスケジュールを変えず、今日の解答数だけ +1 する
 * - 同じ行への複数イベントはメモリ上で順番に反映する
 * - F:N (学習履歴列) を1行につき1回の setValues() で書き込む
 */
function gradeCardsQueued(events) {
  if (!Array.isArray(events) || !events.length) {
    return { ok: true, completedEventIds: [], duplicateEventIds: [], failed: [] };
  }

  var normalized = events.slice(0, GRADE_BATCH_LIMIT).map(normalizeGradeEvent_);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var sheet = getSheet_();
    var history = readGradeEventHistory_();
    var historySet = Object.create(null);
    history.forEach(function (id) { historySet[id] = true; });

    var completed = [];
    var duplicates = [];
    var failed = [];
    var rowStates = Object.create(null);
    var idIndex = null;
    var today = today_();
    var studyStats = readDailyStudyStats_(today);
    var studyStatsDirty = false;

    normalized.forEach(function (event) {
      if (historySet[event.eventId]) {
        completed.push(event.eventId);
        duplicates.push(event.eventId);
        return;
      }

      try {
        var state = resolveGradeRowState_(sheet, event, rowStates, function () {
          if (idIndex === null) idIndex = buildCardIdIndex_(sheet);
          return idIndex;
        });

        if (!event.practice) {
          applyGradeToState_(state.values, event.correct, today);
          state.dirty = true;
        }

        incrementDailyStudyCount_(studyStats, sheet, today, state.values[COL.type - 1]);
        studyStatsDirty = true;

        historySet[event.eventId] = true;
        history.push(event.eventId);
        completed.push(event.eventId);
      } catch (err) {
        failed.push({
          eventId: event.eventId,
          message: err && err.message ? err.message : '採点対象のカードを特定できませんでした。'
        });
      }
    });

    Object.keys(rowStates).forEach(function (rowKey) {
      var state = rowStates[rowKey];
      if (!state.dirty) return;

      var row = Number(rowKey);
      sheet.getRange(row, COL.box, 1, COL.last_wrong - COL.box + 1).setValues([[
        state.values[COL.box - 1],
        state.values[COL.due - 1],
        state.values[COL.last_seen - 1],
        state.values[COL.right - 1],
        state.values[COL.wrong - 1],
        state.values[COL.added - 1],
        state.values[COL.flag - 1],
        state.values[COL.exclude - 1],
        state.values[COL.last_wrong - 1]
      ]]);
    });

    if (studyStatsDirty) writeDailyStudyStats_(today, studyStats, false);

    if (history.length > GRADE_EVENT_HISTORY_LIMIT) {
      history = history.slice(history.length - GRADE_EVENT_HISTORY_LIMIT);
    }
    PropertiesService.getDocumentProperties()
      .setProperty(GRADE_EVENT_HISTORY_KEY, JSON.stringify(history));

    return {
      ok: failed.length === 0,
      completedEventIds: completed,
      duplicateEventIds: duplicates,
      failed: failed
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeGradeEvent_(event) {
  event = event || {};
  return {
    eventId: normalizeGradeEventId_(event.eventId),
    cardId: normalizeCardId_(event.cardId),
    rowHint: normalizeRowHint_(event.rowHint != null ? event.rowHint : event.row),
    correct: !!event.correct,
    practice: !!event.practice
  };
}

function resolveGradeRowState_(sheet, event, rowStates, getIdIndex) {
  var lastRow = sheet.getLastRow();

  // まず rowHint を確認する。cardId が一致したときだけ採用する。
  if (event.rowHint >= 2 && event.rowHint <= lastRow) {
    var hinted = rowStates[event.rowHint];
    if (!hinted) {
      hinted = {
        values: sheet.getRange(event.rowHint, 1, 1, HEADERS.length).getValues()[0],
        dirty: false
      };
      rowStates[event.rowHint] = hinted;
    }

    var hintedId = String(hinted.values[COL.id - 1] == null ? '' : hinted.values[COL.id - 1]).trim();
    if (!event.cardId || hintedId === event.cardId) {
      if (!String(hinted.values[COL.front_side - 1] || '').trim()) {
        throw new Error('採点対象のカードが空です。');
      }
      return hinted;
    }
  }

  // 新しいイベントは cardId を正として探索する。
  if (!event.cardId) {
    throw new Error('カードIDがないため採点対象を特定できません。');
  }

  var index = getIdIndex();
  var row = index[event.cardId];
  if (!row) {
    throw new Error('カードID「' + event.cardId + '」が見つかりません。');
  }

  if (!rowStates[row]) {
    rowStates[row] = {
      values: sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0],
      dirty: false
    };
  }
  return rowStates[row];
}

function buildCardIdIndex_(sheet) {
  var lastRow = sheet.getLastRow();
  var index = Object.create(null);
  if (lastRow < 2) return index;

  var ids = sheet.getRange(2, COL.id, lastRow - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '').trim();
    if (!id) continue;
    if (Object.prototype.hasOwnProperty.call(index, id)) {
      throw new Error('カードID「' + id + '」が重複しています。');
    }
    index[id] = i + 2;
  }
  return index;
}

function applyGradeToState_(values, correct, today) {
  if (!String(values[COL.front_side - 1] || '').trim()) {
    throw new Error('この行にはカードがありません。');
  }

  var currentBox = Number(values[COL.box - 1]) || 0;
  var newBox = correct ? Math.min(MAX_BOX, currentBox > 0 ? currentBox + 1 : 2) : 1;
  var right = Number(values[COL.right - 1]) || 0;
  var wrong = Number(values[COL.wrong - 1]) || 0;

  values[COL.box - 1] = newBox;
  values[COL.due - 1] = addDays_(today, BOX_INTERVALS[newBox]);
  values[COL.last_seen - 1] = today;

  if (correct) {
    values[COL.right - 1] = right + 1;
  } else {
    values[COL.wrong - 1] = wrong + 1;
    values[COL.last_wrong - 1] = today;
  }
}

function readGradeEventHistory_() {
  var raw = PropertiesService.getDocumentProperties().getProperty(GRADE_EVENT_HISTORY_KEY);
  if (!raw) return [];

  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function normalizeGradeEventId_(value) {
  var id = value == null ? '' : String(value).trim();
  if (!id) throw new Error('採点イベントIDがありません。');
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) {
    throw new Error('不正な採点イベントIDです。');
  }
  return id;
}

function normalizeCardId_(value) {
  var id = value == null ? '' : String(value).trim();
  if (id.length > 200) throw new Error('カードIDが長すぎます。');
  return id;
}

function normalizeRowHint_(value) {
  var row = Number(value);
  if (!isFinite(row) || row < 2 || Math.floor(row) !== row) return 0;
  return row;
}
