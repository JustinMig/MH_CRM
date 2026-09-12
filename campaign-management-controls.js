import { supabase } from './supabase-repository.js';

const RETURN_KEY = 'mh-campaign-return-id';
let busy = false;

function errorMessage(error) {
  return error?.message || 'That action could not be completed.';
}

function showAllCampaigns(root) {
  const filter = root.querySelector('.cmp-list-filter');
  const select = filter?.querySelector('[data-cmp-list-status]');
  if (!select) return;
  filter.hidden = true;
  if (select.value !== 'all') {
    select.value = 'all';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function deleteCampaign(id, shell, name) {
  if (busy || !id) return;
  if (!confirm(`Delete campaign “${name || 'Campaign'}” permanently?\n\nThis removes the campaign, its campaign client list, and campaign contact history. Calendar appointments are kept.`)) return;
  busy = true;
  try {
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error) throw error;
    shell?.remove();
  } catch (error) {
    alert(`Campaign could not be deleted. ${errorMessage(error)}`);
  } finally {
    busy = false;
  }
}

function addCampaignDeleteButtons(root) {
  root.querySelectorAll('.cmp-campaign-card').forEach(card => {
    if (card.closest('.cmp-campaign-shell')) return;
    const shell = document.createElement('div');
    shell.className = 'cmp-campaign-shell';
    card.before(shell);
    shell.append(card);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cmp-delete-campaign';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete campaign ${card.querySelector(':scope > strong')?.textContent?.trim() || ''}`.trim());
    remove.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      void deleteCampaign(card.dataset.cmpOpen, shell, card.querySelector(':scope > strong')?.textContent?.trim());
    };
    shell.append(remove);
  });
}

async function removeCampaignMember(select) {
  const memberId = select.dataset.cmpUpdate;
  const card = select.closest('.cmp-member');
  const name = card?.querySelector('.cmp-person strong')?.textContent?.trim() || 'this client';
  select.value = '';
  if (!memberId || busy) return;
  if (!confirm(`Remove ${name} from this campaign?\n\nThis removes the client from this campaign only. Their CRM client record and calendar appointments are kept.`)) return;

  busy = true;
  select.disabled = true;
  try {
    const { data, error } = await supabase
      .from('campaign_members')
      .delete()
      .eq('id', memberId)
      .select('campaign_id')
      .single();
    if (error) throw error;
    if (data?.campaign_id) sessionStorage.setItem(RETURN_KEY, data.campaign_id);
    location.reload();
  } catch (error) {
    select.disabled = false;
    alert(`Client could not be removed from the campaign. ${errorMessage(error)}`);
  } finally {
    busy = false;
  }
}

function addRemoveOptions(root) {
  root.querySelectorAll('select[data-cmp-update]').forEach(select => {
    if (select.querySelector('option[value="__remove__"]')) return;
    const option = document.createElement('option');
    option.value = '__remove__';
    option.textContent = 'Remove from Campaign';
    select.append(option);
  });
}

function addSelectAll(root) {
  root.querySelectorAll('.cmp-selectionbar').forEach(bar => {
    if (!bar.querySelector('[data-cmp-assign]') || bar.querySelector('[data-cmp-select-all]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn secondary cmp-select-all';
    button.dataset.cmpSelectAll = 'true';
    button.textContent = 'Select All';
    button.title = 'Select all displayed clients';
    button.onclick = () => {
      const host = bar.parentElement;
      const boxes = [...host.querySelectorAll('.cmp-search-checkbox input[type="checkbox"]:not(:disabled)')];
      boxes.forEach(box => {
        if (box.checked) return;
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    bar.querySelector('[data-cmp-assign]').before(button);
  });
}

function reopenCampaign(root) {
  const id = sessionStorage.getItem(RETURN_KEY);
  if (!id) return;
  const card = root.querySelector(`.cmp-campaign-card[data-cmp-open="${CSS.escape(id)}"]`);
  if (!card) return;
  sessionStorage.removeItem(RETURN_KEY);
  card.click();
}

function enhance() {
  const root = document.querySelector('.campaigns-root');
  if (!root) return;
  showAllCampaigns(root);
  addCampaignDeleteButtons(root);
  addRemoveOptions(root);
  addSelectAll(root);
  reopenCampaign(root);
}

document.addEventListener('change', event => {
  const select = event.target.closest?.('select[data-cmp-update]');
  if (!select || select.value !== '__remove__') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void removeCampaignMember(select);
}, true);

let queued = false;
function scheduleEnhance() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    enhance();
  });
}

new MutationObserver(mutations => {
  if (mutations.some(m => [...m.addedNodes].some(n => n instanceof Element && (n.matches?.('.campaigns-root,.cmp-campaign-card,.cmp-member,.cmp-selectionbar') || n.querySelector?.('.campaigns-root,.cmp-campaign-card,.cmp-member,.cmp-selectionbar'))))) scheduleEnhance();
}).observe(document.body, { childList: true, subtree: true });

scheduleEnhance();
