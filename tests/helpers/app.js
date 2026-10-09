'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeSheet(initialRows, options = {}) {
  const rows = Array.from(initialRows, row => Array.from(row));
  let columns = options.columns || Math.max(1, ...rows.map(row => row.length));
  let failAtRow = options.failAtRow || 0;
  let failClearAtRow = options.failClearAtRow || 0;
  const operations = [];
  const ensureRow = index => { while (rows.length <= index) rows.push([]); return rows[index]; };
  return {
    rows,
    operations,
    getLastRow() {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].some(value => value !== '' && value !== null)) return i + 1;
      }
      return 0;
    },
    getMaxRows: () => rows.length,
    getMaxColumns: () => columns,
    insertColumnsAfter(_after, count) { columns += count; },
    insertRowAfter(row) { rows.splice(row, 0, []); },
    insertRowsAfter(row, count) { rows.splice(row, 0, ...Array.from({ length: count }, () => [])); },
    deleteRow(row) { rows.splice(row - 1, 1); },
    setFrozenRows() {},
    getRange(row, column, height = 1, width = 1) {
      const read = () => Array.from({ length: height }, (_, r) =>
        Array.from({ length: width }, (_, c) => (rows[row - 1 + r] || [])[column - 1 + c] ?? ''));
      const write = values => values.forEach((entries, r) => entries.forEach((value, c) => {
        ensureRow(row - 1 + r)[column - 1 + c] = value;
      }));
      const record = method => operations.push({ method, row, column, height, width });
      return {
        getValues() { record('getValues'); return read(); },
        getDisplayValues() { record('getDisplayValues'); return read().map(entries => entries.map(String)); },
        getDisplayValue() { record('getDisplayValue'); return String(read()[0][0]); },
        setNumberFormat() { return this; },
        setRichTextValue(value) { record('setRichTextValue'); write([[value.text]]); return this; },
        setValue(value) { write([[value]]); return this; },
        setValues(values) { write(values); return this; },
        setRichTextValues(values) {
          record('setRichTextValues');
          write(values.map(entries => entries.map(value => value.text)));
          if (failAtRow === row) { failAtRow = 0; throw new Error('write failed'); }
          return this;
        },
        clearContent() {
          write(Array.from({ length: height }, () => Array(width).fill('')));
          if (failClearAtRow === row) { failClearAtRow = 0; throw new Error('clear failed'); }
          return this;
        }
      };
    }
  };
}

function loadApp(cardEntries = [], deckEntries = [], stats = {}, options = {}) {
  const properties = { ...stats };
  const sheets = {};
  let nextId = 0;
  let locked = false;
  let cacheTime = Date.now();
  const cacheEntries = new Map();
  const cache = {
    get(key) {
      const entry = cacheEntries.get(key);
      return entry && entry.expiresAt > cacheTime ? entry.value : null;
    },
    put(key, value, seconds) { cacheEntries.set(key, { value, expiresAt: cacheTime + seconds * 1000 }); },
    remove(key) { cacheEntries.delete(key); }
  };
  const lock = {
    waitLock() { if (locked) throw new Error('nested lock'); locked = true; },
    releaseLock() { locked = false; }
  };
  const app = {
    console, Date, Math,
    Utilities: {
      formatDate: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
      getUuid: () => 'uuid-' + ++nextId
    },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: {
      flush() {},
      getActiveSpreadsheet: () => ({
        getSheetByName: name => sheets[name] || null,
        insertSheet(name) { return sheets[name] = makeSheet([[]], { columns: 1 }); },
        getUrl: () => 'https://example.com/sheet'
      }),
      newRichTextValue: () => ({
        setText(text) { this.text = text; return this; },
        build() { return { text: this.text }; }
      })
    },
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperty: key => properties[key] || null,
        setProperty(key, value) { properties[key] = value; },
        getProperties: () => ({ ...properties }),
        deleteProperty(key) { delete properties[key]; }
      })
    }
  };
  vm.createContext(app);
  for (const filename of ['Code.js', 'DailyStats.js', 'Decks.js', 'GradeSync.js', 'CardCreate.js', 'CardDelete.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', filename), 'utf8'), app, { filename });
  }
  const cards = sheets.cards = makeSheet([app.HEADERS, ...cardEntries], options);
  const decks = sheets.decks = makeSheet([options.legacySchema ? ['type', 'created'] : app.DECK_HEADERS, ...deckEntries], options.deckOptions);
  app.today_ = () => options.today || '2026-10-04';
  return { app, cards, decks, properties, cache, advanceTime(milliseconds) { cacheTime += milliseconds; } };
}

function card(app, type, front = 'Q', back = 'A', exclude = '', overrides = {}) {
  const values = { type, front_side: front, back_side: back, exclude, ...overrides };
  return Array.from(app.HEADERS, key => values[key] ?? '');
}

module.exports = { makeSheet, loadApp, card };
