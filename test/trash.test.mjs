import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTrashStore } from '../lib/trash.js'

const WS = '--D-work-demo--'
const ID = 'session-abc'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fixture({ clock = () => new Date('2026-10-21T10:00:00Z') } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cleaner-test-'))
  const home = join(root, 'home')
  const sessionDir = join(home, 'sessions', WS, ID)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'x'.repeat(100))
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, `${ID}.json`), '{}')
  const store = createTrashStore({ homeDir: home, now: clock })
  return { root, home, sessionDir, cacheDir, store }
}

async function cleanup(fx) {
  await rm(fx.root, { recursive: true, force: true })
}

test('remove moves the session into the trash and records metadata', async () => {
  const fx = await fixture()
  try {
    const entry = await fx.store.remove(ID, { title: 'Hello', workspaceId: 'w1', workspaceTitle: 'demo' })
    assert.equal(entry.id, ID)
    assert.equal(entry.title, 'Hello')
    assert.equal(entry.workspaceId, 'w1')
    assert.equal(entry.size, 100)
    assert.equal(await exists(fx.sessionDir), false)
    assert.equal(await exists(join(fx.cacheDir, `${ID}.json`)), false)
    const meta = JSON.parse(await readFile(join(fx.store.entriesRoot, entry.dirName, 'meta.json'), 'utf8'))
    assert.equal(meta.id, ID)
    assert.equal(meta.workspaceKey, WS)
    assert.equal(meta.deletedAt, '2026-10-21T10:00:00.000Z')
    assert.equal(await exists(join(fx.store.entriesRoot, entry.dirName, 'session', 'session.v4.jsonl.zstd')), true)
  } finally {
    await cleanup(fx)
  }
})

test('remove rejects an id that escapes the sessions root', async () => {
  const fx = await fixture()
  try {
    await assert.rejects(fx.store.remove('../escape', { title: 'x' }), (error) => error.code === 'INVALID_ID')
    await assert.rejects(fx.store.remove('', { title: 'x' }), (error) => error.code === 'INVALID_ID')
  } finally {
    await cleanup(fx)
  }
})

test('remove reports a missing session without creating an entry', async () => {
  const fx = await fixture()
  try {
    await assert.rejects(fx.store.remove('session-missing', { title: 'x' }), (error) => error.code === 'NOT_FOUND')
    assert.deepEqual(await fx.store.list(), [])
  } finally {
    await cleanup(fx)
  }
})

test('list returns newest entries first', async () => {
  const fx = await fixture({ clock: () => new Date('2026-10-20T10:00:00Z') })
  try {
    await fx.store.remove(ID, { title: 'older' })
    const second = 'session-newer'
    await mkdir(join(fx.home, 'sessions', WS, second), { recursive: true })
    await writeFile(join(fx.home, 'sessions', WS, second, 'session.v4.jsonl.zstd'), 'z')
    const later = createTrashStore({ homeDir: fx.home, now: () => new Date('2026-10-21T10:00:00Z') })
    await later.remove(second, { title: 'newer' })
    const entries = await fx.store.list()
    assert.deepEqual(entries.map((entry) => entry.id), [second, ID])
  } finally {
    await cleanup(fx)
  }
})

test('restore returns the session to its recorded workspace and clears the entry', async () => {
  const fx = await fixture()
  try {
    const entry = await fx.store.remove(ID, { title: 'Hello', workspaceId: 'w1' })
    const meta = await fx.store.restore(ID)
    assert.equal(meta.id, ID)
    assert.equal(await exists(fx.sessionDir), true)
    assert.equal(await exists(join(fx.store.entriesRoot, entry.dirName)), false)
  } finally {
    await cleanup(fx)
  }
})

test('restore reports an unknown entry', async () => {
  const fx = await fixture()
  try {
    await assert.rejects(fx.store.restore('session-missing'), (error) => error.code === 'NOT_FOUND')
  } finally {
    await cleanup(fx)
  }
})

test('purge deletes one entry and empty deletes every entry', async () => {
  const fx = await fixture()
  try {
    const entry = await fx.store.remove(ID, { title: 'one' })
    await fx.store.purge(ID)
    assert.equal(await exists(join(fx.store.entriesRoot, entry.dirName)), false)
    await assert.rejects(fx.store.purge(ID), (error) => error.code === 'NOT_FOUND')

    await mkdir(join(fx.home, 'sessions', WS, ID), { recursive: true })
    await writeFile(join(fx.home, 'sessions', WS, ID, 'session.v4.jsonl.zstd'), 'y')
    await fx.store.remove(ID, { title: 'two' })
    await fx.store.empty()
    assert.deepEqual(await fx.store.list(), [])
  } finally {
    await cleanup(fx)
  }
})

test('prune removes entries older than the retention window', async () => {
  const fx = await fixture({ clock: () => new Date('2026-10-21T10:00:00Z') })
  try {
    await fx.store.remove(ID, { title: 'old' })
    const future = createTrashStore({ homeDir: fx.home, now: () => new Date('2026-10-29T10:00:00Z') })
    const removed = await future.prune()
    assert.equal(removed.length, 1)
    assert.deepEqual(await future.list(), [])
  } finally {
    await cleanup(fx)
  }
})

test('prune keeps entries inside the retention window', async () => {
  const fx = await fixture({ clock: () => new Date('2026-10-21T10:00:00Z') })
  try {
    await fx.store.remove(ID, { title: 'fresh' })
    const later = createTrashStore({ homeDir: fx.home, now: () => new Date('2026-10-25T10:00:00Z') })
    const removed = await later.prune()
    assert.equal(removed.length, 0)
    assert.equal((await later.list()).length, 1)
  } finally {
    await cleanup(fx)
  }
})