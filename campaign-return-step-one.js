import { esc, dateText, timeLabel } from './core.js';
import { CONTACT_OUTCOMES, fullName, outcomeLabel } from './campaigns-model.js';

export const RETURN_TO_STEP_ONE = 'return_step1';
export function campaignUpdateOptions(row) {
  if (row.contact_status === 'not_contacted') return CONTACT_OUTCOMES;
  const reset = [RETURN_TO_STEP_ONE, 'Return to Step 1'];
  // Completed clients can be reopened without accidentally scheduling another event.
  if (['appointment', 'declined'].includes(row.contact_status)) return [reset];
  return [...CONTACT_OUTCOMES, reset];
}

/** A correction, not a new contact attempt. Uses the existing workspace dialog stack. */
export function openReturnToStepOne({ row, dialogs, api, onSaved }) {
  const operationId = crypto.randomUUID();
  const calendar = row.next_event_id
    ? `<p class="cmp-notice">This client has a linked calendar item${row.next_event_date ? ` on ${esc(dateText(row.next_event_date))}` : ''}${row.next_event_time ? ` at ${esc(timeLabel(row.next_event_time.slice(0, 5)))}` : ''}. Returning to Step 1 does not cancel or change it. Correct an accidental appointment separately in the calendar.</p>`
    : '';
  const d = dialogs.open({
    title: 'Return to Step 1', hint: fullName(row), kind: 'campaign-dialog campaign-reset-dialog',
    body: `<form class="cmp-form" novalidate>
      <div class="cmp-selected-client"><strong>${esc(fullName(row))}</strong><small>Current result: ${esc(outcomeLabel(row.contact_status))}</small></div>
      <p class="cmp-help">Move this client back to <strong>Total Clients / Step 1 — Clients To Contact</strong>. Previous notes and contact history are kept. This correction does not add another contact attempt.</p>
      ${calendar}
      <label class="field"><span>Correction Note (optional)</span><textarea name="note" rows="3" maxlength="3800" placeholder="Example: Selected the wrong result by mistake"></textarea></label>
    </form>`,
    footer: '<span class="dirty-state" data-dirty aria-live="polite">No changes</span><div class="footer-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="button" class="btn primary" data-save="close">Return to Step 1</button></div>',
    onSave: async form => {
      const result = await api.returnToStepOne({
        p_member_id: row.id, p_operation_id: operationId,
        p_expected_version: row.version, p_note: String(form.elements.note.value || '').trim()
      });
      if (!result?.saved) throw new Error('The correction was not confirmed. Your client has not been moved. Please retry.');
      onSaved();
    }
  });
  d.attachForm(d.node.querySelector('form'));
  return d;
}
