import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const captured = {}
globalThis.window = { __ModuleLoader__: { load(spec) { captured.spec = spec } } }

// The module only needs a `createElement` handle at load time; components are
// never rendered here (rendered display needs the running page).
const React = { createElement: () => null, Fragment: Symbol('fragment') }

function fakeRequire(name) {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}

await import('../client.js')
const factory = captured.spec.factory(fakeRequire)

function fakeContext() {
  const registrations = []
  const locale = { ns: null, dictionaries: null }
  const ctx = {
    effect(fn) {
      return fn()
    },
    locale: {
      register(ns, dictionaries) {
        locale.ns = ns
        locale.dictionaries = dictionaries
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(name, callback) {
        callback()
      },
      register(options, component) {
        registrations.push({ ...options, component })
        return () => {}
      },
    },
    sessions: {
      refresh: () => Promise.resolve(),
      binding: () => undefined,
      fork: () => Promise.resolve('session-child'),
    },
    uiWorkspace: { openSession: () => {} },
  }
  return { ctx, registrations, locale }
}

test('the client manifest keeps the package id and ordering dependencies', () => {
  assert.equal(captured.spec.id, 'dsh-session-tidy')
  assert.deepEqual(factory.inject, ['slots', 'locale', 'sessions', 'uiWorkspace'])
})

test('apply registers the row action, menu row, footer action, overlay, and composer seat', () => {
  const { ctx, registrations } = fakeContext()
  factory.apply(ctx)
  const names = registrations.map((entry) => `${entry.name}#${entry.id}`)
  assert.deepEqual(names, [
    'sidebar.workspaces.session.menu.item#session-tidy.delete',
    'sidebar.workspaces.session.row.action#session-tidy.delete',
    'sidebar.footer.action#session-tidy.trash',
    'shell.overlay#session-tidy.overlay',
    'conversation.input.left#session-tidy.bubble-edit',
  ])
  for (const entry of registrations) {
    assert.equal(entry.locale, 'session-tidy')
    assert.equal(typeof entry.component, 'function')
  }
})

test('both dictionaries carry the same keys', () => {
  const { ctx, locale } = fakeContext()
  factory.apply(ctx)
  const { zh, en } = locale.dictionaries
  assert.equal(locale.ns, 'session-tidy')
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('the dictionaries cover every key the plugin asks for', async () => {
  const { ctx, locale } = fakeContext()
  factory.apply(ctx)
  const { en } = locale.dictionaries
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const used = new Set()
  for (const m of source.matchAll(/\bt\('([a-z][\w.]*)'/g)) used.add(m[1])
  assert.ok(used.size > 10)
  for (const key of used) assert.ok(key in en, `missing dictionary key: ${key}`)
})