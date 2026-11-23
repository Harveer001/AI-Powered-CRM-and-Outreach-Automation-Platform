import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DraftEditor, diffWords } from './DraftEditor'

const draft = {
  draft_id: 'draft-test-01',
  model: 'gemini-test-model',
  prompt_version: 'prompt-test-v1',
  ai_output: {
    subject: 'Original subject',
    body: 'Hello recruiter, original body.',
    personalization_summary: 'Uses verified role information.',
    claims_used: [{ fact_id: 'FACT-1', claim: 'The role is Software Engineer.' }],
    missing_information_warnings: ['Salary is not present in verified facts.'],
    confidence_note: 'Claims map to supplied facts.'
  }
}

const facts = [{ fact_id: 'FACT-1', label: 'Role', value: 'Software Engineer' }]
const opportunity = { role: 'Software Engineer', company: 'Example Co.', recruiter_name: 'A. Recruiter' }

describe('FE-22 AI Draft Review & Editor', () => {
  it('renders the split workbench and read-only verified opportunity facts', () => {
    const html = renderToString(<DraftEditor draft={draft} facts={facts} opportunity={opportunity} />)

    expect(html).toContain('Verified input facts (read-only)')
    expect(html).toContain('AI draft (editable)')
    expect(html).toContain('Example Co.')
    expect(html).toContain('A. Recruiter')
    expect(html).toContain('FACT-1')
    expect(html).toContain('gemini-test-model')
    expect(html).toContain('prompt-test-v1')
  })

  it('renders claims, personalization summary, and model confidence note', () => {
    const html = renderToString(<DraftEditor draft={draft} facts={facts} opportunity={opportunity} />)

    expect(html).toContain('Claims cited')
    expect(html).toContain('The role is Software Engineer.')
    expect(html).toContain('Uses verified role information.')
    expect(html).toContain('Claims map to supplied facts.')
  })

  it('shows warning acknowledgement controls and blocks approval until checked', () => {
    const html = renderToString(<DraftEditor draft={draft} facts={facts} opportunity={opportunity} />)

    expect(html).toContain('Warnings to acknowledge')
    expect(html).toContain('Salary is not present in verified facts.')
    expect(html.replace(/<!-- -->/g, '')).toContain('Approval blocked: 1 open warning to acknowledge.')
    expect(html).toContain('disabled=""')
  })

  it('flags claims that cite fact IDs absent from the verified facts', () => {
    const invalidDraft = {
      ...draft,
      ai_output: {
        ...draft.ai_output,
        claims_used: [{ fact_id: 'UNKNOWN-9', claim: 'Unverified claim.' }]
      }
    }
    const html = renderToString(<DraftEditor draft={invalidDraft} facts={facts} opportunity={opportunity} />)

    expect(html).toContain('UNKNOWN-9')
    expect(html).toContain('Not in verified facts')
    expect(html).toContain('Claim cites unknown fact ID')
  })

  it('keeps provided human edits separate from the original AI draft', () => {
    const html = renderToString(
      <DraftEditor
        draft={draft}
        facts={facts}
        opportunity={opportunity}
        initialEdits={{ subject: 'Human-edited subject', body: 'Hello recruiter, human-edited body.' }}
      />
    )

    expect(html).toContain('value="Human-edited subject"')
    expect(html).not.toContain('You have unsaved edits.')
    expect(html).toContain('disabled=""')
    expect(draft.ai_output.subject).toBe('Original subject')
    expect(draft.ai_output.body).toBe('Hello recruiter, original body.')
  })

  it('renders an empty-warning state without blocking on nonexistent warnings', () => {
    const noWarningsDraft = {
      ...draft,
      ai_output: { ...draft.ai_output, missing_information_warnings: [] }
    }
    const html = renderToString(<DraftEditor draft={noWarningsDraft} facts={facts} opportunity={opportunity} />)

    expect(html).toContain('No open warnings.')
    expect(html).toContain('Review complete. Approval hand-off is provided by FE-23.')
  })

  it('diffWords identifies inserted and removed words while preserving unchanged text', () => {
    const parts = diffWords('Hello old world', 'Hello new world')

    expect(parts).toEqual([
      { type: 'same', text: 'Hello ' },
      { type: 'del', text: 'old' },
      { type: 'add', text: 'new' },
      { type: 'same', text: ' world' }
    ])
  })

  it('does not call onSave during render', () => {
    const onSave = vi.fn()
    renderToString(<DraftEditor draft={draft} facts={facts} opportunity={opportunity} onSave={onSave} />)
    expect(onSave).not.toHaveBeenCalled()
  })
})
