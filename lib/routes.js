import { TrashError } from './trash.js'

const PREFIX = '/plugin/session-tidy'
const MAX_BODY = 64 * 1024

/** @param res - node response. @param status - HTTP status. @param payload - JSON-safe body. */
function send(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** @param address - `req.socket.remoteAddress`. @returns whether it is loopback. */
function isLoopback(address) {
  // A missing socket only happens for synthetic in-process callers (tests).
  if (address === undefined) return true
  const value = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return value === '::1' || value === 'localhost' || /^127\./.test(value)
}

/** @param req - node request. @returns whether the caller may use the routes. */
function trusted(req) {
  if (!isLoopback(req.socket?.remoteAddress)) return false
  if (req.headers['x-dsh-plugin'] !== 'session-tidy') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** @param req - node request. @returns the parsed JSON body. */
async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new TrashError('BODY_TOO_LARGE', 'request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new TrashError('INVALID_BODY', 'request body is not valid JSON')
  }
}

/** @param error - thrown value. @returns a stable code. */
function codeOf(error) {
  return typeof error?.code === 'string' ? error.code : 'INTERNAL'
}

/** Map a refusal to its HTTP status. */
function statusOf(code) {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'INVALID_ID':
    case 'INVALID_BODY':
    case 'BODY_TOO_LARGE':
      return 400
    case 'CONFLICT':
      return 409
    default:
      return 500
  }
}

/**
 * Build the plugin's HTTP handler.
 * @param options.store - session trash store.
 * @param options.beforeRemove - host hop that stops work and archives one session.
 * @param options.afterRestore - host hop that unarchives and reattaches one session.
 * @param options.logger - optional logger with `warn`.
 */
export function createRoutes({ store, beforeRemove, afterRestore, logger }) {
  async function handle(req, res) {
    if (req.method === undefined) {
      send(res, 405, { ok: false, error: { code: 'METHOD', message: 'method required' } })
      return
    }
    if (!trusted(req)) {
      send(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'request not allowed' } })
      return
    }
    const action = new URL(req.url ?? '/', 'http://local').pathname.slice(PREFIX.length + 1)
    try {
      if (req.method === 'GET' && action === 'trash') {
        await store.prune().catch((error) => logger?.warn?.(error))
        send(res, 200, { ok: true, entries: await store.list() })
        return
      }
      if (req.method === 'POST' && action === 'delete') {
        const body = await readJson(req)
        let facts = {}
        try {
          facts = (await beforeRemove?.(String(body.id ?? ''))) ?? {}
        } catch (error) {
          send(res, 409, { ok: false, error: { code: 'ARCHIVE_FAILED', message: String(error?.message ?? error) } })
          return
        }
        try {
          const entry = await store.remove(String(body.id ?? ''), {
            title: body.title,
            ...facts,
          })
          send(res, 200, { ok: true, entry })
        } catch (error) {
          await afterRestore?.({ id: String(body.id ?? '') }).catch((rollback) => logger?.warn?.(rollback))
          throw error
        }
        return
      }
      if (req.method === 'POST' && action === 'restore') {
        const body = await readJson(req)
        const entry = await store.restore(String(body.id ?? ''))
        await afterRestore?.(entry).catch((error) => logger?.warn?.(error))
        send(res, 200, { ok: true, entry })
        return
      }
      if (req.method === 'POST' && action === 'purge') {
        const body = await readJson(req)
        const entry = await store.purge(String(body.id ?? ''))
        send(res, 200, { ok: true, entry })
        return
      }
      if (req.method === 'POST' && action === 'empty') {
        await readJson(req)
        const entries = await store.empty()
        send(res, 200, { ok: true, removed: entries.length })
        return
      }
      send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown action' } })
    } catch (error) {
      const code = codeOf(error)
      if (code === 'INTERNAL') logger?.warn?.(error)
      send(res, statusOf(code), { ok: false, error: { code, message: String(error?.message ?? error) } })
    }
  }

  return { handle, prefix: PREFIX }
}