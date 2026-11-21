import React, { useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Spinner, ErrorBanner } from '../../components/feedback/Spinner'
import { apiClient } from '../../api/client'

/**
 * AI Draft Review & Editor Screen (FE-22).
 *
 * Split-screen drafting workbench:
 *  - Left  (read-only): verified input facts (role, company, recruiter, fact IDs).
 *  - Right (editable) : AI-generated subject + body, claims with fact IDs,
 *                       missing-information notices, model name, prompt version.
 *
 * Contract: `DraftResponse` in contracts/openapi.yaml
 *   { draft_id, model, prompt_version, ai_output: AIDraftOutput }
 *
 * Props (all optional, so the screen also works standalone against demo data):
 *  - draft:          DraftResponse. Falls back to the demo draft.
 *  - opportunity:    { role, company, recruiter_name }
 *  - facts:          [{ fact_id, label, value }]  verified input facts
 *  - campaignId, opportunityId, recipientContactMethodId, tone:
 *                    used by the default "Regenerate Draft" call
 *                    (POST /campaigns/{id}/drafts) when onRegenerate is not given.
 *  - onSave({ draft_id, subject, body }):           called by "Save Edits"
 *  - onRegenerate():  Promise<DraftResponse>        overrides the default API call
 *  - onContinue({ draft_id, subject, body, was_edited, acknowledged_warnings }):
 *                    called by "Continue to Approval" (consumed by FE-23)
 */

const SUBJECT_MAX = 80

/* ------------------------------------------------------------------ */
/* Demo data (offline development, mirrors contracts/ai-schemas)       */
/* ------------------------------------------------------------------ */

const DEMO_OPPORTUNITY = {
  role: 'Junior Backend Developer (0-2 years)',
  company: 'Acme Technologies Pvt. Ltd.',
  recruiter_name: 'Priya Sharma'
}

const DEMO_FACTS = [
  { fact_id: 'F-101', label: 'Role', value: 'Junior Backend Developer (0-2 years)' },
  { fact_id: 'F-102', label: 'Company', value: 'Acme Technologies Pvt. Ltd.' },
  { fact_id: 'F-103', label: 'Recruiter name', value: 'Priya Sharma' },
  { fact_id: 'F-104', label: 'Location', value: 'Noida, India (hybrid)' },
  { fact_id: 'F-105', label: 'Source', value: 'Internshala, posted 2 days ago' }
]

const DEMO_DRAFT = {
  draft_id: 'draft-demo-001',
  model: 'gemini-1.5-flash',
  prompt_version: 'email_draft_v1',
  ai_output: {
    subject: 'Interested in the Junior Backend Developer role at Acme',
    body:
      'Hi Priya,\n\nI came across the Junior Backend Developer opening at Acme Technologies, posted on Internshala two days ago, and wanted to reach out directly. The role is based in Noida with a hybrid setup, which suits me well.\n\nI am a recent graduate looking for an opportunity to grow as a backend engineer, and I would value the chance to discuss how I could contribute to your team.\n\nWould you be open to a short call this week?\n\nBest regards,\nSumit\n\nIf you would prefer not to receive further emails, reply with "unsubscribe".',
    personalization_summary:
      'References the specific role, company, location and source so the message reads as relevant to the recruiter.',
    claims_used: [
      { fact_id: 'F-101', claim: 'Acme is hiring a Junior Backend Developer.' },
      { fact_id: 'F-104', claim: 'The role is based in Noida with a hybrid setup.' },
      { fact_id: 'F-105', claim: 'The opening was posted on Internshala two days ago.' }
    ],
    missing_information_warnings: [
      'Salary / stipend was not present in the verified facts and is not mentioned.',
      'Specific tech stack was not present in the verified facts and is not mentioned.'
    ],
    confidence_note: 'High alignment: every factual claim maps to a verified input fact.'
  }
}

/* ------------------------------------------------------------------ */
/* Word-level diff (no external library: package.json is lead-only)    */
/* ------------------------------------------------------------------ */

/**
 * Returns [{ type: 'same' | 'add' | 'del', text }] describing how to turn
 * `before` into `after`, computed on words (whitespace is kept as tokens so
 * the rendered text keeps its original line breaks).
 */
