import test from 'node:test'
import assert from 'node:assert/strict'

// --- minimal browser surface ------------------------------------------------

const captured = {}
globalThis.window = { __ModuleLoader__: { load(spec) { captured.spec = spec } } }

const draftStorage = new Map()
globalThis.localStorage = {
  getItem: (key) => (draftStorage.has(key) ? draftStorage.get(key) : null),
  setItem: (key, value) => draftStorage.set(key, String(value)),
  removeItem: (key) => draftStorage.delete(key),
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  Fragment: Symbol('fragment'),
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  // Effects run eagerly: these tests never commit, and the decorator is an
  // effect-only seat whose whole job is this side effect.
  useEffect(fn) {
    fn()
  },
  useRef(initial) {
    return { current: initial }
  },
  useMemo(fn) {
    return fn()
  },
}

// --- tiny DOM ---------------------------------------------------------------

/** Attribute-only selector match, enough for the decorator's queries. */
function matchesSelector(element, selector) {
  const terms = selector.match(/\[[^\]]+\]/g)
  if (terms === null) return false
  return terms.every((term) => {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(term)
    if (match === null) return false
    const actual = element.attributes[match[1]]
    return match[2] === undefined ? actual !== undefined : actual === match[2]
  })
}

function walk(element, visit) {
  for (const child of element.children) {
    visit(child)
    walk(child, visit)
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.nodeType = 1
    this.children = []
    this.parentNode = null
    this.dataset = {}
    this.attributes = {}
    this.listeners = {}
    this.style = {}
    this.disabled = false
    this.title = ''
    this.textContent = ''
    this.innerHTML = ''
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      this.dataset[camel] = String(value)
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  get firstChild() {
    return this.children[0] ?? null
  }

  appendChild(node) {
    node.parentNode = this
    this.children.push(node)
    return node
  }

  insertBefore(node, reference) {
    node.parentNode = this
    const index = reference === null ? -1 : this.children.indexOf(reference)
    if (index < 0) this.children.push(node)
    else this.children.splice(index, 0, node)
    return node
  }

  remove() {
    const siblings = this.parentNode?.children
    const index = siblings === undefined ? -1 : siblings.indexOf(this)
    if (index >= 0) siblings.splice(index, 1)
    this.parentNode = null
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const found = []
    walk(this, (element) => {
      if (matchesSelector(element, selector)) found.push(element)
    })
    return found
  }
}

const documentHead = new FakeElement('head')
const documentBody = new FakeElement('body')
const fakeDocument = {
  head: documentHead,
  body: documentBody,
  documentElement: new FakeElement('html'),
  createElement: (tag) => new FakeElement(tag),
  querySelector: (selector) => fakeDocument.querySelectorAll(selector)[0] ?? null,
  querySelectorAll(selector) {
    const found = []
    walk(documentBody, (element) => {
      if (matchesSelector(element, selector)) found.push(element)
    })
    return found
  },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = fakeDocument
globalThis.MutationObserver = class {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  disconnect() {}
}
globalThis.requestAnimationFrame = (fn) => {
  fn()
  return 0
}

const apiCalls = []
globalThis.fetch = async (url, init) => {
  apiCalls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

function fakeRequire(name) {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}

await import('../client.js')
const factory = captured.spec.factory(fakeRequire)

/** A translator that keeps interpolated parameters visible to assertions. */
const t = (key, params) => (params === undefined ? key : { key, ...params })

/** Build one chat flow item with the shipped copy/time row inside it. */
function addMessageRow({ key, kind = 'user', clock = 'start' }) {
  const row = new FakeElement('div')
  row.setAttribute('data-chat-flow-kind', kind)
  row.setAttribute('data-chat-node-key', key)
  const actions = new FakeElement('div')
  actions.setAttribute('data-clock', clock)
  actions.appendChild(new FakeElement('span'))
  actions.appendChild(new FakeElement('button'))
  row.appendChild(actions)
  documentBody.appendChild(row)
  return { row, actions }
}

/** The chat projection: a keyed node map with one user message per call. */
function nodeStore(entries) {
  const map = new Map(entries.map(([key, node]) => [key, node]))
  return { get: (key) => map.get(key) }
}

const userNode = (seq, text) => ({ kind: 'user', data: { seq, content: [{ type: 'text', text }] } })

/** Render the decorator seat and return the injected pencil (if any). */
function decorate({ running = false, nodes = nodeStore([['u2', userNode(20, 'fix the bug')]]), order } = {}) {
  const registrations = []
  const forked = []
  const opened = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, callback) => callback(),
      register(options, component) {
        registrations.push({ ...options, component })
        return () => {}
      },
    },
    sessions: {
      refresh: () => Promise.resolve(),
      binding: () => undefined,
      list: {
        getSnapshot: () => ({
          byId: { 'session-source': { displayTitle: 'Wrong question', title: 'Wrong question' } },
        }),
      },
      fork: (options) => {
        forked.push(options)
        return Promise.resolve('session-child')
      },
    },
    uiWorkspace: { openSession: (id) => opened.push(id) },
  }
  factory.apply(ctx)
  const find = (name) => registrations.find((entry) => entry.name === name)
  const seat = find('conversation.input.left').component
  const outer = seat({
    sessionId: 'session-source',
    useChat: (selector) => selector({ nodes, order }),
    useSession: (selector) => selector({ running }),
    t,
  })
  if (outer !== null) outer.type(outer.props)
  const overlay = find('shell.overlay').component
  const buttons = documentBody.querySelectorAll('[data-session-tidy-edit]')
  return { buttons, button: buttons[0], overlay, forked, opened }
}

