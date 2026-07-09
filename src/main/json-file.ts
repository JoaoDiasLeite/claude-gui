import * as fs from 'fs'

/** Read and parse a JSON file, tolerating a UTF-8 BOM (external tools like
 *  PowerShell 5.1 write one; bare JSON.parse throws on it). Throws like
 *  JSON.parse on invalid JSON — callers keep their existing error handling. */
export function readJsonFile<T = unknown>(p: string): T {
  let raw = fs.readFileSync(p, 'utf-8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return JSON.parse(raw) as T
}
