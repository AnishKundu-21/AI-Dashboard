import { useState } from 'react'
import { Modal } from './Modal'
import { VIEWS, type ViewId } from './SideNav'
import { IconSearch } from './Icons'

export function CommandPalette({ onClose, onView, onRefresh, onTheme }: {
  onClose: () => void
  onView: (view: ViewId) => void
  onRefresh: () => void
  onTheme: () => void
}) {
  const [query, setQuery] = useState('')
  const commands = [
    ...VIEWS.map((view) => ({ label: `Go to ${view.label}`, detail: 'Navigate', run: () => onView(view.id) })),
    { label: 'Refresh usage', detail: 'Action', run: onRefresh },
    { label: 'Switch colour theme', detail: 'Appearance', run: onTheme }
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
  const run = (action: () => void) => { onClose(); action() }
  return <Modal title="Quick actions" onClose={onClose}>
    <div className="command-search"><IconSearch size={18} /><input autoFocus placeholder="Where would you like to go?"
      aria-label="Find an action" value={query} onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && commands[0]) run(commands[0].run) }} /></div>
    <div className="command-list">{commands.map((item) => <button key={item.label} onClick={() => run(item.run)}>
      <span>{item.label}</span><small>{item.detail}</small>
    </button>)}{commands.length === 0 && <p className="empty">No matching actions.</p>}</div>
    <p className="command-hint">Tab to move · Enter to open · Esc to close</p>
  </Modal>
}

export function Appearance({ theme, onTheme, density, onDensity }: {
  theme: 'light' | 'dark'
  onTheme: (theme: 'light' | 'dark') => void
  density: 'comfortable' | 'compact'
  onDensity: (density: 'comfortable' | 'compact') => void
}) {
  return <article className="panel appearance-panel">
    <div className="card-head"><div><h3>Appearance</h3><p>Your workspace, your preference. Saved on this device.</p></div></div>
    <div className="appearance-options">
      <div><span className="eyebrow">Colour theme</span><div className="theme-options">
        {(['dark', 'light'] as const).map((value) => <button key={value} className={`theme-choice ${value}`} aria-pressed={theme === value} onClick={() => onTheme(value)}>
          <span className="theme-preview"><i /><i /><i /></span><span>{value === 'dark' ? 'Graphite' : 'Daylight'}</span><small>{theme === value ? 'Selected' : 'Select'}</small>
        </button>)}
      </div></div>
      <div><span className="eyebrow">Display density</span><div className="density-options">
        {(['comfortable', 'compact'] as const).map((value) => <button className="btn" key={value} aria-pressed={density === value} onClick={() => onDensity(value)}>{value === 'comfortable' ? 'Comfortable' : 'Compact'}</button>)}
      </div><p>Motion follows your system accessibility preference.</p></div>
    </div>
  </article>
}
