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
