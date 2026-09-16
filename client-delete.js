import { supabase } from './supabase-client.js';

export function installClientDelete(root, repository) {
  if (!root || root.dataset.clientDeleteInstalled === 'true') return;
  root.dataset.clientDeleteInstalled = 'true';

  const allowed = ['owner', 'admin'].includes(repository?.profile?.role);
  if (!allowed) return;

  const style = document.createElement('style');
  style.id = 'client-delete-style';
  style.textContent = `
    #client-results .client-delete-row{position:relative}
    #client-results .client-delete-row>.client-result-detailed{padding-right:90px}
    #client-results .client-delete-button{
      position:absolute;top:12px;right:14px;z-index:2;
      min-height:28px;padding:4px 8px;border:1px solid #d6a8ad;border-radius:7px;
      background:#fff1f2;color:#8a3943;font-size:11px;font-weight:800;line-height:1;
    }
    #client-results .client-delete-button:hover{background:#fbe4e6;border-color:#c98991}
    #client-results .client-delete-button:disabled{opacity:.55;cursor:wait}
    @media(max-width:620px){
      #client-results .client-delete-row>.client-result-detailed{padding-right:76px}
      #client-results .client-delete-button{top:9px;right:10px;min-height:26px;padding:4px 7px;font-size:10px}
    }
  `;
  document.head.append(style);

  let resultObserver = null;
  let observedHost = null;

  function decorate() {
    const host = root.querySelector('#client-results');
    if (!host) return;

    host.querySelectorAll('button.client-result-detailed[data-client-id]').forEach(openButton => {
      if (openButton.closest('.client-delete-row')) return;
      const row = document.createElement('div');
      row.className = 'client-delete-row';
      openButton.before(row);
      row.append(openButton);

      const clientId = openButton.dataset.clientId;
      const name = openButton.querySelector('[data-client-name]')?.textContent?.trim() || 'this client';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'client-delete-button';
      deleteButton.dataset.deleteClient = clientId;
      deleteButton.dataset.clientName = name;
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete ${name}`);
      row.append(deleteButton);
    });

    if (observedHost !== host) {
      resultObserver?.disconnect();
      observedHost = host;
      resultObserver = new MutationObserver(() => decorate());
      resultObserver.observe(host, { childList: true, subtree: true });
    }
  }

  root.addEventListener('click', async event => {
    const button = event.target?.closest?.('[data-delete-client]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const clientId = button.dataset.deleteClient;
    const clientName = button.dataset.clientName || 'this client';
    if (!clientId) return;

    const confirmed = window.confirm(`Delete ${clientName}?\n\nThis will remove the client from Mayer MIG CRM. This action cannot be undone.`);
    if (!confirmed) return;

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Deleting…';
    try {
      const { data, error } = await supabase.rpc('delete_my_client', { p_client_id: clientId });
      if (error) throw error;
      if (!data) throw new Error('The client was not deleted.');

      button.closest('.client-delete-row')?.remove();
      const form = root.querySelector('#client-search');
      if (form?.matches(':is(form)')) setTimeout(() => form.requestSubmit(), 0);
    } catch (error) {
      window.alert(error?.message || 'The client could not be deleted. Please try again.');
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }, true);

  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/clients')) return;
    requestAnimationFrame(() => requestAnimationFrame(decorate));
  });

  const routeObserver = new MutationObserver(records => {
    if (!records.some(record => Array.from(record.addedNodes || []).some(node => node.nodeType === 1 && (node.id === 'client-results' || node.querySelector?.('#client-results'))))) return;
    decorate();
  });
  routeObserver.observe(root, { childList: true, subtree: true });
  decorate();
}
