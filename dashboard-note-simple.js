import { mhRepository, supabase } from './supabase-repository.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));

export function installSimpleDashboardNote(root) {
  if (!root || root.dataset.simpleDashboardNoteInstalled === 'true') return;
  root.dataset.simpleDashboardNoteInstalled = 'true';

  const style = document.createElement('style');
  style.id = 'dashboard-note-tabs-style';
  style.textContent = `
    .simple-note-dialog{width:min(760px,96vw);height:min(720px,90dvh)}
    .simple-note-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px;padding:4px;border:1px solid #d5dfe7;border-radius:11px;background:#edf3f6}
    .simple-note-tabs button{min-height:40px;border:0;border-radius:8px;background:transparent;color:#607386;font-size:12px;font-weight:900}
    .simple-note-tabs button[aria-selected="true"]{background:#fff;color:#203e55;box-shadow:0 1px 4px rgba(15,23,42,.1)}
    .simple-note-editor{display:grid;gap:12px}
    .simple-note-editor textarea{min-height:260px}
    .saved-note-list{display:grid;gap:10px}
    .saved-note-card{border:1px solid #d4dfe7;border-radius:11px;background:#fff;overflow:hidden}
    .saved-note-card summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;color:#203d52}
    .saved-note-card summary strong{font-size:14px;overflow-wrap:anywhere}
    .saved-note-card summary small{flex:none;color:#718493;font-size:10px}
    .saved-note-body{padding:0 14px 14px;border-top:1px solid #e2e8ed;color:#425d70;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.55}
    .saved-note-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px 12px;border-top:1px solid #edf1f4}
    .saved-note-meta span{font-size:11px;color:#718493}
    .saved-note-meta .btn{min-height:32px;padding:6px 10px;font-size:11px}
    .saved-note-empty{padding:28px 15px;text-align:center;color:#718493;border:1px dashed #c9d5dd;border-radius:10px;background:#f6f9fa}
    @media(max-width:620px){.simple-note-dialog{width:calc(100vw - 16px);height:calc(100dvh - 16px)}.simple-note-editor textarea{min-height:220px}.saved-note-card summary{align-items:flex-start;flex-direction:column;gap:3px}}
  `;
  document.head.append(style);

  function openNote() {
    const existing = document.querySelector('dialog[data-simple-dashboard-note]');
    if (existing) { existing.showModal?.(); return; }

    const dialog = document.createElement('dialog');
    dialog.dataset.simpleDashboardNote = 'true';
    dialog.className = 'workspace-dialog simple-note-dialog';
    dialog.innerHTML = `
      <div class="modal-frame">
        <header class="modal-head">
          <div class="modal-title"><div><h2>Notes</h2><p>Create notes and view your saved notes</p></div></div>
          <button type="button" class="modal-close" data-note-close aria-label="Close">×</button>
        </header>
        <div class="modal-body">
          <div class="simple-note-tabs" role="tablist" aria-label="Notes">
            <button type="button" role="tab" aria-selected="true" data-note-tab="new">New Note</button>
            <button type="button" role="tab" aria-selected="false" data-note-tab="saved">Saved Notes</button>
          </div>
          <section data-note-panel="new">
            <div class="simple-note-editor">
              <label class="field"><span>Note Name</span><input type="text" data-dashboard-note-title maxlength="160" placeholder="Name this note"></label>
              <label class="field"><span>Note</span><textarea data-dashboard-note rows="12" placeholder="Write your note here…"></textarea></label>
              <p class="subtle" data-note-status>Ready for a new note.</p>
            </div>
          </section>
          <section data-note-panel="saved" hidden>
            <div data-saved-note-status class="subtle">Loading saved notes…</div>
            <div class="saved-note-list" data-saved-note-list></div>
          </section>
        </div>
        <footer class="modal-footer">
          <span class="dirty-state" data-note-dirty>No changes</span>
          <div class="footer-actions"><button type="button" class="btn secondary" data-note-close>Close</button><button type="button" class="btn primary" data-note-save disabled>Save Note</button></div>
        </footer>
      </div>`;
    document.body.append(dialog);

    const title = dialog.querySelector('[data-dashboard-note-title]');
    const area = dialog.querySelector('[data-dashboard-note]');
    const save = dialog.querySelector('[data-note-save]');
    const dirty = dialog.querySelector('[data-note-dirty]');
    const status = dialog.querySelector('[data-note-status]');
    const savedStatus = dialog.querySelector('[data-saved-note-status]');
    const savedList = dialog.querySelector('[data-saved-note-list]');
    let baselineTitle = '';
    let baselineBody = '';
    let currentTab = 'new';
    let loadingSaved = false;

    const isDirty = () => title.value !== baselineTitle || area.value !== baselineBody;
    const syncDirty = () => {
      const changed = isDirty();
      save.disabled = currentTab !== 'new' || !changed || !title.value.trim() || !area.value.trim();
      dirty.textContent = changed ? 'Unsaved changes' : 'No changes';
    };

    const resetEditor = () => {
      title.value = '';
      area.value = '';
      baselineTitle = '';
      baselineBody = '';
      status.textContent = 'Ready for a new note.';
      syncDirty();
    };

    async function loadSavedNotes() {
      if (loadingSaved) return;
      loadingSaved = true;
      savedStatus.textContent = 'Loading saved notes…';
      savedList.innerHTML = '';
      try {
        const userId = mhRepository.user?.id;
        if (!userId) throw new Error('Your session expired. Please sign in again.');
        const { data, error } = await supabase
          .from('client_notes')
          .select('id,title,body,author_id,created_at,updated_at')
          .is('client_id', null)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        const notes = data || [];
        savedStatus.textContent = notes.length ? `${notes.length} saved note${notes.length === 1 ? '' : 's'}` : '';
        const names = new Map((mhRepository.agents || []).map(agent => [agent.id, agent.full_name || 'Team member']));
        savedList.innerHTML = notes.length ? notes.map(note => {
          const when = note.updated_at || note.created_at;
          const date = when ? new Date(when).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '';
          const author = note.author_id === userId ? 'You' : (names.get(note.author_id) || 'Team member');
          return `<details class="saved-note-card" data-saved-note-id="${esc(note.id)}"><summary><strong>${esc(note.title || 'Untitled Note')}</strong><small>${esc(date)}</small></summary><div class="saved-note-body">${esc(note.body || '')}</div><div class="saved-note-meta"><span>Created by ${esc(author)}</span><button type="button" class="btn danger" data-delete-saved-note>Delete</button></div></details>`;
        }).join('') : '<div class="saved-note-empty">No saved notes yet.</div>';
      } catch (error) {
        savedStatus.textContent = error?.message || 'Saved notes could not load.';
      } finally {
        loadingSaved = false;
      }
    }

    function chooseTab(tab) {
      if (tab === currentTab) return;
      if (currentTab === 'new' && isDirty() && !confirm('Switch tabs without saving this note?')) return;
      currentTab = tab;
      dialog.querySelectorAll('[data-note-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.noteTab === tab)));
      dialog.querySelectorAll('[data-note-panel]').forEach(panel => { panel.hidden = panel.dataset.notePanel !== tab; });
      save.hidden = tab !== 'new';
      dirty.hidden = tab !== 'new';
      if (tab === 'saved') void loadSavedNotes();
      else { resetEditor(); setTimeout(() => title.focus(), 0); }
    }

    title.addEventListener('input', syncDirty);
    area.addEventListener('input', syncDirty);
    savedList.addEventListener('click', async event => {
      const button = event.target.closest?.('[data-delete-saved-note]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const card = button.closest('[data-saved-note-id]');
      const noteId = card?.dataset.savedNoteId;
      if (!noteId || !confirm('Delete this note? This cannot be undone.')) return;
      button.disabled = true;
      savedStatus.textContent = 'Deleting note…';
      try {
        const { error } = await supabase.from('client_notes').delete().eq('id', noteId).is('client_id', null);
        if (error) throw error;
        loadingSaved = false;
        await loadSavedNotes();
      } catch (error) {
        button.disabled = false;
        savedStatus.textContent = error?.message || 'Unable to delete this note.';
      }
    });

    dialog.querySelectorAll('[data-note-tab]').forEach(button => button.addEventListener('click', () => chooseTab(button.dataset.noteTab)));
    dialog.querySelectorAll('[data-note-close]').forEach(button => button.addEventListener('click', () => {
      if (currentTab === 'new' && isDirty() && !confirm('Close without saving this note?')) return;
      dialog.close();
    }));
    dialog.addEventListener('close', () => dialog.remove());

    save.addEventListener('click', async () => {
      const noteTitle = title.value.trim();
      const noteBody = area.value.trim();
      if (!noteTitle) { status.textContent = 'Enter a note name.'; title.focus(); return; }
      if (!noteBody) { status.textContent = 'Enter a note before saving.'; area.focus(); return; }
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const saved = await mhRepository.saveNote({ client_id: null, title: noteTitle, body: noteBody, pinned: false });
        if (!saved?.id) throw new Error('The note save was not confirmed.');
        baselineTitle = title.value;
        baselineBody = area.value;
        dirty.textContent = 'No changes';
        status.textContent = 'Saved.';
        await loadSavedNotes();
        setTimeout(() => {
          resetEditor();
          status.textContent = 'Saved. Ready for another note.';
        }, 350);
      } catch (error) {
        save.disabled = false;
        status.textContent = error?.message || 'Save failed. Please try again.';
      }
    });

    dialog.showModal();
    syncDirty();
    title.focus();
  }

  root.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-tool="notes"]');
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openNote();
  }, true);
}
