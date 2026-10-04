'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const source = html.slice(
  html.indexOf('  function appendPowerText('),
  html.indexOf('  function renderCard()')
);

function makeElement(tagName) {
  let children = [];
  let value = '';
  return {
    tagName,
    dataset: {},
    get children() { return children; },
    appendChild(child) { children.push(child); },
    get textContent() {
      return children.length ? children.map(child => child.textContent).join('') : value;
    },
    set textContent(text) {
      children = [];
      value = String(text);
    }
  };
}

const context = {
  document: {
    createElement: makeElement,
    createTextNode: text => ({ tagName: '#text', textContent: text })
  }
};
vm.runInNewContext(source, context);

test('renders the IPv6 example with a superscript', () => {
  const element = makeElement('div');
  context.renderCardText(element, 'IPv6はIPv4の \\(2^{96}\\) 倍');

  assert.equal(element.textContent, 'IPv6はIPv4の 296 倍');
  assert.deepEqual(element.children.filter(child => child.tagName === 'sup').map(child => child.textContent), ['96']);
});

test('supports bare powers and keeps plain text safe and unchanged', () => {
  const element = makeElement('div');
  context.renderCardText(element, '<img src=x> 10^{-3} と x^2 と A^B');

  assert.equal(element.textContent, '<img src=x> 10-3 と x2 と AB');
  assert.deepEqual(element.children.filter(child => child.tagName === 'sup').map(child => child.textContent), ['-3', '2', 'B']);
  assert.ok(element.children.every(child => child.tagName === '#text' || child.tagName === 'sup'));
});

test('leaves other inline math and malformed powers literal', () => {
  const element = makeElement('div');
  const input = '式 \\(a+b\\) と \\(2^{96\\)';
  context.renderCardText(element, input);

  assert.equal(element.textContent, input);
  assert.equal(element.children.filter(child => child.tagName === 'sup').length, 0);
});

test('renders a fenced SQL query inside the question without changing its code', () => {
  const element = makeElement('div');
  const sql = 'SELECT 従業員コード\nFROM 従業員 X\nWHERE NOT EXISTS (\n    SELECT *\n    FROM 従業員 Y\n    WHERE X.従業員コード = Y.上司\n);';
  context.renderQuestionText(element, '次の相関副問合せは何を求める？\n```sql\n' + sql + '\n```');

  assert.equal(element.children.length, 2);
  assert.equal(element.children[0].textContent, '次の相関副問合せは何を求める？\n');
  assert.equal(element.children[1].tagName, 'pre');
  assert.equal(element.children[1].className, 'code-block');
  assert.equal(element.children[1].dataset.language, 'sql');
  assert.equal(element.children[1].children[0].tagName, 'code');
  assert.equal(element.children[1].children[0].textContent, sql);
});

test('code fences keep HTML and powers literal, while ordinary question text still renders powers', () => {
  const element = makeElement('div');
  context.renderQuestionText(element, '2^{96}\n```sql\nSELECT <tag>, x^2\n```');

  assert.equal(element.children[0].children.find(child => child.tagName === 'sup').textContent, '96');
  assert.equal(element.children[1].children[0].textContent, 'SELECT <tag>, x^2');

  const unclosed = makeElement('div');
  const input = '問題\n```sql\nSELECT *';
  context.renderQuestionText(unclosed, input);
  assert.equal(unclosed.textContent, input);
  assert.equal(unclosed.children.filter(child => child.tagName === 'pre').length, 0);
});

test('question editor previews fenced SQL and hides the preview for plain text', () => {
  const previewText = makeElement('div');
  const preview = { hidden: true, classList: { toggle(name, hidden) {
    assert.equal(name, 'hidden');
    preview.hidden = hidden;
  } } };
  const field = { value: '問題\n```sql\nSELECT * FROM 従業員\n```' };
  const elements = {
    'edit-front': field,
    'edit-front-preview': preview,
    'edit-front-preview-text': previewText
  };
  context.$ = id => elements[id];

  context.updateMathPreview('edit-front');
  assert.equal(preview.hidden, false);
  assert.equal(previewText.children[1].children[0].textContent, 'SELECT * FROM 従業員');

  field.value = '通常の問題';
  context.updateMathPreview('edit-front');
  assert.equal(preview.hidden, true);
});

test('editor preview follows changes to the answer field', () => {
  const previewText = makeElement('div');
  const preview = {
    hidden: true,
    classList: {
      toggle(name, hidden) {
        assert.equal(name, 'hidden');
        preview.hidden = hidden;
      }
    }
  };
  const field = { value: 'IPv6はIPv4の \\(2^{96}\\) 倍' };
  const elements = {
    'edit-back': field,
    'edit-back-preview': preview,
    'edit-back-preview-text': previewText
  };
  context.$ = id => elements[id];

  context.updateMathPreview('edit-back');
  assert.equal(preview.hidden, false);
  assert.deepEqual(previewText.children.filter(child => child.tagName === 'sup').map(child => child.textContent), ['96']);

  field.value = '通常の答え';
  context.updateMathPreview('edit-back');
  assert.equal(preview.hidden, true);
});

test('Mermaid blocks in notes remain separate from ordinary text and powers', () => {
  const element = makeElement('div');
  const input = '補足 2^{96}\n```mermaid\nflowchart LR\n  A^B --> C\n```\n最後';
  context.renderNotesText(element, input);

  assert.equal(element.children.length, 3);
  assert.equal(element.children[0].children.find(child => child.tagName === 'sup').textContent, '96');
  assert.equal(element.children[1].className, 'mermaid-block');
  assert.equal(element.children[1].children[0].dataset.mermaidSource, 'flowchart LR\n  A^B --> C\n');
  assert.equal(element.children[1].children[0].dataset.mermaidRaw, '```mermaid\nflowchart LR\n  A^B --> C\n```');
  assert.equal(element.children[2].textContent, '\n最後');
});

test('unclosed Mermaid blocks stay as literal notes', () => {
  const input = '補足\n```mermaid\nflowchart LR\n  A --> B';
  const parts = Array.from(context.splitMermaidNotes(input));

  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[0].value, input);
});
