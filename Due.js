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