/** Click the pencil and return the edit dialog's modal element. */
function openDialog(button, overlay) {
  button.listeners.click({ preventDefault() {}, stopPropagation() {} })
  return currentDialog(overlay)
}

/** Render the plugin overlay and pull out the edit dialog (if open). */
function currentDialog(overlay) {
  const tree = overlay({ t })
  if (tree === null) return null
  const request = tree.children.find((child) => child?.props?.request !== undefined)
  return request === undefined ? null : request.type(request.props)
}

test('every user bubble gets a hover pencil inside its actions row', () => {
  documentBody.children = []
  addMessageRow({ key: 'u1' })
  addMessageRow({ key: 'u2' })
  const nodes = nodeStore([
    ['u1', userNode(4, 'first request')],
    ['u2', userNode(20, 'fix the bug')],
  ])
  const { buttons } = decorate({ nodes })
  // One per re-decorated row, and it sits before the time/copy controls.
  assert.equal(buttons.length >= 2, true)
  const actions = documentBody.querySelectorAll('[data-clock="start"]')
  assert.equal(actions[0].firstChild.getAttribute('data-session-tidy-edit'), '')
  assert.equal(buttons[0].getAttribute('type'), 'button')
  assert.match(buttons[0].innerHTML, /<svg/)
})

test('a bubble without an editable node gets no pencil', () => {
  documentBody.children = []
  addMessageRow({ key: 'a1' })
  addMessageRow({ key: 'u9' })
  const nodes = nodeStore([
    ['a1', { kind: 'assistant-step', data: {} }],
    ['u9', { kind: 'user', data: { seq: 0, content: [{ type: 'text', text: 'preamble' }] } }],
  ])
  const { buttons } = decorate({ nodes })
  assert.equal(buttons.length, 0)
})

test('the pencil stays disabled while the session runs and clicks do nothing', () => {
  documentBody.children = []
  addMessageRow({ key: 'u2' })
  const { button, overlay } = decorate({ running: true })
  assert.equal(button.disabled, true)
  assert.equal(button.title, 'edit.running')
  button.listeners.click({ preventDefault() {}, stopPropagation() {} })
  assert.equal(overlay({ t }), null)
})

test('clicking a pencil opens an editable dialog for that exact message', () => {
  documentBody.children = []
  const { row } = addMessageRow({ key: 'u1' })
  const nodes = nodeStore([
    ['u1', userNode(4, 'first request')],
    ['u2', userNode(20, 'fix the bug')],
  ])
  const { button, overlay } = decorate({ nodes })
  assert.equal(button.title, 'edit.button')
  const dialog = openDialog(button, overlay)
  assert.notEqual(dialog, null)
  assert.equal(dialog.props.title, 'edit.title')
  const area = dialog.children.find((child) => child?.type === 'textarea')
  assert.notEqual(area, undefined)
  assert.equal(area.props.value, 'first request')
  assert.equal(area.props.disabled, false)
  assert.equal(row.attributes['data-chat-node-key'], 'u1')
})

