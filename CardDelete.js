/**
 * カードを Google Sheets の行ごと完全に削除する。
 *
 * cardId を正として対象行を特定し、rowHint は一致した場合だけ高速化に使う。
 * 行の中身を空にするのではなく deleteRow() を使うため、削除後に空行は残らない。
 */
function deleteCardById(cardId, rowHint) {
  var id = normalizeCardLookupId_(cardId);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var row = resolveCardRowById_(sheet, id, rowHint);
    sheet.deleteRow(row);
    return { ok: true, deletedRow: row, cardId: id };
  } finally {
    lock.releaseLock();
  }
}
