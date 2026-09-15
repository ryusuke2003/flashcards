/**
 * 日別・デッキ別の解答数を DocumentProperties に保存する。
 *
 * 1回の「正解 / 間違えた」操作を1問として数える。
 * 通常学習だけでなく、今日の間違い復習・苦手重点復習も対象。
 * 1日 = 1プロパティに分け、PropertiesService の1値サイズ上限にも余裕を持たせる。
 */
var DAILY_STUDY_STATS_PREFIX = 'daily_study_stats_v1:';
var DAILY_STUDY_STATS_RETENTION_DAYS = 90;

/**
 * ホーム画面用の公開API。
 * 導入初日にカウンタが未作成なら、既存の last_seen から
 * 「今日すでに触ったカード数」を初期値として採用する。
 */
function getTodayStudyCount(deckType) {
  var deckKey = deckKey_(deckType);
  var today = today_();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var stats = readDailyStudyStats_(today);
    var result = ensureDailyStudyCount_(stats, getSheet_(), today, deckKey);
    if (result.initialized) writeDailyStudyStats_(today, stats, true);

    return {
      date: today,
      deckKey: deckKey,
      count: result.count
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * GradeSync.js が ScriptLock 保持中に呼ぶ内部API。
 * 同じ eventId の再送は GradeSync 側で弾かれるため、ここでは単純に +1 する。
 */
function incrementDailyStudyCount_(stats, sheet, date, deckType) {
  var deckKey = deckKey_(deckType);
  ensureDailyStudyCount_(stats, sheet, date, deckKey);
  var key = dailyStudyDeckProperty_(deckKey);
  stats[key] = Math.max(0, Number(stats[key]) || 0) + 1;
  return stats[key];
}

function ensureDailyStudyCount_(stats, sheet, date, deckKey) {
  var key = dailyStudyDeckProperty_(deckKey);
  if (Object.prototype.hasOwnProperty.call(stats, key)) {
    return { count: Math.max(0, Number(stats[key]) || 0), initialized: false };
  }

  var baseline = countCardsSeenTodayInDeck_(sheet, deckKey, date);
  stats[key] = baseline;
  return { count: baseline, initialized: true };
}

function countCardsSeenTodayInDeck_(sheet, deckKey, date) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var count = 0;

  rows.forEach(function (row) {
    var front = String(row[COL.front_side - 1] == null ? '' : row[COL.front_side - 1]).trim();
    var back = String(row[COL.back_side - 1] == null ? '' : row[COL.back_side - 1]).trim();
    var excluded = String(row[COL.exclude - 1] == null ? '' : row[COL.exclude - 1]).trim();
    if (!front || !back || excluded) return;
    if (deckKey_(row[COL.type - 1]) !== deckKey) return;
    if (normalizeDate_(row[COL.last_seen - 1]) !== date) return;
    count++;
  });

  return count;
}

function readDailyStudyStats_(date) {
  var raw = PropertiesService.getDocumentProperties()
    .getProperty(dailyStudyDateProperty_(date));
  if (!raw) return {};

  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeDailyStudyStats_(date, stats, shouldPrune) {
  var properties = PropertiesService.getDocumentProperties();
  properties.setProperty(dailyStudyDateProperty_(date), JSON.stringify(stats));
  if (shouldPrune) pruneDailyStudyStats_(properties);
}

function pruneDailyStudyStats_(properties) {
  var all = properties.getProperties();
  var dates = Object.keys(all)
    .filter(function (key) { return key.indexOf(DAILY_STUDY_STATS_PREFIX) === 0; })
    .map(function (key) { return key.slice(DAILY_STUDY_STATS_PREFIX.length); })
    .filter(function (date) { return /^\d{4}-\d{2}-\d{2}$/.test(date); })
    .sort();

  if (dates.length <= DAILY_STUDY_STATS_RETENTION_DAYS) return;
  dates.slice(0, dates.length - DAILY_STUDY_STATS_RETENTION_DAYS).forEach(function (date) {
    properties.deleteProperty(dailyStudyDateProperty_(date));
  });
}

function dailyStudyDateProperty_(date) {
  return DAILY_STUDY_STATS_PREFIX + String(date || '');
}

function dailyStudyDeckProperty_(deckKey) {
  return 'deck:' + encodeURIComponent(deckKey == null ? '' : String(deckKey));
}
