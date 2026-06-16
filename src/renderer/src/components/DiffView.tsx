import './DiffView.css'

interface Props {
  oldText: string
  newText: string
}

interface Row {
  type: 'context' | 'add' | 'del'
  text: string
}

/**
 * Minimal line-level diff using the classic LCS table. Good enough for showing what an
 * Edit/Write will change — not a full Myers diff, but clear and dependency-free.
 */
function diffLines(a: string[], b: string[]): Row[] {
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'context', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] })
      i++
    } else {
      rows.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] })
  while (j < m) rows.push({ type: 'add', text: b[j++] })
  return rows
}

const SIGN: Record<Row['type'], string> = { context: ' ', add: '+', del: '-' }

export default function DiffView({ oldText, newText }: Props) {
  const rows = diffLines(oldText.split('\n'), newText.split('\n'))
  return (
    <div className="diff-view">
      {rows.map((r, i) => (
        <div key={i} className={`diff-row ${r.type}`}>
          <span className="diff-sign">{SIGN[r.type]}</span>
          <span className="diff-text">{r.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
