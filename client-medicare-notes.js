import { mhRepository, supabase } from './supabase-repository.js';

const baseGetClient = mhRepository.getClient.bind(mhRepository);
const baseSaveClient = mhRepository.saveClient.bind(mhRepository);

mhRepository.getClient = async function (id) {
  const record = await baseGetClient(id);
  if (!record) return record;

  const { data, error } = await supabase
    .from('medicare_details')
    .select('notes')
    .eq('client_id', id)
    .maybeSingle();
  if (error) throw error;

  return {
    ...record,
    medicare_notes: data?.notes || ''
  };
};

mhRepository.saveClient = async function (record, ...args) {
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;

  const notes = String(record?.medicare_notes || '').trim() || null;
  const { error } = await supabase
    .from('medicare_details')
    .update({ notes })
    .eq('client_id', saved.id);
  if (error) throw error;

  return this.getClient(saved.id);
};

function addMedicareNotes(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  if (dialog.dataset.medicareNotes === 'true') return;

  const panel = dialog.querySelector('[data-panel="medicare"]');
  if (!panel) return;

  const healthGroup = Array.from(panel.querySelectorAll('details.field-group')).find(group =>
    group.querySelector('[name="health_carrier"]') || group.textContent.includes('Health Plan Information')
  );
  if (!healthGroup) return;

  const notesGroup = document.createElement('details');
  notesGroup.className = 'field-group';
  notesGroup.dataset.medicareNotesGroup = 'true';
  notesGroup.open = false;
  notesGroup.innerHTML = `
    <summary>Medicare Notes</summary>
    <div class="form-grid">
      <label class="field span-all">
        <span>Notes</span>
        <textarea name="medicare_notes" rows="6" placeholder="Enter Medicare-specific notes for this client..."></textarea>
      </label>
    </div>`;

  healthGroup.insertAdjacentElement('afterend', notesGroup);
  dialog.dataset.medicareNotes = 'true';

  const clientId = dialog.dataset.clientId || '';
  if (clientId) {
    supabase
      .from('medicare_details')
      .select('notes')
      .eq('client_id', clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !dialog.isConnected) return;
        const textarea = notesGroup.querySelector('[name="medicare_notes"]');
        if (textarea) textarea.value = data?.notes || '';
      });
  }
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const dialog = node.matches?.('dialog.client-dialog') ? node : node.closest?.('dialog.client-dialog');
      if (dialog) queueMicrotask(() => addMedicareNotes(dialog));
      node.querySelectorAll?.('dialog.client-dialog').forEach(d => queueMicrotask(() => addMedicareNotes(d)));
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('dialog.client-dialog').forEach(dialog => addMedicareNotes(dialog));
