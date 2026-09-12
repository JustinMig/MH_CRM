const STATUS_LABELS = {
  not_contacted: 'Not Contacted',
  no_answer: 'No Answer',
  voicemail: 'Voicemail Left',
  follow_up: 'Follow Up / More Info Needed',
  appointment: 'Appointment',
  declined: 'Declined'
};

const VIEW_LABELS = {
  all: 'All Campaign Clients',
  voicemail: 'Voicemail Left',
  no_answer: 'No Answer',
  follow_up: 'Follow Up / More Info Needed',
  completed: 'Completed'
};

let activeView = 'all';

function statusFor(card) {
  const badge = card.querySelector('.cmp-badge');
  if (!badge) return 'not_contacted';
  const found = [...badge.classList].find(name => name.startsWith('is-') && name !== 'is-deceased');
  return found ? found.slice(3) : 'not_contacted';
}

function compactCard(card, status) {
  card.dataset.cmpStageStatus = status;
  card.setAttribute('aria-label', `${card.querySelector('.cmp-person strong')?.textContent || 'Client'} — ${STATUS_LABELS[status] || status}`);
  const update = card.querySelector('[data-cmp-update]');
  if (update && (status === 'appointment' || status === 'declined')) {
    update.disabled = true;
    update.title = status === 'appointment' ? 'Appointment set — completed' : 'Declined — completed';
  }
}

function viewMatches(status, view) {
  if (view === 'all') return true;
  if (view === 'completed') return status === 'appointment' || status === 'declined';
  return status === view;
}

function counterButton(view, label, count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cmp-counter-card';
  button.dataset.cmpCounterView = view;
  button.setAttribute('aria-pressed', String(activeView === view));
  button.innerHTML = `<strong>${count}</strong><span>${label}</span>`;
  return button;
}

function buildCounters(root, grouped, total) {
  const oldStats = root.querySelector('.cmp-stats');
  if (!oldStats) return null;
  const completed = grouped.appointment.length + grouped.declined.length;
  const counters = document.createElement('div');
  counters.className = 'cmp-counter-grid';
  counters.dataset.cmpCounters = 'true';
  counters.append(
    counterButton('all', 'Total Clients', total),
    counterButton('voicemail', 'Voicemail Left', grouped.voicemail.length),
    counterButton('no_answer', 'No Answer', grouped.no_answer.length),
    counterButton('follow_up', 'Follow Up', grouped.follow_up.length),
    counterButton('completed', 'Completed', completed)
  );
  oldStats.replaceWith(counters);
  return counters;
}

function renderView(root, members, cards, grouped) {
  const oldStage = root.querySelector('.cmp-stage');
  const filters = root.querySelector('.cmp-member-filters');
  const resultsFoot = root.querySelector('.cmp-results-foot');
  const title = VIEW_LABELS[activeView] || VIEW_LABELS.all;
  const shown = cards.filter(card => viewMatches(card.dataset.cmpStageStatus || statusFor(card), activeView));

  members.replaceChildren();
  members.dataset.cmpStageLayout = 'true';
  members.dataset.cmpCurrentView = activeView;

  if (activeView === 'all') {
    if (oldStage) {
      oldStage.hidden = false;
      oldStage.innerHTML = `<span>1</span><div><strong>Stage 1 — All Clients</strong><small>${cards.length} selected client${cards.length === 1 ? '' : 's'}. Use Spoke / Update to record an outcome.</small></div>`;
    }
    if (filters) filters.hidden = false;
    const statusFilter = filters?.querySelector('select[name="status"]')?.closest('label');
    if (statusFilter) statusFilter.hidden = true;

    const stage = document.createElement('section');
    stage.className = 'cmp-stage-list';
    const head = document.createElement('header');
    head.className = 'cmp-view-head';
    head.innerHTML = `<div><span>Stage 1</span><strong>All Campaign Clients</strong></div><b>${cards.length}</b>`;
    const rows = document.createElement('div');
    rows.className = 'cmp-outcome-rows';
    cards.forEach(card => rows.append(card));
    stage.append(head, rows);
    members.append(stage);
  } else {
    if (oldStage) oldStage.hidden = true;
    if (filters) filters.hidden = true;

    const separate = document.createElement('section');
    separate.className = 'cmp-separate-view';
    const head = document.createElement('header');
    head.className = 'cmp-separate-head';
    head.innerHTML = `<button type="button" class="cmp-view-back" data-cmp-view-back>‹ All Clients</button><div><span>Campaign List</span><strong>${title}</strong><small>${shown.length} client${shown.length === 1 ? '' : 's'}</small></div>`;
    const rows = document.createElement('div');
    rows.className = 'cmp-outcome-rows';
    if (shown.length) shown.forEach(card => rows.append(card));
    else {
      const empty = document.createElement('div');
      empty.className = 'cmp-outcome-empty';
      empty.textContent = `No clients are currently marked ${title}.`;
      rows.append(empty);
    }
    separate.append(head, rows);
    members.append(separate);
    head.querySelector('[data-cmp-view-back]').onclick = () => {
      activeView = 'all';
      scheduleEnhance(true);
    };
  }

  if (resultsFoot) resultsFoot.querySelector('span')?.replaceChildren(document.createTextNode(`${shown.length} displayed`));
}

function enhanceCampaign(root) {
  if (!(root instanceof Element)) return;
  const campaignRoot = root.matches?.('.campaigns-root') ? root : root.closest?.('.campaigns-root') || root.querySelector?.('.campaigns-root');
  if (!campaignRoot) return;
  const members = campaignRoot.querySelector('.cmp-members');
  if (!members) return;

  const rawCards = [...members.querySelectorAll('.cmp-member')];
  if (!rawCards.length) return;
  if (members.dataset.cmpStageLayout === 'true' && !members.dataset.cmpForceRebuild) return;
  delete members.dataset.cmpForceRebuild;

  const cards = rawCards;
  const grouped = { not_contacted: [], no_answer: [], voicemail: [], follow_up: [], appointment: [], declined: [] };
  for (const card of cards) {
    const status = statusFor(card);
    compactCard(card, status);
    (grouped[status] || (grouped[status] = [])).push(card);
  }

  const counters = buildCounters(campaignRoot, grouped, cards.length);
  counters?.querySelectorAll('[data-cmp-counter-view]').forEach(button => {
    button.onclick = () => {
      activeView = button.dataset.cmpCounterView || 'all';
      members.dataset.cmpForceRebuild = 'true';
      // Rebuild with the same live card nodes so Open Client and Spoke / Update handlers remain intact.
      members.replaceChildren(...cards);
      enhanceCampaign(campaignRoot);
    };
  });

  renderView(campaignRoot, members, cards, grouped);
}

let queued = false;
function scheduleEnhance(force = false) {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    document.querySelectorAll('.campaigns-root .cmp-members').forEach(members => {
      if (force) {
        const currentCards = [...members.querySelectorAll('.cmp-member')];
        if (currentCards.length) {
          members.replaceChildren(...currentCards);
          members.dataset.cmpForceRebuild = 'true';
        }
      }
      enhanceCampaign(members);
    });
  });
}

new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.campaigns-root,.cmp-members,.cmp-member') || node.querySelector?.('.campaigns-root,.cmp-members,.cmp-member'))))) {
    scheduleEnhance();
  }
}).observe(document.body, { childList: true, subtree: true });

scheduleEnhance();
