import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

/** A refusal that carries a stable machine code for the HTTP layer. */
export class TrashError extends Error {
  /** @param code - stable refusal code. @param message - operator-facing detail. */
  constructor(code, message) {
    super(message)
    this.name = 'TrashError'
    this.code = code
  }
}

/** @param path - absolute path. @returns whether anything exists there. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** @param dir - absolute directory. @returns total bytes of every regular file below it. */
async function directorySize(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(path)
    else if (entry.isFile()) total += (await stat(path)).size
  }
  return total
}

/** Move one directory, retrying the transient Windows writer locks. */
async function moveDirectory(source, target, attempts = 6) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      lastError = error
      if (error.code === 'EXDEV') {
        await cp(source, target, { recursive: true })
        await rm(source, { recursive: true, force: true })
        return
      }
      if (!RETRYABLE.has(error.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
  throw lastError
}

/**
 * Create the session trash store.
 * @param options.homeDir - resolved DSH home.
 * @param options.now - clock injection for tests.
 * @param options.retentionDays - auto-purge window.
 */
export function createTrashStore({ homeDir, now = () => new Date(), retentionDays = 7 }) {
  const sessionsRoot = join(homeDir, 'sessions')
  const cacheRoot = join(homeDir, 'storages', 'session_projcache', 'sessions')
  const trashRoot = join(homeDir, 'session-trash')
  const entriesRoot = join(trashRoot, 'entries')

  /** @param id - session id. */
  function assertId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new TrashError('INVALID_ID', `invalid session id: ${JSON.stringify(id)}`)
    }
  }

  /** @param id - session id. @returns every on-disk session directory with that name. */
  async function locate(id) {
    const keys = await readdir(sessionsRoot).catch(() => [])
    const found = []
    for (const key of keys) {
      const dir = join(sessionsRoot, key, id)
      if (await exists(dir)) found.push({ dir, workspaceKey: key })
    }
    return found
  }

  /** @returns every trash entry, newest deletion first. */
  async function list() {
    await mkdir(entriesRoot, { recursive: true })
    const names = await readdir(entriesRoot)
    const entries = []
    for (const dirName of names) {
      const dir = join(entriesRoot, dirName)
      try {
        if (!(await stat(dir)).isDirectory()) continue
        const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
        entries.push({ ...meta, dirName })
      } catch {
        // A half-written entry is not allowed to break the list.
      }
    }
    entries.sort((a, b) => String(b.deletedAt ?? '').localeCompare(String(a.deletedAt ?? '')))
    return entries
  }

  /** @param id - session id. @returns the matching entry, if any. */
  async function findEntry(id) {
    return (await list()).find((entry) => entry.id === id)
  }

  /**
   * Move one session into the trash.
   * @param id - session id.
   * @param meta - display facts recorded beside the session.
   */
  async function remove(id, meta = {}) {
    assertId(id)
    const candidates = await locate(id)
    if (candidates.length === 0) throw new TrashError('NOT_FOUND', `session not found: ${id}`)
    if (candidates.length > 1) throw new TrashError('CONFLICT', `session stored twice: ${id}`)
    const [{ dir, workspaceKey }] = candidates
    const deletedAt = now().toISOString()
    const dirName = `${deletedAt.replace(/[:.]/g, '-')}-${id}`
    const entryDir = join(entriesRoot, dirName)
    const size = await directorySize(dir)
    const record = {
      id,
      title: typeof meta.title === 'string' ? meta.title : '',
      workspaceId: typeof meta.workspaceId === 'string' ? meta.workspaceId : null,
      workspaceTitle: typeof meta.workspaceTitle === 'string' ? meta.workspaceTitle : '',
      workspaceKey,
      deletedAt,
      size,
    }
    await mkdir(entryDir, { recursive: true })
    try {
      await moveDirectory(dir, join(entryDir, 'session'))
    } catch (error) {
      await rm(entryDir, { recursive: true, force: true })
      throw error
    }
    await writeFile(join(entryDir, 'meta.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rm(join(cacheRoot, `${id}.json`), { force: true })
    return { ...record, dirName }
  }

  /**
   * Move one trashed session back to its recorded workspace directory.
   * @param id - session id.
   */
  async function restore(id) {
    assertId(id)
    const entry = await findEntry(id)
    if (entry === undefined) throw new TrashError('NOT_FOUND', `trash entry not found: ${id}`)
    const entryDir = join(entriesRoot, entry.dirName)
    const parent = join(sessionsRoot, entry.workspaceKey)
    const target = join(parent, id)
    if (await exists(target)) throw new TrashError('CONFLICT', `session already exists: ${id}`)
    await mkdir(parent, { recursive: true })
    await moveDirectory(join(entryDir, 'session'), target)
    await rm(entryDir, { recursive: true, force: true })
    return entry
  }

  /** @param id - session id. */
  async function purge(id) {
    assertId(id)
    const entry = await findEntry(id)
    if (entry === undefined) throw new TrashError('NOT_FOUND', `trash entry not found: ${id}`)
    await rm(join(entriesRoot, entry.dirName), { recursive: true, force: true })
    return entry
  }

  /** @returns the purged entries. */
  async function empty() {
    const entries = await list()
    await rm(entriesRoot, { recursive: true, force: true })
    await mkdir(entriesRoot, { recursive: true })
    return entries
  }

  /** @returns the entries older than the retention window. */
  async function prune() {
    const cutoff = now().getTime() - retentionDays * DAY_MS
    const removed = []
    for (const entry of await list()) {
      const at = Date.parse(entry.deletedAt)
      if (Number.isFinite(at) && at < cutoff) {
        await rm(join(entriesRoot, entry.dirName), { recursive: true, force: true })
        removed.push(entry)
      }
    }
    return removed
  }

  return { entriesRoot, sessionsRoot, trashRoot, list, remove, restore, purge, empty, prune }
}