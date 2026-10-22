import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createRoutes } from '../lib/routes.js'

const PREFIX = '/plugin/session-tidy/'

function request(method, action, { body, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body, 'utf8')])
  stream.method = method
  stream.url = `/plugin/session-tidy/${action}`
  stream.socket = { remoteAddress }
  stream.headers = {
    host: '127.0.0.1:61020',
    'x-dsh-plugin': 'session-tidy',
    'content-type': 'application/json',
    ...headers,
  }
  return stream
}

function response() {
  return {
    statusCode: 0,
    body: '',
    writeHead(code) {
      this.statusCode = code
    },
    end(chunk) {
      this.body = chunk === undefined ? '' : String(chunk)
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

async function call(routes, req) {
  const res = response()
  await routes.handle(req, res)
  return res
}

function fakeStore(overrides = {}) {
  return {
    calls: [],
    entries: [],
    async list() {
      this.calls.push(['list'])
      return this.entries
    },
    async remove(id, meta) {
      this.calls.push(['remove', id, meta])
      this.entries = [{ id, ...meta, dirName: `d-${id}` }]
      return this.entries[0]
    },
    async restore(id) {
      this.calls.push(['restore', id])
      const entry = this.entries.find((item) => item.id === id)
      if (entry === undefined) {
        const error = new Error('not found')
        error.code = 'NOT_FOUND'
        throw error
      }
      return entry
    },
    async purge(id) {
      this.calls.push(['purge', id])
      return { id }
    },
    async empty() {
      this.calls.push(['empty'])
      return this.entries
    },
    async prune() {
      this.calls.push(['prune'])
      return []
    },
    ...overrides,
  }
}

test('rejects a request without the plugin marker header', async () => {
  const routes = createRoutes({ store: fakeStore() })
  const res = await call(routes, request('GET', 'trash', { headers: { 'x-dsh-plugin': '' } }))
  assert.equal(res.statusCode, 403)
})

test('rejects a cross-origin request', async () => {
  const routes = createRoutes({ store: fakeStore() })
  const res = await call(routes, request('GET', 'trash', { headers: { origin: 'http://evil.example' } }))
  assert.equal(res.statusCode, 403)
})

test('rejects a non-loopback caller', async () => {
  const store = fakeStore()
  const routes = createRoutes({ store })
  const res = await call(routes, request('GET', 'trash', { remoteAddress: '192.168.1.9' }))
  assert.equal(res.statusCode, 403)
  assert.deepEqual(store.calls, [])
})

test('accepts an IPv6-mapped loopback caller', async () => {
  const routes = createRoutes({ store: fakeStore() })
  const res = await call(routes, request('GET', 'trash', { remoteAddress: '::ffff:127.0.0.1' }))
  assert.equal(res.statusCode, 200)
})

test('accepts a same-origin request', async () => {
  const routes = createRoutes({ store: fakeStore() })
  const res = await call(routes, request('GET', 'trash', { headers: { origin: 'http://127.0.0.1:61020' } }))
  assert.equal(res.statusCode, 200)
})

test('lists entries after pruning expired ones', async () => {
  const store = fakeStore({ entries: [{ id: 'a', title: 'A', deletedAt: '2026-10-21T10:00:00.000Z' }] })
  const routes = createRoutes({ store })
  const res = await call(routes, request('GET', 'trash'))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().entries.map((entry) => entry.id), ['a'])
  assert.deepEqual(store.calls[0], ['prune'])
})

test('deletes after the archive hook and returns the entry', async () => {
  const store = fakeStore()
  const order = []
  const routes = createRoutes({
    store,
    beforeRemove: async (id) => order.push(['before', id]),
  })
  const res = await call(routes, request('POST', 'delete', { body: JSON.stringify({ id: 'session-1', title: 'T' }) }))
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().entry.id, 'session-1')
  assert.deepEqual(order, [['before', 'session-1']])
})

test('refuses deletion when the archive hook rejects and records nothing', async () => {
  const store = fakeStore()
  const routes = createRoutes({
    store,
    beforeRemove: async () => {
      throw new Error('running work')
    },
  })
  const res = await call(routes, request('POST', 'delete', { body: JSON.stringify({ id: 'session-1' }) }))
  assert.equal(res.statusCode, 409)
  assert.equal(store.calls.length, 0)
})

test('rejects an unknown action', async () => {
  const routes = createRoutes({ store: fakeStore() })
  const res = await call(routes, request('GET', 'nope'))
  assert.equal(res.statusCode, 404)
})

test('rejects malformed JSON', async () => {
  const routes = createRoutes({ store: fakeStore() })
  const res = await call(routes, request('POST', 'delete', { body: '{oops' }))
  assert.equal(res.statusCode, 400)
})

test('restores and reports an unknown entry as 404', async () => {
  const store = fakeStore()
  const restored = []
  const routes = createRoutes({ store, afterRestore: async (meta) => restored.push(meta.id) })
  await call(routes, request('POST', 'delete', { body: JSON.stringify({ id: 'session-1' }) }))
  const ok = await call(routes, request('POST', 'restore', { body: JSON.stringify({ id: 'session-1' }) }))
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(restored, ['session-1'])
  const missing = await call(routes, request('POST', 'restore', { body: JSON.stringify({ id: 'session-2' }) }))
  assert.equal(missing.statusCode, 404)
})

test('purges one entry and empties the trash', async () => {
  const store = fakeStore()
  const routes = createRoutes({ store })
  const purge = await call(routes, request('POST', 'purge', { body: JSON.stringify({ id: 'session-1' }) }))
  assert.equal(purge.statusCode, 200)
  const empty = await call(routes, request('POST', 'empty', { body: '{}' }))
  assert.equal(empty.statusCode, 200)
})