export function diffWords(before, after) {
  const a = before.split(/(\s+)/).filter((t) => t !== '')
  const b = after.split(/(\s+)/).filter((t) => t !== '')
  const n = a.length
  const m = b.length

  // Longest-common-subsequence table.
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const parts = []
  const push = (type, text) => {
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', a[i++])
    } else {
      push('add', b[j++])
    }
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return parts
}

function DiffText({ before, after, label }) {
  const parts = useMemo(() => diffWords(before, after), [before, after])
  return (
    <div
      aria-label={label}
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '14px',
        lineHeight: 1.6,
        padding: '12px',
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)'
      }}
    >
      {parts.map((p, idx) => {
        if (p.type === 'add') {
          return (
            <ins
              key={idx}
              style={{
                backgroundColor: 'var(--color-score-high-bg)',
                color: 'var(--color-score-high)',
                textDecoration: 'none'
              }}
            >
              {p.text}
            </ins>
          )
        }
        if (p.type === 'del') {
          return (
            <del
              key={idx}
              style={{
                backgroundColor: 'var(--color-score-low-bg)',
                color: 'var(--color-score-low)'
              }}
            >
              {p.text}
            </del>
          )
        }
        return <span key={idx}>{p.text}</span>
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

const panelStyle = {
  backgroundColor: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)'
}

const sectionTitleStyle = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 'var(--space-3)'
}

const fieldLabelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-text-main)',
  marginBottom: 'var(--space-1)'
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  fontFamily: 'var(--font-sans)',
  fontSize: '14px',
  color: 'var(--color-text-main)',
  backgroundColor: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)'
}

