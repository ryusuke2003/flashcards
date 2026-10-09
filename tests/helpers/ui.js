'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this._text = '';
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this._classes.add(name)),
      remove: (...names) => names.forEach(name => this._classes.delete(name)),
      contains: name => this._classes.has(name),
      toggle: (name, enabled = !this._classes.has(name)) => {
        if (enabled) this._classes.add(name); else this._classes.delete(name);
        return enabled;
      }
    };
  }
  set className(value) { this._classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    if (this.tagName === 'SELECT' && this.children.length === 1) this.value = child.value;
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name, event = {}) {
    for (const handler of this.listeners[name] || []) handler({ target: this, type: name, ...event });
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {}
  select() {}
  blur() {}
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector === 'input:checked') return descendants.filter(child => child.tagName === 'INPUT' && child.checked);
    if (selector === '.mermaid-pending') return descendants.filter(child => child.classList.contains('mermaid-pending'));
    throw new Error('Unexpected selector: ' + selector);
  }
}

function loadUI(app, options = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../../Index.html'), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1]);
    element.className = match[2].match(/class="([^"]*)"/)?.[1] || '';
    elements.set(match[3], element);
  }
  elements.get('delete-deck-current').parentElement = new Element('p');
  const calls = [];
  const queuedGrades = [];
  const queuedSessions = [];
  const stored = new Map();
  if (options.pendingGrades) stored.set('flashcards.pendingGrades.v1', JSON.stringify(options.pendingGrades));
  const makeRunner = (success = () => {}, failure = err => { throw err; }) => new Proxy({}, {
    get(_target, method) {
      if (method === 'withSuccessHandler') return handler => makeRunner(handler, failure);
      if (method === 'withFailureHandler') return handler => makeRunner(success, handler);
      return (...args) => {
        calls.push({ method, args });
        const invoke = () => {
          try { success(JSON.parse(JSON.stringify(app[method](...args)))); }
          catch (err) { failure(err); }
        };
        if (method === 'getSession' && options.delaySessions) {
          const snapshot = JSON.parse(JSON.stringify(app[method](...args)));
          queuedSessions.push(() => success(snapshot));
        } else if (method === 'gradeCardsQueued' && options.delayGrades) queuedGrades.push(invoke);
        else invoke();
      };
    }
  });
  const confirms = [];
  const context = {
    document: {
      getElementById: id => { if (!elements.has(id)) throw new Error('Missing element ' + id); return elements.get(id); },
      createElement: tag => new Element(tag),
      createElementNS: (_namespace, tag) => new Element(tag),
      createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; }
    },
    google: { script: { run: makeRunner() } },
    window: {
      addEventListener() {},
      confirm(message) { confirms.push(message); return options.confirmResult !== false; }
    },
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
    requestAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    console
  };
  vm.createContext(context);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('  restoreGradeQueue();', `
  window.testUI = {
    hasPendingForDeck, openRenameDeck, openDeleteDeck, loadDecks, refreshHomeFromServer, enqueueGrade, processGradeQueue,
    getState: function () { return { currentDeck, sessionData, gradeSync, queue, todayStudyCounts }; }
  };
  restoreGradeQueue();`);
  vm.runInContext(script, context, { filename: 'Index.html' });
  const get = id => elements.get(id);
  const chooseDeck = key => {
    const state = app.getDecksWithRegistry();
    const index = Array.from(state).findIndex(deck => deck.key === key);
    if (index === -1) throw new Error('Missing deck ' + key);
    get('deck-list').children[index].children[0].click();
  };
  return {
    get, calls, confirms, ui: context.window.testUI, chooseDeck,
    flushNextSession() { queuedSessions.shift()?.(); },
    flushLastSession() { queuedSessions.pop()?.(); },
    flushGrades() { while (queuedGrades.length) queuedGrades.shift()(); },
    checkSource(elementId, sourceId) {
      const input = get(elementId).querySelectorAll('*').find(node => node.tagName === 'INPUT' && node.value === sourceId);
      if (!input) throw new Error('Missing source ' + sourceId);
      input.checked = true;
    }
  };
}
module.exports = { loadUI };
