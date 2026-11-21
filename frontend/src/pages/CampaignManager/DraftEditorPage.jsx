import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/ui/Badge'
import { DraftEditor } from './DraftEditor'

const DEMO_DRAFT_ID = 'draft-demo-001'
const SAVED_EDITS_KEY = `fe22:saved-edits:${DEMO_DRAFT_ID}`

function readSavedEdits() {
  try {
    const raw = window.localStorage.getItem(SAVED_EDITS_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.subject === 'string' &&
      typeof parsed.body === 'string' &&
      parsed.subject.length <= 80 &&
      parsed.subject.trim() &&
      parsed.body.trim()
    ) {
      return { subject: parsed.subject, body: parsed.body }
    }
  } catch {
    // Ignore malformed or inaccessible local storage and start from the AI draft.
  }
  return undefined
}

export default function DraftEditorPage() {
  const initialEdits = useMemo(readSavedEdits, [])

  function handleSave({ draft_id, subject, body }) {
    try {
      window.localStorage.setItem(`fe22:saved-edits:${draft_id}`, JSON.stringify({ subject, body }))
    } catch {
      throw new Error('Browser storage is unavailable. Your edits were not saved.')
    }
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <div>
          <Link to="/campaigns" style={{ color: 'var(--color-primary)', fontSize: '13px', textDecoration: 'none' }}>
            ← Campaign Manager
          </Link>
          <h1 style={{ margin: '8px 0 0', fontSize: '22px', color: 'var(--color-text-main)' }}>AI Draft Review &amp; Editor</h1>
        </div>
        <Badge variant="warning">Demo data · FE-21 integration pending</Badge>
      </div>
      <div role="note" style={{ marginBottom: 'var(--space-4)', padding: '12px 16px', border: '1px solid var(--color-score-medium)', borderRadius: 'var(--radius-md)', background: 'var(--color-score-medium-bg)', color: 'var(--color-text-main)', fontSize: '13px' }}>
        This route uses clearly labelled sample opportunity facts and an example AI draft because the supplied project snapshot does not contain the FE-21 audience/opportunity hand-off. Save Edits persists in this browser only; the supplied API contract has no draft-update endpoint.
      </div>
      <DraftEditor initialEdits={initialEdits} onSave={handleSave} />
    </div>
  )
}