function FactRow({ fact }) {
  return (
    <li
      style={{
        padding: '8px 0',
        borderBottom: '1px solid var(--color-border)',
        listStyle: 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{fact.label}</span>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-primary)' }}>
          {fact.fact_id}
        </code>
      </div>
      <div style={{ fontSize: '14px', color: 'var(--color-text-main)', wordBreak: 'break-word' }}>{fact.value}</div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function DraftEditor({
  draft: initialDraft = DEMO_DRAFT,
  initialEdits,
  opportunity = DEMO_OPPORTUNITY,
  facts = DEMO_FACTS,
  campaignId,
  opportunityId,
  recipientContactMethodId,
  tone = 'hr',
  onSave,
  onRegenerate,
  onContinue
}) {
  // The AI's text lives in `draft` and is NEVER mutated by typing.
  // Human edits live in `subject` / `body`. The diff view compares the two.
  const [draft, setDraft] = useState(initialDraft)
  const startingSubject = initialEdits?.subject ?? initialDraft.ai_output.subject
  const startingBody = initialEdits?.body ?? initialDraft.ai_output.body
  const [subject, setSubject] = useState(startingSubject)
  const [body, setBody] = useState(startingBody)
  const [saved, setSaved] = useState({ subject: startingSubject, body: startingBody })
  const [acknowledged, setAcknowledged] = useState({})
  const [view, setView] = useState('edit') // 'edit' | 'diff'
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const regenerateCount = useRef(0)

  const ai = draft.ai_output
  const original = { subject: ai.subject, body: ai.body }

  const knownFactIds = useMemo(() => new Set(facts.map((f) => f.fact_id)), [facts])

  // Every open warning the reviewer must acknowledge before approval:
  //  1. missing-information notices reported by the model,
  //  2. claims that cite a fact ID that is not in the verified facts.
  const warnings = useMemo(() => {
    const list = (ai.missing_information_warnings || []).map((text, i) => ({
      id: `missing:${i}`,
      kind: 'Missing information',
      text
    }))
    ;(ai.claims_used || []).forEach((claim, i) => {
      if (!knownFactIds.has(claim.fact_id)) {
        list.push({
          id: `unverified:${i}`,
          kind: 'Unverified claim',
          text: `Claim cites unknown fact ID "${claim.fact_id}": ${claim.claim}`
        })
      }
    })
    return list
  }, [ai, knownFactIds])

  const openWarnings = warnings.filter((w) => !acknowledged[w.id])
  const subjectTooLong = subject.length > SUBJECT_MAX
  const subjectEmpty = subject.trim() === ''
  const bodyEmpty = body.trim() === ''
  const hasUnsavedEdits = subject !== saved.subject || body !== saved.body
  const wasEdited = subject !== original.subject || body !== original.body
  const canSave = hasUnsavedEdits && !subjectTooLong && !subjectEmpty && !bodyEmpty

  const approvalBlockers = []
  if (openWarnings.length > 0) {
    approvalBlockers.push(`${openWarnings.length} open warning${openWarnings.length === 1 ? '' : 's'} to acknowledge`)
  }
  if (hasUnsavedEdits) approvalBlockers.push('unsaved edits')
  if (subjectTooLong) approvalBlockers.push(`subject is over ${SUBJECT_MAX} characters`)
  if (subjectEmpty || bodyEmpty) approvalBlockers.push('subject and body must not be empty')
  if (isRegenerating) approvalBlockers.push('draft is regenerating')
  const canContinue = approvalBlockers.length === 0

  function applyDraft(next) {
    setDraft(next)
    setSubject(next.ai_output.subject)
    setBody(next.ai_output.body)
    setSaved({ subject: next.ai_output.subject, body: next.ai_output.body })
    setAcknowledged({}) // new AI output = new warnings, review them again
    setView('edit')
  }

  function handleSave() {
    if (!canSave) return
    try {
      onSave?.({ draft_id: draft.draft_id, subject, body })
      setSaved({ subject, body })
      setStatusMessage('Edits saved.')
      setError(null)
    } catch (err) {
      setError(err?.message || 'Could not save your edits. Please try again.')
    }
  }

  async function runRegenerate() {
    setConfirmRegenerate(false)
    setError(null)
    setStatusMessage('')
    setIsRegenerating(true)
    try {
      let next
      if (onRegenerate) {
        next = await onRegenerate()
      } else if (campaignId && opportunityId && recipientContactMethodId) {
        next = await apiClient(`/campaigns/${encodeURIComponent(campaignId)}/drafts`, {
          method: 'POST',
          body: JSON.stringify({
            opportunity_id: opportunityId,
            recipient_contact_method_id: recipientContactMethodId,
            tone
          })
        })
      } else {
        // Offline demo mode: no backend wired, produce a visibly new version.
        regenerateCount.current += 1
        next = {
          ...DEMO_DRAFT,
          draft_id: `draft-demo-${String(regenerateCount.current + 1).padStart(3, '0')}`,
          ai_output: {
            ...DEMO_DRAFT.ai_output,
            subject: 'Quick note about the Junior Backend Developer opening',
            body: DEMO_DRAFT.ai_output.body.replace(
              'wanted to reach out directly',
              'wanted to introduce myself'
            )
          }
        }
      }
      applyDraft(next)
      setStatusMessage('New draft generated. Please review the warnings again.')
    } catch (err) {
      setError(err?.message || 'Could not regenerate the draft. Please try again.')
    } finally {
      setIsRegenerating(false)
    }
  }

  function handleRegenerateClick() {
    // Never silently throw away human work.
    if (wasEdited) setConfirmRegenerate(true)
    else runRegenerate()
  }

  function handleContinue() {
    if (!canContinue) return
    if (onContinue) {
      onContinue({
        draft_id: draft.draft_id,
        subject: saved.subject,
        body: saved.body,
        was_edited: wasEdited,
        acknowledged_warnings: warnings.map((w) => w.text)
      })
    }
  }

  return (
    <div style={{ padding: 'var(--space-6)', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)'
        }}
      >
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>AI Draft Review &amp; Editor</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            Review the facts on the left, then edit the draft on the right. Nothing is sent from this screen.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }} data-testid="draft-meta">
          <Badge variant="info">Model: {draft.model}</Badge>
          <Badge variant="neutral">Prompt: {draft.prompt_version}</Badge>
          <Badge variant="neutral">Draft: {draft.draft_id}</Badge>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorBanner message={error} onRetry={runRegenerate} />
        </div>
      )}

      {/* Split screen */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
          gap: 'var(--space-4)',
          alignItems: 'start'
        }}
      >
        {/* LEFT: read-only verified facts */}
        <section aria-labelledby="draft-facts-title" style={panelStyle}>
          <h3 id="draft-facts-title" style={sectionTitleStyle}>
            Verified input facts (read-only)
          </h3>

          <dl style={{ margin: '0 0 var(--space-4)', fontSize: '14px' }}>
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Role</dt>
              <dd style={{ margin: 0 }}>{opportunity.role}</dd>
            </div>
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Company</dt>
              <dd style={{ margin: 0 }}>{opportunity.company}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Recruiter name</dt>
              <dd style={{ margin: 0 }}>{opportunity.recruiter_name}</dd>
            </div>
          </dl>

          <h4 style={{ ...sectionTitleStyle, marginBottom: 'var(--space-1)' }}>Facts by ID</h4>
          <ul style={{ margin: 0, padding: 0 }} aria-label="Verified facts">
            {facts.map((fact) => (
              <FactRow key={fact.fact_id} fact={fact} />
            ))}
          </ul>
          <p style={{ fontSize: '12px', color: 'var(--color-text-light)', margin: 'var(--space-3) 0 0' }}>
            The AI may only state facts listed here. Each claim in the draft must cite one of these IDs.
          </p>
        </section>

        {/* RIGHT: editable draft */}
        <section aria-labelledby="draft-editor-title" style={panelStyle}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-3)'
            }}
          >
            <h3 id="draft-editor-title" style={{ ...sectionTitleStyle, marginBottom: 0 }}>
              AI draft (editable)
            </h3>
            <div role="group" aria-label="Draft view" style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                variant={view === 'edit' ? 'primary' : 'secondary'}
                onClick={() => setView('edit')}
                aria-pressed={view === 'edit'}
                style={{ padding: '4px 12px' }}
              >
                Edit
              </Button>
              <Button
                variant={view === 'diff' ? 'primary' : 'secondary'}
                onClick={() => setView('diff')}
                aria-pressed={view === 'diff'}
                style={{ padding: '4px 12px' }}
              >
                Diff view
              </Button>
            </div>
          </div>

          {view === 'edit' ? (
            <>
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="draft-subject" style={fieldLabelStyle}>
                  Subject
                </label>
                <input
                  id="draft-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value)
                    setStatusMessage('')
                  }}
                  aria-invalid={subjectTooLong || subjectEmpty}
                  aria-describedby="draft-subject-count"
                  style={{
                    ...inputStyle,
                    borderColor: subjectTooLong || subjectEmpty ? 'var(--color-danger)' : 'var(--color-border)'
                  }}
                />
                <div
                  id="draft-subject-count"
                  style={{
                    fontSize: '12px',
                    marginTop: '4px',
                    color: subjectTooLong ? 'var(--color-danger)' : 'var(--color-text-muted)'
                  }}
                >
                  {subject.length}/{SUBJECT_MAX} characters
                  {subjectTooLong ? ' - subject is too long' : ''}
                </div>
              </div>

              <div>
                <label htmlFor="draft-body" style={fieldLabelStyle}>
                  Email body
                </label>
                <textarea
                  id="draft-body"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value)
                    setStatusMessage('')
                  }}
                  rows={14}
                  aria-invalid={bodyEmpty}
                  style={{ ...inputStyle, lineHeight: 1.6, resize: 'vertical' }}
                />
              </div>
            </>
          ) : (
            <div data-testid="diff-view">
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: 0 }}>
                Original AI text compared with your edits.{' '}
                <ins style={{ backgroundColor: 'var(--color-score-high-bg)', color: 'var(--color-score-high)', textDecoration: 'none' }}>
                  Added
                </ins>{' '}
                <del style={{ backgroundColor: 'var(--color-score-low-bg)', color: 'var(--color-score-low)' }}>Removed</del>
              </p>
              {wasEdited ? (
                <>
                  <span style={fieldLabelStyle}>Subject</span>
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <DiffText before={original.subject} after={subject} label="Subject diff" />
                  </div>
                  <span style={fieldLabelStyle}>Email body</span>
                  <DiffText before={original.body} after={body} label="Body diff" />
                </>
              ) : (
                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
                  No human edits yet. The draft is identical to the original AI text.
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Button onClick={handleSave} disabled={!canSave}>
              Save Edits
            </Button>
            <Button variant="secondary" onClick={handleRegenerateClick} disabled={isRegenerating}>
              Regenerate Draft
            </Button>
            {isRegenerating && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <Spinner size={18} /> Generating a new draft...
              </span>
            )}
          </div>

          {confirmRegenerate && (
            <div
              role="alertdialog"
              aria-label="Confirm regenerate"
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--color-score-medium-bg)',
                border: '1px solid var(--color-score-medium)',
                borderRadius: 'var(--radius-md)',
                fontSize: '14px'
              }}
            >
              <p style={{ margin: '0 0 var(--space-2)' }}>
                Regenerating replaces the current draft and discards your edits. Continue?
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button variant="danger" onClick={runRegenerate}>
                  Discard edits &amp; regenerate
                </Button>
                <Button variant="secondary" onClick={() => setConfirmRegenerate(false)}>
                  Keep my edits
                </Button>
              </div>
            </div>
          )}

          <div role="status" aria-live="polite" style={{ minHeight: '20px', marginTop: 'var(--space-2)', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            {hasUnsavedEdits ? 'You have unsaved edits.' : statusMessage}
          </div>

          {/* Claims with fact IDs */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <h4 style={sectionTitleStyle}>Claims cited</h4>
            {ai.claims_used && ai.claims_used.length > 0 ? (
              <ul style={{ margin: 0, padding: 0 }} aria-label="Claims cited with fact IDs">
                {ai.claims_used.map((claim, idx) => {
                  const verified = knownFactIds.has(claim.fact_id)
                  return (
                    <li
                      key={`${claim.fact_id}-${idx}`}
                      style={{
                        listStyle: 'none',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--space-2)',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: '1px solid var(--color-border)',
                        fontSize: '14px'
                      }}
                    >
                      <Badge variant={verified ? 'success' : 'danger'}>{claim.fact_id}</Badge>
                      <span style={{ flex: 1, minWidth: '200px' }}>{claim.claim}</span>
                      {!verified && <span style={{ fontSize: '12px', color: 'var(--color-danger)' }}>Not in verified facts</span>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', margin: 0 }}>
                The AI cited no claims for this draft.
              </p>
            )}
            {ai.personalization_summary && (
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: 'var(--space-3) 0 0' }}>
                <strong>Personalization:</strong> {ai.personalization_summary}
              </p>
            )}
            {ai.confidence_note && (
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: 'var(--space-3) 0 0' }}>
                <strong>Model confidence note:</strong> {ai.confidence_note}
              </p>
            )}
          </div>

          {/* Warnings that must be acknowledged */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <h4 style={sectionTitleStyle}>Missing information &amp; warnings</h4>
            {warnings.length === 0 ? (
              <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', margin: 0 }}>No open warnings.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0 }} aria-label="Warnings to acknowledge">
                {warnings.map((w) => {
                  const checked = !!acknowledged[w.id]
                  return (
                    <li
                      key={w.id}
                      style={{
                        listStyle: 'none',
                        marginBottom: 'var(--space-2)',
                        padding: 'var(--space-3)',
                        backgroundColor: checked ? 'var(--color-bg-subtle)' : 'var(--color-score-medium-bg)',
                        border: `1px solid ${checked ? 'var(--color-border)' : 'var(--color-score-medium)'}`,
                        borderRadius: 'var(--radius-md)'
                      }}
                    >
                      <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', fontSize: '14px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setAcknowledged((prev) => ({ ...prev, [w.id]: e.target.checked }))}
                          style={{ marginTop: '3px' }}
                        />
                        <span>
                          <strong>{w.kind}:</strong> {w.text}
                          <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                            I have reviewed this warning
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Approval gate */}
      <div
        style={{
          ...panelStyle,
          marginTop: 'var(--space-4)',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)'
        }}
      >
        <div role="status" aria-live="polite" style={{ fontSize: '14px' }} data-testid="approval-gate-message">
          {canContinue && onContinue ? (
            <span style={{ color: 'var(--color-score-high)' }}>All warnings acknowledged. Ready for approval.</span>
          ) : canContinue ? (
            <span style={{ color: 'var(--color-text-muted)' }}>Review complete. Approval hand-off is provided by FE-23.</span>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>
              Approval blocked: {approvalBlockers.join(', ')}.
            </span>
          )}
        </div>
        {onContinue && (
          <Button onClick={handleContinue} disabled={!canContinue}>
            Continue to Approval
          </Button>
        )}
      </div>
    </div>
  )
}

export default DraftEditor
