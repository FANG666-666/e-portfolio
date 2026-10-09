import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.ts'
import type { TodoRow } from './supabase.ts'
import type { Priority, Todo } from './types.ts'
import './App.css'

const STORAGE_KEY = 'projects.todos.v1'

const PRIORITIES: { key: Priority; label: string; emoji: string }[] = [
  { key: 'low', label: 'Low', emoji: '🟢' },
  { key: 'medium', label: 'Medium', emoji: '🟡' },
  { key: 'high', label: 'High', emoji: '🔴' },
]

type SyncMode = 'checking' | 'online' | 'offline'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID()
    } catch {
      // fall through to fallback
    }
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.map((t: Partial<Todo>): Todo => ({
      id: t.id ?? newId(),
      text: t.text ?? '',
      date: t.date ?? '',
      done: !!t.done,
      priority: t.priority ?? 'medium',
    }))
  } catch {
    return []
  }
}

function rowToTodo(r: TodoRow): Todo {
  return {
    id: String(r.id),
    text: r.task ?? '',
    date: r.date ?? '',
    done: !!r.is_complete,
    priority: (r.priority as Priority) ?? 'medium',
  }
}

function todayIso(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${y}/${m}/${d}`
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [syncMode, setSyncMode] = useState<SyncMode>('checking')
  const [text, setText] = useState('')
  const [date, setDate] = useState<string>(todayIso())
  const [priority, setPriority] = useState<Priority>('medium')
  const [burst, setBurst] = useState<{ x: number; y: number; key: number } | null>(
    null,
  )

  // Try to sync with the cloud `todos` table on mount. If the network or
  // CORS blocks us (e.g. opened via file://), fall back to localStorage.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('todos')
          .select('id, task, date, is_complete, priority, created_at')
          .order('created_at', { ascending: true })
        if (error) throw error
        if (!mounted) return
        setTodos((data ?? []).map(rowToTodo))
        setSyncMode('online')
      } catch {
        if (mounted) setSyncMode('offline')
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Always cache to localStorage so offline edits survive a reload, and the
  // file://-opened demo still works even when the cloud is unreachable.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    if (!burst) return
    const t = setTimeout(() => setBurst(null), 950)
    return () => clearTimeout(t)
  }, [burst])

  const sortedTodos = useMemo(
    () =>
      [...todos].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1
        return a.date.localeCompare(b.date)
      }),
    [todos],
  )

  const total = todos.length
  const completed = todos.filter((t) => t.done).length

  const particles = useMemo(() => {
    if (!burst) return []
    const emojis = ['🎉', '✨', '⭐', '💫', '🎊', '🌟', '🎈']
    return Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const dist = 45 + Math.random() * 55
      const dx = Math.cos(angle) * dist
      const dy = Math.sin(angle) * dist - 25
      const rot = (Math.random() - 0.5) * 720
      const delay = Math.random() * 80
      return { emoji: emojis[i % emojis.length], dx, dy, rot, delay }
    })
  }, [burst])

  async function addTodo() {
    const value = text.trim()
    if (!value) return
    const taskDate = date || todayIso()
    setText('')

    if (syncMode === 'online') {
      try {
        const { data, error } = await supabase
          .from('todos')
          .insert({
            task: value,
            date: taskDate,
            is_complete: false,
            priority,
          })
          .select('id, task, date, is_complete, priority, created_at')
          .single()
        if (error) throw error
        if (data) setTodos((prev) => [...prev, rowToTodo(data as TodoRow)])
        return
      } catch {
        setSyncMode('offline')
      }
    }
    // Offline fallback (also used after a mid-flight cloud failure).
    setTodos((prev) => [
      ...prev,
      { id: newId(), text: value, date: taskDate, done: false, priority },
    ])
  }

  function toggleTodo(
    id: string,
    e?: React.ChangeEvent<HTMLInputElement>,
  ) {
    const todo = todos.find((t) => t.id === id)
    if (!todo) return
    const justCompleted = !todo.done
    const rect = e ? e.currentTarget.getBoundingClientRect() : null
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    )
    if (justCompleted && rect) {
      setBurst({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        key: Date.now(),
      })
    }
    if (syncMode === 'online') {
      supabase
        .from('todos')
        .update({ is_complete: !todo.done })
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            setSyncMode('offline')
            // revert the optimistic flip
            setTodos((prev) =>
              prev.map((t) => (t.id === id ? { ...t, done: todo.done } : t)),
            )
          }
        })
    }
  }

  function deleteTodo(id: string) {
    const snapshot = todos
    setTodos((prev) => prev.filter((t) => t.id !== id))
    if (syncMode === 'online') {
      supabase
        .from('todos')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            setSyncMode('offline')
            setTodos(snapshot) // restore
          }
        })
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') addTodo()
  }

  const syncLabel =
    syncMode === 'checking'
      ? 'Connecting to cloud…'
      : syncMode === 'online'
        ? 'Synced with cloud'
        : 'Offline — saved to this browser only'
  const syncTitle =
    syncMode === 'offline'
      ? 'Cloud sync unavailable (likely opened via file://). Serve via http(s) to sync with the todos table.'
      : syncLabel

  return (
    <div className="page">
      <main className="app">
        <header className="app__header">
          <h1>Projects</h1>
          <p className="app__sub">{completed} of {total} tasks completed</p>
          <p className={`sync sync--${syncMode}`} title={syncTitle}>
            <span className="sync__dot" aria-hidden="true" />
            {syncLabel}
          </p>
        </header>

        <section className="add-form" aria-label="Add task">
          <div className="add-form__row">
            <input
              className="add-form__text"
              type="text"
              placeholder="Add a task..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="add-form__row add-form__row--priority">
            <span className="add-form__date-label">Priority</span>
            <div className="priority" role="group" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`priority__btn priority__btn--${p.key} ${
                    priority === p.key ? 'priority__btn--active' : ''
                  }`}
                  onClick={() => setPriority(p.key)}
                  aria-pressed={priority === p.key}
                >
                  <span className="priority__emoji" aria-hidden="true">
                    {p.emoji}
                  </span>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="add-form__row add-form__row--controls">
            <label className="add-form__date">
              <span className="add-form__date-label">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <button
              className="add-form__btn"
              type="button"
              onClick={addTodo}
              disabled={!text.trim()}
            >
              Add
            </button>
          </div>
        </section>

        <ul className="todo-list">
          {sortedTodos.map((t) => (
            <li key={t.id} className={`todo ${t.done ? 'todo--done' : ''}`}>
              <label className="todo__check">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) => toggleTodo(t.id, e)}
                />
                <span className="todo__check-box" aria-hidden="true" />
              </label>
              <div className="todo__body">
                <div className="todo__head">
                  <span
                    className={`badge badge--${t.priority}`}
                    aria-label={`Priority: ${t.priority}`}
                  >
                    {PRIORITIES.find((p) => p.key === t.priority)?.emoji}
                  </span>
                  <span className="todo__text">{t.text}</span>
                </div>
                {t.date && <span className="todo__date">{formatDate(t.date)}</span>}
              </div>
              <button
                className="todo__del"
                type="button"
                aria-label="Delete"
                onClick={() => deleteTodo(t.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {sortedTodos.length === 0 && (
          <p className="empty">No tasks yet. Add your first one.</p>
        )}
      </main>

      {burst && (
        <div
          className="confetti"
          style={{ left: burst.x, top: burst.y }}
          aria-hidden="true"
        >
          {particles.map((p, i) => (
            <span
              key={i}
              className="confetti__bit"
              style={
                {
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  '--rot': `${p.rot}deg`,
                  animationDelay: `${p.delay}ms`,
                } as React.CSSProperties
              }
            >
              {p.emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
