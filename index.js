import { homedir } from 'node:os'
import { join } from 'node:path'
import { createTrashStore } from './lib/trash.js'
import { createRoutes } from './lib/routes.js'

/** Resolve the DSH home the same way the rest of the profile does. */
function resolveHome() {
  const configured = process.env.DSH_HOME?.trim()
  if (configured !== undefined && configured !== '') {
    return configured.replace(/^~(?=$|[\\/])/, () => homedir())
  }
  return join(homedir(), '.dsh')
}

/** Host half: trash storage plus the HTTP routes the Client module calls. */
export function apply(ctx) {
  const store = createTrashStore({ homeDir: resolveHome() })
  const registry = () => ctx.get('workspaceRegistry')
  const logger = ctx.logger

  const beforeRemove = async (id) => {
    const workspaces = registry()
    if (workspaces === undefined) return {}
    try {
      await workspaces.archiveSession(id, { stopActivity: true })
    } catch (error) {
      if (error?.name !== 'WorkspaceUnknownSessionError') throw error
      return {}
    }
    const owner = workspaces.list().find((workspace) => workspace.sessionIds.includes(id))
    return owner === undefined ? {} : { workspaceId: owner.id, workspaceTitle: owner.title }
  }

  const afterRestore = async (entry) => {
    const workspaces = registry()
    if (workspaces === undefined) return
    if (typeof entry.workspaceId === 'string' && entry.workspaceId !== '') {
      const workspace = workspaces.get(entry.workspaceId)
      if (workspace !== undefined) {
        try {
          await workspace.attachSession(entry.id)
        } catch (error) {
          logger?.warn?.(`session-tidy: reattach failed for ${entry.id}: ${String(error?.message ?? error)}`)
        }
      }
    }
    try {
      await workspaces.unarchiveSession(entry.id)
    } catch (error) {
      logger?.warn?.(`session-tidy: unarchive failed for ${entry.id}: ${String(error?.message ?? error)}`)
    }
  }

  const routes = createRoutes({ store, beforeRemove, afterRestore, logger })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: routes.prefix, handler: routes.handle }),
    'session-tidy: http routes',
  )
}

/** The HTTP carrier is optional; without it the Client cannot reach the store. */
export const inject = ['webServer']