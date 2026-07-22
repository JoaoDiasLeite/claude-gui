import { useRef } from 'react'
import { useModalA11y } from '../hooks/useModalA11y'
import './ChangelogModal.css'

interface Props {
  onClose: () => void
}

interface Entry {
  version: string
  date: string
  tag?: 'latest' | 'new'
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: Entry[] = [
  {
    version: '0.5.1',
    date: '2026-07-22',
    tag: 'latest',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Chat terminal no longer flashes a spurious "process exited" line and a bare shell on open — a duplicate pty spawned by React\'s dev double-mount is now reused instead of being killed and recreated.',
          'The embedded terminal now opens the shell that matches the chat\'s environment — local, WSL, or an interactive SSH session for remote chats — and launches the right provider CLI inside it, with a clear message if a CLI can\'t be found instead of a bare shell.',
        ],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-07-20',
    sections: [
      {
        title: 'Features',
        items: [
          'Sprint mode in the Planner — a Week/Sprint toggle adds a Scrum board with a drag-and-drop To do / In progress / Done kanban, story points, a points burndown chart, and a daily standup log Claude can draft from your recent git commits and board.',
          'Backfill a sprint backlog from GitLab — the board reads open issues through your project’s configured GitLab MCP (local or inside WSL), first showing which project it’s attributed to, then letting you pick which issues to import as backlog items.',
          'Discuss or schedule your standup — talk through the day in a light, tools-off chat seeded with the standup and board, or one-click create a daily standup routine (read-only, starts disabled) from the sprint.',
          'Sprint board interactions — item checkboxes step through To do → In progress → Done (un-checking Done restores the previous state), each column has a check-all to advance its items, and the GitLab backfill caches its last result so re-opening is instant and only surfaces issues not already on the board.',
          'Conversation branching — fork a chat from any message into a new session; copied history stays visible and context carries over automatically.',
          'Attach any text file to a message via drag-and-drop or the attach button (up to 5 files, 200 KB each); contents ride along with the prompt.',
          'SSH key management in Remote & WSL — discover keys in ~/.ssh, copy public keys with a ready authorized_keys one-liner, generate ed25519 keys, and pick a key per host.',
          'Rooms can be renamed inline and reordered, with layout persisted across restarts.',
          'Context indicator under the chat input shows the real token footprint re-sent each turn, with amber/red escalation as it grows.',
        ],
      },
      {
        title: 'Improvements',
        items: [
          'The long-session warning now triggers on the actual context size (~120k tokens) instead of message count.',
          'Chats no longer load global plugin/skill marketplaces into context — only project settings and per-project permission allowlists; light mode is fully isolated.',
          'Background utility calls (compact, planner assist, agent suggestions) run with no settings tiers at all, cutting their token overhead.',
          'Startup window color follows the configured theme, removing the dark flash on launch for light-theme users.',
          'Plan-usage badge refreshes immediately after switching the default account.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Component stylesheets no longer leak into each other — shared primitives (modals, buttons, inputs, toggles) moved to one canonical stylesheet and all accidental class-name collisions were removed.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-09',
    sections: [
      {
        title: 'Features',
        items: [
          'Account selection is now app-wide — switching an account sets the default for all new chats; existing sessions stay bound to the account that created them.',
          'Sidebar status row doubles as the default-account picker when multiple accounts are connected (chevron + dropdown, keyboard & outside-click dismiss).',
          'Nav rail consolidated — Agents, Planner and Servers are each grouped under a single rail entry with a segmented sub-nav.',
          'One-click restart button appears in the status bar once an update has been downloaded.',
        ],
      },
      {
        title: 'Improvements',
        items: [
          'Chat toolbar decluttered — tool calls collapsed into a single summary chip; model picker moved to a compact toggle group.',
          'Chat transcript and input aligned to a fixed 820 px reading column.',
          'Flat opaque surfaces replace the acrylic glass aesthetic for better contrast and readability.',
          'Session cards, activity log and corner radii polished throughout.',
          'Plan session badge on the sidebar now tracks the default account rather than a hardcoded primary key.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Account pill shows the account name only; email / plan live in the tooltip so the row never ellipsises.',
          'Sidebar account row CSS class collision with AccountsModal resolved.',
          'JSON files with a UTF-8 BOM are now read correctly.',
          'Usage chip in the chat header counts only input + output tokens.',
        ],
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-06-18',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Claude binary path now resolves correctly in packaged (Electron) builds.',
          'Installer artifact renamed with a dash so latest.yml matches the uploaded asset.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-10',
    sections: [
      {
        title: 'Features',
        items: [
          'Agent Rooms — drag agents onto a shared canvas and deploy them together.',
          'Inline approval reviews — amber chips in Rooms let you approve or reject tool calls without leaving the view.',
          'Agent suggestions — the Agents view surfaces agents found in your recent session history.',
          'Concurrent agent runs with per-session state tracking and status dots in the sidebar.',
          'Chat search — filter sessions by keyword directly in the sidebar.',
          'Markdown export — copy or save any chat as a clean Markdown file.',
          'Rich tool-call rendering — file diffs, bash output and web results get dedicated UI cards.',
          'Explorer context menu, --folder CLI flag and Windows Jump List integration.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-05-20',
    sections: [
      {
        title: 'Features',
        items: [
          'Multi-account support — add, rename and remove Claude accounts from the Accounts manager.',
          'Planner view with task board and scheduled runs.',
          'MCP server manager — add and configure Model Context Protocol servers.',
          'Remote execution view for cloud-hosted agent runs.',
          'Git integration modal — commit, diff and branch controls inside the app.',
          'Checkpoints — save and restore session state at any point in a conversation.',
          'Auto-approve toggle for unattended agent runs.',
        ],
      },
    ],
  },
]

export default function ChangelogModal({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Changelog">
      <div className="modal changelog-modal" ref={dialogRef}>
        <div className="modal-header">
          <h3>What's new</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close changelog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body changelog-body">
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="cl-entry">
              <div className="cl-entry-header">
                <span className="cl-version">v{entry.version}</span>
                {entry.tag && (
                  <span className={`cl-tag cl-tag-${entry.tag}`}>
                    {entry.tag === 'new' ? 'Unreleased' : 'Latest'}
                  </span>
                )}
                <span className="cl-date">{entry.date}</span>
              </div>

              {entry.sections.map((section) => (
                <div key={section.title} className="cl-section">
                  <div className="cl-section-title">{section.title}</div>
                  <ul className="cl-list">
                    {section.items.map((item, i) => (
                      <li key={i} className="cl-item">{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
