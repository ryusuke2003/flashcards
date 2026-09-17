/**
 * 既存デッキに新しいカードを追加する。
 *
 * deckType は現在開いている既存デッキの key を受け取り、
 * 新しい type を勝手に作れないようサーバー側でも存在確認する。
 * 新規カードは学習履歴を空のまま保存し、未学習カードとして扱う。
 */
function createCard(deckType, input) {
  var deck = deckKey_(deckType);
  var card = normalizeNewCardInput_(input);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    var cards = [];
    var seenIds = Object.create(null);

    if (lastRow >= 2) {
      var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
      rows.forEach(function (row) {
        if (!rowHasAnyData_(row)) return;

        var id = cardIdText_(row[COL.id - 1]);
        if (id) seenIds[id] = true;

        cards.push({
          type: serializeCell_('type', row[COL.type - 1]),
          front_side: serializeCell_('front_side', row[COL.front_side - 1]),
          back_side: serializeCell_('back_side', row[COL.back_side - 1]),
          exclude: serializeCell_('exclude', row[COL.exclude - 1])
        });
      });
    }

    if (!deckExistsForCreate_(cards, deck)) {
      throw new Error('追加先のデッキが見つかりません。デッキ一覧から開き直してください。');
    }

    var id = makeStableCardId_(seenIds);
    var added = today_();
    var values = buildNewCardValues_(id, deck, card, added);
    var rowNumber = lastRow + 1;

    if (rowNumber > sheet.getMaxRows()) {
      sheet.insertRowAfter(sheet.getMaxRows());
    }

    // setValues() は先頭が = の入力を数式として解釈するため、
    // ユーザー入力を含む列は既存の plain text helper で個別に保存する。
    ['id', 'type', 'front_side', 'back_side', 'notes', 'added'].forEach(function (key) {
      setPlainTextValue_(sheet.getRange(rowNumber, COL[key]), values[COL[key] - 1]);
    });

    return {
      ok: true,
      row: rowNumber,
      cardId: id,
      card: {
        id: id,
        type: deck,
        front_side: card.front_side,
        back_side: card.back_side,
        notes: card.notes,
        box: '',
        due: '',
        last_seen: '',
        right: '',
        wrong: '',
        added: added,
        flag: '',
        exclude: '',
        last_wrong: '',
        last_wrong_reviewed: '',
        _row: rowNumber
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeNewCardInput_(input) {
  input = input || {};

  var card = {
    front_side: input.front_side == null ? '' : String(input.front_side),
    back_side: input.back_side == null ? '' : String(input.back_side),
    notes: input.notes == null ? '' : String(input.notes)
  };

  if (!card.front_side.trim() || !card.back_side.trim()) {
    throw new Error('問題と答えは空にできません。');
  }

  return card;
}

function deckExistsForCreate_(cards, deckType) {
  var key = deckKey_(deckType);
  return cards.some(function (card) {
    return isActiveCard_(card) && deckKey_(card.type) === key;
  });
}

function buildNewCardValues_(id, deckType, card, added) {
  var values = HEADERS.map(function () { return ''; });
  values[COL.id - 1] = id;
  values[COL.type - 1] = deckKey_(deckType);
  values[COL.front_side - 1] = card.front_side;
  values[COL.back_side - 1] = card.back_side;
  values[COL.notes - 1] = card.notes;
  values[COL.added - 1] = added;
  return values;
}
