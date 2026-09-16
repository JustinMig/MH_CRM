import { mhRepository, supabase } from './supabase-repository.js';

export function installSimpleDashboardNote(root) {
  if (!root || root.dataset.simpleDashboardNoteInstalled === 'true') return;
  root.dataset.simpleDashboardNoteInstalled = 'true';

  function openNote() {
    const existing = document.querySelector('dialog[data-simple-dashboard-note]');
    if (existing) { existing.showModal?.(); return; }

    const dialog = document.createElement('dialog');
    dialog.dataset.simpleDashboardNote = 'true';
    dialog.className = 'workspace-dialog simple-note-dialog';
    dialog.innerHTML = `
      <div class="modal-frame">
        <header class="modal-head">
          <div class="modal-title"><div><h2>Notes</h2><p>One personal dashboard note</p></div></div>
          <button type="button" class="modal-close" data-note-close aria-label="Close">×</button>
        </header>
        <div class="modal-body">
          <label class="field span-all"><span>Note</span><textarea data-dashboard-note rows="12" placeholder="Write your note here…"></textarea></label>
          <p class="subtle" data-note-status>Loading note…</p>
        </div>
        <footer class="modal-footer">
          <span class="dirty-state" data-note-dirty>No changes</span>
          <div class="footer-actions"><button type="button" class="btn secondary" data-note-close>Close</button><button type="button" class="btn primary" data-note-save disabled>Save Note</button></div>
        </footer>
      </div>`;
    document.body.append(dialog);

    const area = dialog.querySelector('[data-dashboard-note]');
    const save = dialog.querySelector('[data-note-save]');
    const dirty = dialog.querySelector('[data-note-dirty]');
    const status = dialog.querySelector('[data-note-status]');
    let noteId = null;
    let baseline = '';
    let loading = true;

    const syncDirty = () => {
      if (loading) return;
      const changed = area.value !== baseline;
      save.disabled = !changed;
      dirty.textContent = changed ? 'Unsaved changes' : 'No changes';
    };

    area.addEventListener('input', syncDirty);
    dialog.querySelectorAll('[data-note-close]').forEach(button => button.addEventListener('click', () => {
      if (area.value !== baseline && !confirm('Close without saving your note changes?')) return;
      dialog.close();
    }));
    dialog.addEventListener('close', () => dialog.remove());

    save.addEventListener('click', async () => {
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const saved = await mhRepository.saveNote({ id: noteId, client_id: null, title: 'Dashboard Note', body: area.value, pinned: true });
        noteId = saved?.id || noteId;
        baseline = area.value;
        dirty.textContent = 'No changes';
        status.textContent = 'Saved.';
      } catch (error) {
        save.disabled = false;
        status.textContent = error?.message || 'Save failed. Please try again.';
      }
    });

    dialog.showModal();

    (async () => {
      try {
        const userId = mhRepository.user?.id;
        if (!userId) throw new Error('Your session expired. Please sign in again.');
        const { data, error } = await supabase
          .from('client_notes')
          .select('id,body')
          .is('client_id', null)
          .eq('author_id', userId)
          .maybeSingle();
        if (error) throw error;
        noteId = data?.id || null;
        area.value = data?.body || '';
        baseline = area.value;
        status.textContent = data ? 'Your note is ready.' : 'No note saved yet.';
      } catch (error) {
        status.textContent = error?.message || 'The note could not load.';
      } finally {
        loading = false;
        syncDirty();
        area.focus();
      }
    })();
  }

  root.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-tool="notes"]');
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openNote();
  }, true);
}
