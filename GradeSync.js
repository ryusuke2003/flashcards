/**
 * バックグラウンド採点用の冪等ラッパー。
 *
 * クライアントは採点直後に次の問題へ進み、保存はこの関数へ非同期送信する。
 * 通信失敗後に同じ eventId を再送しても、同じ採点を二重反映しない。
 */

var GRADE_EVENT_HISTORY_KEY = 'processed_grade_events_v1';
var GRADE_EVENT_HISTORY_LIMIT = 200;

function gradeCardQueued(rowNumber, correct, eventId) {
  var id = normalizeGradeEventId_(eventId);
  if (!id) return gradeCard(rowNumber, !!correct, false);

  // 同一Googleユーザーからの同時実行を直列化し、同じ eventId の二重処理を防ぐ。
  var lock = LockService.getUserLock();
  lock.waitLock(15000);
  try {
    var history = readGradeEventHistory_();
    if (history.indexOf(id) !== -1) {
      return { ok: true, duplicate: true };
    }

    // 既存の gradeCard() がシート更新と ScriptLock を担当する。
    var result = gradeCard(rowNumber, !!correct, false);

    // 成功したイベントだけ履歴に残す。直近200件に限定して肥大化を防ぐ。
    history.push(id);
    if (history.length > GRADE_EVENT_HISTORY_LIMIT) {
      history = history.slice(history.length - GRADE_EVENT_HISTORY_LIMIT);
    }
    PropertiesService.getDocumentProperties()
      .setProperty(GRADE_EVENT_HISTORY_KEY, JSON.stringify(history));

    return result;
  } finally {
    lock.releaseLock();
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
  if (!id) return '';
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) {
    throw new Error('不正な採点イベントIDです。');
  }
  return id;
}