test('the edited text is what the branch is seeded with', async () => {
  documentBody.children = []
  draftStorage.clear()
  addMessageRow({ key: 'u2' })
  const { button, overlay } = decorate()

  const dialog = openDialog(button, overlay)
  const area = dialog.children.find((child) => child?.type === 'textarea')
  area.props.onChange({ target: { value: 'fix the bug, but keep the API' } })

  const reopened = currentDialog(overlay)
  reopened.props.footer[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  const stored = JSON.parse(draftStorage.get('dsh.conversation.session-child'))
  assert.deepEqual(stored.draft, { text: 'fix the bug, but keep the API', references: [] })
})

test('the fork cuts at the previous completed turn, not inside the turn', async () => {
  documentBody.children = []
  draftStorage.clear()
  addMessageRow({ key: 'u2' })
  const nodes = nodeStore([
    ['a1', { kind: 'assistant-step', data: {} }],
    ['tail1', { kind: 'turn-tail', data: { seq: 41, turn: 1 } }],
    ['u2', { kind: 'user', data: { seq: 50, content: [{ type: 'text', text: 'fix the bug' }] }, location: { kind: 'step', turn: { start: { seq: 47 } } } }],
  ])
  const { button, overlay, forked } = decorate({ nodes, order: ['a1', 'tail1', 'u2'] })

  const dialog = openDialog(button, overlay)
  dialog.props.footer[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.deepEqual(forked, [{ sessionId: 'session-source', atSeq: 41, increaseTitle: false }])
})

test('an empty forked turn left by an earlier edit is skipped', async () => {
  documentBody.children = []
  draftStorage.clear()
  addMessageRow({ key: 'u2' })
  const nodes = nodeStore([
    ['a1', { kind: 'assistant-step', data: {} }],
    ['tail1', { kind: 'turn-tail', data: { seq: 41, turn: 1 } }],
    ['tail2', { kind: 'turn-tail', data: { seq: 45, turn: 2 } }],
    ['u2', { kind: 'user', data: { seq: 50, content: [{ type: 'text', text: 'fix the bug' }] }, location: { kind: 'step', turn: { start: { seq: 47 } } } }],
  ])
  const { button, overlay, forked } = decorate({ nodes, order: ['a1', 'tail1', 'tail2', 'u2'] })

  const dialog = openDialog(button, overlay)
  dialog.props.footer[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.deepEqual(forked, [{ sessionId: 'session-source', atSeq: 41, increaseTitle: false }])
})

test('an emptied draft cannot be confirmed', () => {
  documentBody.children = []
  addMessageRow({ key: 'u2' })
  const { button, overlay } = decorate()

  const dialog = openDialog(button, overlay)
  const area = dialog.children.find((child) => child?.type === 'textarea')
  area.props.onChange({ target: { value: '   ' } })

  const reopened = currentDialog(overlay)
  assert.equal(reopened.props.footer[1].props.disabled, true)
})

test('confirming forks before that message, seeds the draft, and trashes the original', async () => {
  documentBody.children = []
  draftStorage.clear()
  apiCalls.length = 0
  addMessageRow({ key: 'u2' })
  const { button, overlay, forked, opened } = decorate()

  const dialog = openDialog(button, overlay)
  dialog.props.footer[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.deepEqual(forked, [{ sessionId: 'session-source', atSeq: 19, increaseTitle: false }])
  assert.deepEqual(opened, ['session-child'])
  const stored = JSON.parse(draftStorage.get('dsh.conversation.session-child'))
  assert.deepEqual(stored.draft, { text: 'fix the bug', references: [] })
  assert.equal(apiCalls.length, 1)
  assert.match(apiCalls[0].url, /\/plugin\/session-tidy\/delete$/)
  assert.deepEqual(apiCalls[0].body, { id: 'session-source', title: 'Wrong question' })
})

test('unchecking the trash option keeps the original and numbers the branch title', async () => {
  documentBody.children = []
  draftStorage.clear()
  apiCalls.length = 0
  addMessageRow({ key: 'u2' })
  const { button, overlay, forked } = decorate()

  const dialog = openDialog(button, overlay)
  const option = dialog.children.find((child) => child?.type === 'label')
  assert.notEqual(option, undefined)
  const checkbox = option.children.find((child) => child?.type === 'input')
  assert.equal(checkbox.props.checked, true)
  checkbox.props.onChange({ target: { checked: false } })

  const reopened = currentDialog(overlay)
  reopened.props.footer[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.deepEqual(forked, [{ sessionId: 'session-source', atSeq: 19, increaseTitle: true }])
  assert.equal(apiCalls.length, 0)
})

test('a fork failure keeps the dialog open and reports the error', async () => {
  documentBody.children = []
  addMessageRow({ key: 'u2' })
  const { button, overlay } = decorate({
    nodes: nodeStore([['u2', userNode(20, 'fix the bug')]]),
  })
  const dialog = openDialog(button, overlay)
  // Replace the bridge with one whose fork fails, then confirm again.
  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { inject: (_n, cb) => cb(), register: (options, component) => registrations.push({ ...options, component }) },
    sessions: { binding: () => undefined, fork: () => Promise.reject(new Error('session/fork-unavailable')) },
    uiWorkspace: { openSession: () => {} },
  }
  factory.apply(ctx)
  dialog.props.footer[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  const modal = currentDialog(overlay)
  assert.notEqual(modal, null)
  const alert = modal.children.find((child) => child?.props?.role === 'alert')
  assert.notEqual(alert, undefined)
  assert.equal(alert.children[0].key, 'toast.failed')
  assert.equal(alert.children[0].message, 'session/fork-unavailable')
})