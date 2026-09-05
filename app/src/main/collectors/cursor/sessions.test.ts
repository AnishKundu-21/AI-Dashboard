import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectCursorSessions } from './sessions'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('collectCursorSessions', () => {
  it('discovers only agent transcripts and rolls usage into a Cursor session', () => {
    const home = mkdtempSync(join(tmpdir(), 'cursor-collector-'))
    roots.push(home)
    const transcriptDir = join(
      home,
      'projects',
      'C-Projects-AI-Dashboard',
      'agent-transcripts',
      'conv-1'
    )
    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(
      join(transcriptDir, 'conv-1.jsonl'),
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-05T10:00:00Z',
        conversation_id: 'conv-1',
        cwd: 'C:\\Projects\\AI-Dashboard',
        model_id: 'claude-sonnet-4-20250514',
        generation_id: 'gen-1',
        usage: { input_tokens: 10, output_tokens: 5 }
      })}\n`
    )
    // A JSONL elsewhere under projects must not be mistaken for a transcript.
    writeFileSync(join(home, 'projects', 'cache.jsonl'), '{"usage":{"inputTokens":99}}\n')

    const collected = collectCursorSessions(home)
    expect(collected.events).toHaveLength(1)
    expect(collected.events[0].provider).toBe('cursor')
    expect(collected.sessions).toHaveLength(1)
    expect(collected.sessions[0].project).toBe('AI-Dashboard')
    expect(collected.sessions[0].tokens_total).toBe(15)
  })
})
