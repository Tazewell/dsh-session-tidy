window.__ModuleLoader__.load({
  id: 'dsh-session-tidy',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'session-tidy'
    const ENDPOINT = '/plugin/session-tidy/'

    const zh = {
      'action.delete': '删除',
      'action.deleteNamed': '删除会话「{title}」',
      'confirm.title': '删除会话',
      'confirm.body': '确定要删除「{title}」吗？',
      'confirm.note': '会先停止正在运行的任务，然后移入回收站；7 天内可以恢复。',
      'confirm.open': '这是当前打开的会话，请先切换到其他会话再删除。',
      'confirm.cancel': '取消',
      'confirm.action': '移到回收站',
      'busy': '处理中…',
      'trash.open': '回收站',
      'trash.title': '回收站',
      'trash.loading': '加载中…',
      'trash.empty': '回收站是空的。',
      'trash.restore': '恢复',
      'trash.purge': '彻底删除',
      'trash.emptyAll': '清空回收站',
      'trash.close': '关闭',
      'trash.meta': '{workspace} · 删除于 {time} · {size}',
      'trash.unknownWorkspace': '未知工作区',
      'trash.confirmPurge': '彻底删除「{title}」？此操作不可恢复。',
      'trash.confirmEmpty': '清空回收站里的全部会话？此操作不可恢复。',
      'trash.confirmYes': '确认删除',
      'toast.moved': '已移到回收站：{title}',
      'toast.restored': '已恢复：{title}',
      'toast.purged': '已彻底删除',
      'toast.emptied': '回收站已清空',
      'toast.failed': '操作失败：{message}',
      'edit.button': '编辑这条请求',
      'edit.running': '停止后才能编辑请求',
      'edit.title': '修改这条请求',
      'edit.body': '在下面的输入框里改好内容，确认后会在这条请求之前新建一个分支会话，并把改好的内容填进输入框；发送后就用它替换掉原来那条。',
      'edit.original': '修改内容',
      'edit.trashOriginal': '把原会话移入回收站（7 天内可恢复）',
      'edit.trashOriginalHint': '这样侧边栏里只会留下改好的这个会话',
      'edit.confirm': '新建分支并编辑',
      'toast.branched': '已新建分支，原文已填入输入框，改完回车即可',
      'toast.branchNoSeed': '已新建分支，但没能自动填入输入框，请手动粘贴',
      'toast.branchOriginalKept': '分支已建好，但原会话没能移入回收站：{message}',
    }

    const en = {
      'action.delete': 'Delete',
      'action.deleteNamed': 'Delete session "{title}"',
      'confirm.title': 'Delete session',
      'confirm.body': 'Delete "{title}"?',
      'confirm.note': 'Running work is stopped first, then the session moves to the trash for 7 days.',
      'confirm.open': 'This session is open in the current view. Switch to another session first.',
      'confirm.cancel': 'Cancel',
      'confirm.action': 'Move to trash',
      'busy': 'Working…',
      'trash.open': 'Trash',
      'trash.title': 'Trash',
      'trash.loading': 'Loading…',
      'trash.empty': 'The trash is empty.',
      'trash.restore': 'Restore',
      'trash.purge': 'Delete forever',
      'trash.emptyAll': 'Empty trash',
      'trash.close': 'Close',
      'trash.meta': '{workspace} · deleted {time} · {size}',
      'trash.unknownWorkspace': 'Unknown workspace',
      'trash.confirmPurge': 'Delete "{title}" forever? This cannot be undone.',
      'trash.confirmEmpty': 'Empty every session in the trash? This cannot be undone.',
      'trash.confirmYes': 'Delete forever',
      'toast.moved': 'Moved to trash: {title}',
      'toast.restored': 'Restored: {title}',
      'toast.purged': 'Deleted forever',
      'toast.emptied': 'Trash emptied',
      'toast.failed': 'Failed: {message}',
      'edit.button': 'Edit this request',
      'edit.running': 'Stop the run before editing a request',
      'edit.title': 'Edit last request',
      'edit.body': 'Edit the text below; confirming creates a branch session before that request and loads the edited text into the input box. Sending it replaces the original request.',
      'edit.original': 'Edit the request',
      'edit.trashOriginal': 'Move the original session to the trash (recoverable for 7 days)',
      'edit.trashOriginalHint': 'Only the edited session stays in the sidebar',
      'edit.confirm': 'Branch and edit',
      'toast.branched': 'Branch created; the original text is in the input box',
      'toast.branchNoSeed': 'Branch created, but the input box could not be filled; paste manually',
      'toast.branchOriginalKept': 'Branch created, but the original session could not be trashed: {message}',
    }

    // ---- module state -------------------------------------------------------

    const state = {
      request: null,
      editRequest: null,
      trash: null,
      toast: null,
    }
    const listeners = new Set()
    const bridge = { refreshSessions: () => {}, isOpen: () => false, fork: null, openSession: () => {}, titleOf: () => '' }
    let toastTimer = null

    /** @param listener - re-render callback. */
    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function emit() {
      for (const listener of listeners) listener()
    }

    /** Re-render on every module-state change. */
    function useStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((value) => value + 1)), [])
      return state
    }

    /** @param textKey - toast dictionary key. @param params - interpolation. */
    function showToast(textKey, params) {
      if (toastTimer !== null) clearTimeout(toastTimer)
      state.toast = { textKey, params: params ?? {}, tone: textKey === 'toast.failed' ? 'error' : 'success' }
      emit()
      toastTimer = setTimeout(() => {
        state.toast = null
        toastTimer = null
        emit()
      }, 4200)
      // Node (tests) keeps the loop alive for a browser-shaped timer otherwise.
      if (typeof toastTimer === 'object' && toastTimer !== null && typeof toastTimer.unref === 'function') toastTimer.unref()
    }

    // ---- HTTP ---------------------------------------------------------------

    /** @param action - route suffix. @param body - JSON body; omitted for GET. */
    async function api(action, body) {
      const response = await fetch(`${ENDPOINT}${action}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-dsh-plugin': 'session-tidy',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data === null || data.ok !== true) {
        throw new Error(data?.error?.message ?? `HTTP ${response.status}`)
      }
      return data
    }

    // ---- actions ------------------------------------------------------------

    function askDelete(sessionId, displayTitle) {
      state.request = {
        id: sessionId,
        title: typeof displayTitle === 'string' && displayTitle !== '' ? displayTitle : sessionId,
        busy: false,
        error: null,
      }
      emit()
    }

    function closeRequest() {
      if (state.request !== null && state.request.busy) return
      state.request = null
      emit()
    }

    async function runDelete() {
      const request = state.request
      if (request === null || request.busy) return
      request.busy = true
      request.error = null
      emit()
      try {
        await api('delete', { id: request.id, title: request.title })
        state.request = null
        showToast('toast.moved', { title: request.title })
        bridge.refreshSessions()
        if (state.trash !== null) loadTrash()
      } catch (error) {
        request.busy = false
        request.error = String(error?.message ?? error)
        emit()
      }
    }

    // ---- edit the last request ------------------------------------------------

    /** Storage prefix the conversation plugin uses for per-session drafts. */
    const DRAFT_STORE_PREFIX = 'dsh.conversation.'

    /**
     * Seed the branch's composer draft before the session is opened, so the
     * conversation plugin reads it while creating the input shell.
     * @param sessionId - branch session id.
     * @param text - original request text.
     * @returns whether the draft was persisted.
     */
    function seedDraft(sessionId, text) {
      if (typeof localStorage === 'undefined') return false
      const key = `${DRAFT_STORE_PREFIX}${sessionId}`
      let record = {}
      try {
        const raw = localStorage.getItem(key)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed
        }
      } catch {
        record = {}
      }
      record.draft = { text, references: [] }
      try {
        localStorage.setItem(key, JSON.stringify(record))
        return true
      } catch {
        return false
      }
    }

    /** @param sessionId - source session. @param boundary - inclusive fork cut seq. @param text - its text. */
    function askEdit(sessionId, boundary, text) {
      if (typeof bridge.fork !== 'function') return
      if (typeof boundary !== 'number' || boundary < 0) return
      state.editRequest = {
        sessionId,
        boundary,
        text,
        draft: text,
        title: bridge.titleOf(sessionId) || sessionId,
        trashOriginal: true,
        busy: false,
        error: null,
      }
      emit()
    }

    function closeEdit() {
      if (state.editRequest !== null && state.editRequest.busy) return
      state.editRequest = null
      emit()
    }

    async function runEdit() {
      const request = state.editRequest
      if (request === null || request.busy) return
      request.busy = true
      request.error = null
      emit()
      try {
        const result = await bridge.fork({
          sessionId: request.sessionId,
          atSeq: request.boundary,
          // Replacing keeps the original title; keeping both keeps them apart.
          increaseTitle: !request.trashOriginal,
        })
        const childId = typeof result === 'string' ? result : (result?.value?.sessionId ?? result?.sessionId)
        if (typeof childId !== 'string' || childId === '') throw new Error('fork returned no session id')
        const seeded = seedDraft(childId, request.draft)
        // Belt and braces: if the composer ever mounts without reading that
        // stored draft, the seat applies it through the public input API.
        pendingBranchDraft = { sessionId: childId, text: request.draft, expires: Date.now() + 15000 }
        state.editRequest = null
        emit()
        const opened = bridge.openSession(childId)
        showToast(seeded ? 'toast.branched' : 'toast.branchNoSeed')
        // Only retire the source once the branch is really on screen; a failed
        // switch must not trash the session the user is still looking at.
        if (request.trashOriginal && opened !== false) {
          try {
            await api('delete', { id: request.sessionId, title: request.title })
            bridge.refreshSessions()
            if (state.trash !== null) void loadTrash()
          } catch (error) {
            showToast('toast.branchOriginalKept', { message: String(error?.message ?? error) })
          }
        }
      } catch (error) {
        request.busy = false
        request.error = String(error?.message ?? error)
        emit()
      }
    }

    async function openTrash() {
      state.trash = { entries: [], loading: true, error: null, busyId: null, confirm: null }
      emit()
      await loadTrash()
    }

    function closeTrash() {
      if (state.trash !== null && state.trash.busyId !== null) return
      state.trash = null
      emit()
    }

    async function loadTrash() {
      const current = state.trash
      if (current === null) return
      current.loading = true
      current.error = null
      emit()
      try {
        const data = await api('trash')
        current.entries = Array.isArray(data.entries) ? data.entries : []
      } catch (error) {
        current.error = String(error?.message ?? error)
      }
      current.loading = false
      emit()
    }

    async function restoreEntry(entry) {
      if (state.trash === null || state.trash.busyId !== null) return
      state.trash.busyId = entry.id
      emit()
      try {
        await api('restore', { id: entry.id })
        showToast('toast.restored', { title: entry.title || entry.id })
        bridge.refreshSessions()
      } catch (error) {
        showToast('toast.failed', { message: String(error?.message ?? error) })
      }
      if (state.trash !== null) {
        state.trash.busyId = null
        state.trash.confirm = null
      }
      await loadTrash()
    }

    async function purgeEntry(entry) {
      if (state.trash === null || state.trash.busyId !== null) return
      state.trash.busyId = entry.id
      emit()
      try {
        await api('purge', { id: entry.id })
        showToast('toast.purged')
      } catch (error) {
        showToast('toast.failed', { message: String(error?.message ?? error) })
      }
      if (state.trash !== null) {
        state.trash.busyId = null
        state.trash.confirm = null
      }
      await loadTrash()
    }

    async function emptyTrash() {
      if (state.trash === null || state.trash.busyId !== null) return
      state.trash.busyId = '*'
      emit()
      try {
        await api('empty', {})
        showToast('toast.emptied')
      } catch (error) {
        showToast('toast.failed', { message: String(error?.message ?? error) })
      }
      if (state.trash !== null) {
        state.trash.busyId = null
        state.trash.confirm = null
      }
      await loadTrash()
    }

    // ---- presentation -------------------------------------------------------

    /** @param value - byte count. */
    function formatBytes(value) {
      if (!Number.isFinite(value) || value <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB']
      let size = value
      let unit = 0
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024
        unit += 1
      }
      return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
    }

    /** @param iso - ISO timestamp. */
    function formatTime(iso) {
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? String(iso ?? '') : date.toLocaleString()
    }

    const token = {
      text: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      danger: 'var(--dsw-alias-state-error-primary)',
      dangerHover: 'var(--dsw-alias-interactive-bg-hover-danger)',
      primary: 'var(--dsw-alias-button-primary-fill)',
      primaryHover: 'var(--dsw-alias-button-primary-hover)',
      mask: 'var(--dsw-alias-bg-mask-2)',
    }

    const iconButtonBase = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      padding: '0',
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: token.secondary,
      cursor: 'pointer',
      flex: '0 0 auto',
    }

    const menuRowBase = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '7px 10px',
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: token.text,
      font: 'inherit',
      fontSize: '13px',
      textAlign: 'left',
      cursor: 'pointer',
    }

    /** @param props - icon size and color. */
    function TrashIcon({ size = 14 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4 7h16' }),
        h('path', { d: 'M9 7V5h6v2' }),
        h('path', { d: 'M6 7l1 13h10l1-13' }),
        h('path', { d: 'M10 11v6M14 11v6' }),
      )
    }

    /** @param props - icon size. */
    function RestoreIcon({ size = 14 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4 10a8 8 0 1 1 2.3 7.1' }),
        h('path', { d: 'M4 5v5h5' }),
      )
    }

    /** @param props - click, label, disabled state, and content. */
    function HoverIconButton({ label, onClick, children, style, disabled = false }) {
      const [hovered, setHovered] = React.useState(false)
      return h(
        'button',
        {
          type: 'button',
          title: label,
          'aria-label': label,
          disabled,
          'aria-disabled': disabled || undefined,
          onClick: (event) => {
            event.stopPropagation()
            event.preventDefault()
            if (!disabled) onClick(event)
          },
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: {
            ...iconButtonBase,
            background: hovered && !disabled ? token.hover : 'transparent',
            opacity: disabled ? 0.45 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            ...style,
          },
        },
        children,
      )
    }

    /** @param props - menu row content. */
    function HoverMenuRow({ label, icon, onClick, danger, setMenuOpen }) {
      const [hovered, setHovered] = React.useState(false)
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          onClick: (event) => {
            event.stopPropagation()
            if (typeof setMenuOpen === 'function') setMenuOpen(false)
            onClick()
          },
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: {
            ...menuRowBase,
            background: hovered ? token.hover : 'transparent',
            color: danger ? token.danger : token.text,
          },
        },
        icon,
        h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
      )
    }

    /** @param props - button look and behavior. */
    function ActionButton({ children, onClick, variant = 'outline', disabled = false }) {
      const [hovered, setHovered] = React.useState(false)
      const filled = variant === 'primary' || variant === 'danger'
      const base = {
        padding: '7px 14px',
        borderRadius: '8px',
        border: `1px solid ${variant === 'danger' ? token.danger : token.border}`,
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 120ms ease',
      }
      // Filled buttons take their label from the theme: in the dark theme the
      // primary fill is near-white, so a hardcoded white label disappears.
      const paint = filled
        ? variant === 'danger'
          ? { background: token.danger, color: '#ffffff', filter: hovered ? 'brightness(0.92)' : 'none' }
          : {
              background: hovered ? token.primaryHover : token.primary,
              color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
              filter: 'none',
            }
        : { background: hovered ? token.hover : 'transparent', color: token.text, filter: 'none' }
      return h(
        'button',
        {
          type: 'button',
          disabled,
          onClick,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: { ...base, ...paint },
        },
        children,
      )
    }

    /** @param props - dialog frame. */
    function Modal({ title, children, footer, onClose, wide = false }) {
      const dialogRef = React.useRef(null)
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [onClose])
      React.useEffect(() => {
        if (dialogRef.current !== null) dialogRef.current.focus()
      }, [])
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: token.mask,
            zIndex: 1200,
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          {
            ref: dialogRef,
            tabIndex: -1,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': title,
            style: {
              width: wide ? 'min(560px, 100%)' : 'min(440px, 100%)',
              maxHeight: 'min(80vh, 720px)',
              display: 'flex',
              flexDirection: 'column',
              padding: '20px',
              border: `1px solid ${token.border}`,
              borderRadius: '12px',
              background: token.layer1,
              color: token.text,
              boxShadow: '0 18px 48px rgba(0, 0, 0, 0.28)',
              outline: 'none',
            },
          },
          h('div', { style: { fontSize: '16px', fontWeight: 600, marginBottom: '10px' } }, title),
          h('div', { style: { overflow: 'auto', flex: '1 1 auto' } }, children),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' } }, footer),
        ),
      )
    }

    /** The session-row hover action and its menu row. */
    function DeleteRowButton({ sessionId, displayTitle, t }) {
      return h(
        HoverIconButton,
        { label: t('action.deleteNamed', { title: displayTitle || sessionId }), onClick: () => askDelete(sessionId, displayTitle) },
        h(TrashIcon, { size: 14 }),
      )
    }

    /** @param props - menu occurrence props. */
    function DeleteMenuItem({ sessionId, displayTitle, t, useMenuOpenState }) {
      const setMenuOpen = typeof useMenuOpenState === 'function' ? useMenuOpenState()[1] : undefined
      return h(HoverMenuRow, {
        label: t('action.delete'),
        icon: h(TrashIcon, { size: 14 }),
        danger: true,
        setMenuOpen,
        onClick: () => askDelete(sessionId, displayTitle),
      })
    }

    // ---- edit-the-last-request seat ----------------------------------------

    /**
     * The content text of one user message node.
     * @param content - raw user/message content (parts, prepared text, or string).
     * @returns the plain text the composer can take back.
     */
    function textOfContent(content) {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .filter((part) => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('')
      }
      if (content !== null && typeof content === 'object' && typeof content.text === 'string') return content.text
      return ''
    }

    /**
     * One chat node as an edit target.
     * @param node - chat projection node.
     * @returns the request seq and text, or null for anything not editable.
     */
    function editTargetOf(node) {
      if (node === null || typeof node !== 'object' || node.kind !== 'user') return null
      const seq = node.data?.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null
      const text = textOfContent(node.data?.content)
      if (text.trim() === '') return null
      return { seq, text }
    }

    /**
     * The seq a fork should cut at so the branch ends on a completed turn.
     * Cutting at `userSeq - 1` lands inside the turn (its `turn/start` and
     * `step/start` precede the message), and the Host then closes that empty
     * turn with a synthetic "forked" ending — which renders as a stray
     * "已完成，用时 1 秒" line above the draft. So prefer the closing seq of the
     * last completed turn, skipping empty turns left by earlier edits.
     * @param nodes - chat node store.
     * @param order - visible chat node keys.
     * @param key - the clicked message node key.
     * @param node - the clicked chat node.
     * @returns the inclusive cut seq, or null when it cannot be derived.
     */
    function forkBoundaryFor(nodes, order, key, node) {
      const seq = node?.data?.seq
      const fallback = typeof seq === 'number' && seq > 0 ? seq - 1 : null
      if (Array.isArray(order) && typeof order.indexOf === 'function') {
        const index = order.indexOf(key)
        for (let i = index - 1; i >= 0; i -= 1) {
          const candidate = nodes.get(order[i])
          if (candidate === null || candidate === undefined || candidate.kind !== 'turn-tail') continue
          let before = null
          for (let j = i - 1; j >= 0; j -= 1) {
            const previous = nodes.get(order[j])
            if (previous !== null && previous !== undefined) {
              before = previous.kind
              break
            }
          }
          // Adjacent tails mean the turn between them rendered nothing: an
          // empty fork leaf from an earlier edit, not a real exchange.
          if (before !== null && before !== 'turn-tail') {
            const cut = candidate.data?.seq
            if (typeof cut === 'number' && cut > 0) return cut
          }
        }
      }
      const turnStart = node?.location?.turn?.start?.seq
      // Skip the pending-inbox splice that sits right before `turn/start`.
      if (typeof turnStart === 'number' && turnStart > 1) return turnStart - 2
      return fallback
    }

    // ---- per-message edit buttons --------------------------------------------
    //
    // The shipped user bubble renders its copy/time row itself and exposes no
    // Slot, so the pencil is injected into that row (`[data-clock="start"]`
    // inside the `[data-chat-flow-kind="user"]` flow item). The chat flow puts
    // the node key on the wrapper, which is how the click finds the message.

    /** Marks an injected pencil and carries its row; never rendered by React. */
    const EDIT_ATTR = 'data-session-tidy-edit'
    const EDIT_CSS_ID = 'dsh-session-tidy-edit'
    const PENCIL_SVG =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 20l4.5-1.2L19 8.3a2 2 0 0 0-2.8-2.8L5.2 16 4 20z"/><path d="M14.4 7.6l2 2"/></svg>'
    const EDIT_CSS = `
[${EDIT_ATTR}]{box-sizing:border-box;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;transition:opacity 80ms,background 120ms}
[${EDIT_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
[${EDIT_ATTR}]:disabled{opacity:.4!important;cursor:default;background:transparent}
[${EDIT_ATTR}] svg{width:15px;height:15px;display:block}
@media (hover:hover){
  [${EDIT_ATTR}]{opacity:0;pointer-events:none}
  [data-chat-flow-kind="user"]:hover [${EDIT_ATTR}],
  [data-chat-flow-kind="user"]:focus-within [${EDIT_ATTR}]{opacity:1;pointer-events:auto}
}
@media (hover:none){[${EDIT_ATTR}]{opacity:1;pointer-events:auto}}
`

    /** Whether a node key resolves to an editable request on this connection. */
    function nodeForEdit(nodes, key) {
      if (nodes === null || typeof nodes !== 'object' || typeof nodes.get !== 'function') return null
      if (typeof key !== 'string' || key === '') return null
      let node
      try {
        node = nodes.get(key)
      } catch {
        return null
      }
      const target = editTargetOf(node)
      return target === null ? null : { ...target, node }
    }

    /**
     * Mounts for every session and decorates each user bubble with a pencil
     * that shows on hover. Renders nothing; it needs the session scope's
     * `useChat` / `sessionId`, so it steps aside when they are absent.
     * @param props - scope props.
     */
    function BubbleEditSeat(props) {
      if (typeof props.useChat !== 'function' || typeof props.useSession !== 'function') return null
      return h(BubbleEditDecorator, props)
    }

    /** @param props - session id, standard sources, translator. */
    function BubbleEditDecorator({ sessionId, useChat, useSession, t, inputActions }) {
      const nodes = useChat((snapshot) => snapshot?.nodes ?? null)
      const order = useChat((snapshot) => snapshot?.order ?? null)
      const running = useSession((snapshot) => snapshot?.running === true)
      const tRef = React.useRef(t)
      tRef.current = t
      const runningRef = React.useRef(running)
      runningRef.current = running
      const orderRef = React.useRef(order)
      orderRef.current = order

      React.useEffect(() => {
        const pending = pendingBranchDraft
        if (pending === null || pending.sessionId !== sessionId) return
        if (Date.now() > pending.expires) {
          pendingBranchDraft = null
          return
        }
        if (typeof inputActions?.setDraft !== 'function') return
        pendingBranchDraft = null
        inputActions.setDraft(pending.text)
      }, [sessionId, inputActions])

      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof sessionId !== 'string' || sessionId === '') return undefined
        if (nodes === null || typeof nodes.get !== 'function') return undefined

        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-session-tidy')
        style.setAttribute('data-plugin-css', EDIT_CSS_ID)
        style.textContent = EDIT_CSS
        document.head.appendChild(style)

        let scheduled = false
        const decorate = () => {
          scheduled = false
          const rows = document.querySelectorAll('[data-chat-flow-kind="user"][data-chat-node-key]')
          for (const row of rows) {
            const actions = row.querySelector('[data-clock="start"]')
            if (actions === null || actions.querySelector(`[${EDIT_ATTR}]`) !== null) continue
            const key = row.dataset.chatNodeKey
            if (nodeForEdit(nodes, key) === null) continue
            const button = document.createElement('button')
            button.setAttribute(EDIT_ATTR, '')
            button.setAttribute('type', 'button')
            button.title = tRef.current('edit.button')
            button.setAttribute('aria-label', tRef.current('edit.button'))
            button.innerHTML = PENCIL_SVG
            button.disabled = runningRef.current
            button.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              if (runningRef.current) return
              const target = nodeForEdit(nodes, key)
              if (target === null) return
              askEdit(sessionId, forkBoundaryFor(nodes, orderRef.current, key, target.node), target.text)
            })
            actions.insertBefore(button, actions.firstChild)
          }
        }
        const schedule = () => {
          if (scheduled) return
          scheduled = true
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(decorate)
          else setTimeout(decorate, 0)
        }
        const observer =
          typeof MutationObserver === 'function'
            ? new MutationObserver((records) => {
                for (const record of records) {
                  for (const added of record.addedNodes) {
                    if (added?.nodeType !== 1) continue
                    if (added.matches?.('[data-chat-flow-kind="user"]') || added.querySelector?.('[data-chat-flow-kind="user"]')) {
                      schedule()
                      return
                    }
                  }
                  for (const removed of record.removedNodes) {
                    if (removed?.nodeType !== 1) continue
                    if (removed.matches?.(`[${EDIT_ATTR}]`) || removed.querySelector?.(`[${EDIT_ATTR}]`)) {
                      schedule()
                      return
                    }
                  }
                }
              })
            : null
        observer?.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
        decorate()

        return () => {
          observer?.disconnect()
          style.remove()
          for (const button of document.querySelectorAll(`[${EDIT_ATTR}]`)) button.remove()
        }
      }, [sessionId, nodes])

      React.useEffect(() => {
        if (typeof document === 'undefined') return
        const label = running ? tRef.current('edit.running') : tRef.current('edit.button')
        for (const button of document.querySelectorAll(`[${EDIT_ATTR}]`)) {
          button.disabled = running
          button.title = label
          button.setAttribute('aria-label', label)
        }
      }, [running])

      return null
    }

    /** A branch that still needs its draft applied through the input API. */
    let pendingBranchDraft = null

    /** @param props - pending edit request. */
    function EditRequestDialog({ request, t }) {
      const areaRef = React.useRef(null)
      React.useEffect(() => {
        const area = areaRef.current
        if (area === null) return
        area.focus()
        const end = area.value.length
        try {
          area.setSelectionRange(end, end)
        } catch {
          // Selection is a nicety; focus already worked.
        }
      }, [])
      const empty = request.draft.trim() === ''
      return h(
        Modal,
        {
          title: t('edit.title'),
          onClose: closeEdit,
          footer: [
            h(ActionButton, { key: 'cancel', onClick: closeEdit, disabled: request.busy }, t('confirm.cancel')),
            h(
              ActionButton,
              { key: 'ok', variant: 'primary', onClick: () => void runEdit(), disabled: request.busy || empty },
              request.busy ? t('busy') : t('edit.confirm'),
            ),
          ],
        },
        h('div', { style: { fontSize: '14px', lineHeight: 1.6 } }, t('edit.body')),
        h('div', { style: { marginTop: '14px', fontSize: '12px', color: token.secondary } }, t('edit.original')),
        h('textarea', {
          ref: areaRef,
          value: request.draft,
          disabled: request.busy,
          spellCheck: false,
          onChange: (event) => {
            request.draft = event.target.value
            emit()
          },
          style: {
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            marginTop: '6px',
            padding: '10px',
            border: `1px solid ${token.border}`,
            borderRadius: '8px',
            background: token.layer2,
            color: token.text,
            font: 'inherit',
            fontSize: '13px',
            lineHeight: 1.6,
            resize: 'vertical',
            minHeight: '110px',
            maxHeight: '260px',
            outline: 'none',
          },
        }),
        h(
          'label',
          {
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              marginTop: '14px',
              fontSize: '12px',
              lineHeight: 1.5,
              color: token.text,
              cursor: request.busy ? 'default' : 'pointer',
            },
          },
          h('input', {
            type: 'checkbox',
            checked: request.trashOriginal,
            disabled: request.busy,
            onChange: (event) => {
              request.trashOriginal = event.target.checked
              emit()
            },
            style: { marginTop: '2px', accentColor: token.primary, cursor: 'inherit' },
          }),
          h(
            'span',
            null,
            t('edit.trashOriginal'),
            h('span', { style: { display: 'block', fontSize: '11px', color: token.secondary, marginTop: '2px' } }, t('edit.trashOriginalHint')),
          ),
        ),
        request.error === null
          ? null
          : h(
              'div',
              { role: 'alert', style: { marginTop: '12px', fontSize: '12px', color: token.danger } },
              t('toast.failed', { message: request.error }),
            ),
      )
    }

    /** @param props - pending delete request. */
    function ConfirmDeleteDialog({ request, t }) {
      const open = bridge.isOpen(request.id)
      const confirm = () => {
        void runDelete()
      }
      return h(
        Modal,
        {
          title: t('confirm.title'),
          onClose: closeRequest,
          footer: [
            h(ActionButton, { key: 'cancel', onClick: closeRequest, disabled: request.busy }, t('confirm.cancel')),
            h(
              ActionButton,
              { key: 'ok', variant: 'danger', onClick: confirm, disabled: request.busy || open },
              request.busy ? t('busy') : t('confirm.action'),
            ),
          ],
        },
        h('div', { style: { fontSize: '14px', lineHeight: 1.6 } }, t('confirm.body', { title: request.title })),
        h('div', { style: { fontSize: '12px', color: token.secondary, marginTop: '8px' } }, t('confirm.note')),
        open
          ? h(
              'div',
              {
                style: {
                  marginTop: '12px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: token.danger,
                  background: token.dangerHover,
                },
              },
              t('confirm.open'),
            )
          : null,
        request.error === null
          ? null
          : h(
              'div',
              { role: 'alert', style: { marginTop: '12px', fontSize: '12px', color: token.danger } },
              t('toast.failed', { message: request.error }),
            ),
      )
    }

    /** @param props - one trash entry row. */
    function TrashRow({ entry, t, busy, onRestore, onAskPurge }) {
      const title = entry.title || entry.id
      const meta = t('trash.meta', {
        workspace: entry.workspaceTitle || t('trash.unknownWorkspace'),
        time: formatTime(entry.deletedAt),
        size: formatBytes(entry.size),
      })
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 0',
            borderBottom: `1px solid ${token.border}`,
          },
        },
        h(
          'div',
          { style: { minWidth: 0, flex: '1 1 auto' } },
          h('div', { style: { fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
          h('div', { style: { fontSize: '11px', color: token.secondary, marginTop: '2px' } }, meta),
        ),
        busy
          ? h('span', { style: { fontSize: '12px', color: token.secondary } }, t('busy'))
          : h(
              React.Fragment,
              null,
              h(HoverIconButton, { label: t('trash.restore'), onClick: () => onRestore(entry) }, h(RestoreIcon, { size: 15 })),
              h(HoverIconButton, { label: t('trash.purge'), onClick: () => onAskPurge(entry) }, h(TrashIcon, { size: 15 })),
            ),
      )
    }

    /** @param props - trash dialog. */
    function TrashDialog({ trash, t }) {
      const confirm = trash.confirm
      return h(
        React.Fragment,
        null,
        h(
          Modal,
          {
            title: t('trash.title'),
            wide: true,
            onClose: closeTrash,
            footer: [
              h(
                ActionButton,
                {
                  key: 'empty',
                  variant: 'outline',
                  disabled: trash.entries.length === 0 || trash.busyId !== null,
                  onClick: () => {
                    trash.confirm = { kind: 'empty' }
                    emit()
                  },
                },
                t('trash.emptyAll'),
              ),
              h(ActionButton, { key: 'close', onClick: closeTrash, disabled: trash.busyId !== null }, t('trash.close')),
            ],
          },
          h(
            'div',
            { style: { minHeight: '120px' } },
            trash.loading && trash.entries.length === 0
              ? h('div', { style: { fontSize: '13px', color: token.secondary } }, t('trash.loading'))
              : null,
            !trash.loading && trash.entries.length === 0
              ? h('div', { style: { fontSize: '13px', color: token.secondary } }, t('trash.empty'))
              : null,
            trash.entries.map((entry) =>
              h(TrashRow, {
                key: entry.dirName ?? entry.id,
                entry,
                t,
                busy: trash.busyId === entry.id,
                onRestore: (item) => void restoreEntry(item),
                onAskPurge: (item) => {
                  trash.confirm = { kind: 'purge', id: item.id, title: item.title || item.id }
                  emit()
                },
              }),
            ),
            trash.error === null
              ? null
              : h('div', { role: 'alert', style: { marginTop: '10px', fontSize: '12px', color: token.danger } }, trash.error),
          ),
        ),
        confirm === null
          ? null
          : h(
              Modal,
              {
                title: t('trash.purge'),
                onClose: () => {
                  trash.confirm = null
                  emit()
                },
                footer: [
                  h(
                    ActionButton,
                    {
                      key: 'cancel',
                      onClick: () => {
                        trash.confirm = null
                        emit()
                      },
                    },
                    t('confirm.cancel'),
                  ),
                  h(
                    ActionButton,
                    {
                      key: 'yes',
                      variant: 'danger',
                      disabled: trash.busyId !== null,
                      onClick: () => {
                        if (confirm.kind === 'empty') void emptyTrash()
                        else {
                          const entry = trash.entries.find((item) => item.id === confirm.id)
                          if (entry !== undefined) void purgeEntry(entry)
                        }
                      },
                    },
                    t('trash.confirmYes'),
                  ),
                ],
              },
              h(
                'div',
                { style: { fontSize: '13px', lineHeight: 1.6 } },
                confirm.kind === 'empty' ? t('trash.confirmEmpty') : t('trash.confirmPurge', { title: confirm.title }),
              ),
            ),
      )
    }

    /** @param props - transient notice. */
    function Toast({ toast, t }) {
      const danger = toast.tone === 'error'
      return h(
        'div',
        {
          role: 'status',
          style: {
            position: 'fixed',
            left: '50%',
            bottom: '28px',
            transform: 'translateX(-50%)',
            maxWidth: 'min(560px, calc(100vw - 48px))',
            padding: '10px 14px',
            border: `1px solid ${danger ? token.danger : token.border}`,
            borderRadius: '10px',
            background: token.layer2,
            color: danger ? token.danger : token.text,
            fontSize: '13px',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.24)',
            zIndex: 1300,
          },
        },
        t(toast.textKey, toast.params),
      )
    }

    /** The `shell.overlay` entry: dialogs and the plugin's own notice. */
    function Overlay({ t }) {
      const snapshot = useStore()
      const request = snapshot.request
      const editRequest = snapshot.editRequest
      const trash = snapshot.trash
      const toast = snapshot.toast
      if (request === null && editRequest === null && trash === null && toast === null) return null
      return h(
        React.Fragment,
        null,
        request === null ? null : h(ConfirmDeleteDialog, { key: `delete-${request.id}`, request, t }),
        editRequest === null ? null : h(EditRequestDialog, { key: `edit-${editRequest.sessionId}`, request: editRequest, t }),
        trash === null ? null : h(TrashDialog, { key: 'trash', trash, t }),
        toast === null ? null : h(Toast, { key: 'toast', toast, t }),
      )
    }

    /** The sidebar foot action that opens the trash. */
    function TrashFooterButton({ t }) {
      return h(
        HoverIconButton,
        { label: t('trash.open'), onClick: () => void openTrash(), style: { width: '28px', height: '28px' } },
        h(TrashIcon, { size: 17 }),
      )
    }

    // ---- plugin -------------------------------------------------------------

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        bridge.refreshSessions = () => {
          try {
            if (typeof ctx.sessions?.refresh === 'function') {
              const pending = ctx.sessions.refresh()
              if (pending !== undefined && typeof pending.catch === 'function') pending.catch(() => {})
            }
            // The Host publishes the archived/restored workspace state over the
            // connection, so the sidebar row updates without a manual reload.
          } catch {
            // A missing refresh hook is not fatal: the subscription still pushes.
          }
        }
        bridge.isOpen = (sessionId) => {
          try {
            return ctx.sessions.binding(sessionId) !== undefined
          } catch {
            return false
          }
        }
        const sessions = ctx.sessions
        bridge.fork = typeof sessions?.fork === 'function' ? (options) => sessions.fork(options) : null
        bridge.openSession = (sessionId) => {
          try {
            ctx.uiWorkspace.openSession(sessionId)
            return true
          } catch {
            // Opening the branch is best-effort; the branch still exists.
            return false
          }
        }
        bridge.titleOf = (sessionId) => {
          try {
            const snapshot = ctx.sessions?.list?.getSnapshot?.()
            const summary = snapshot?.byId?.[sessionId]
            return summary?.displayTitle ?? summary?.title ?? ''
          } catch {
            return ''
          }
        }

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-tidy: dictionaries')

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'session-tidy.delete', order: 500, locale: NS },
            DeleteMenuItem,
          ),
        )
        ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.row.action', id: 'session-tidy.delete', order: 300, locale: NS },
            DeleteRowButton,
          ),
        )
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'session-tidy.trash', order: 10, locale: NS },
            TrashFooterButton,
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'session-tidy.overlay', locale: NS }, Overlay),
        )
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'session-tidy.bubble-edit', order: 200, locale: NS },
            BubbleEditSeat,
          ),
        )
      },
    }
  },
})