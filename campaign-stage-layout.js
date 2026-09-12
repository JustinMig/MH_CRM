const STATUS_LABELS = {
  not_contacted: 'Not Contacted',
  no_answer: 'No Answer',
  voicemail: 'Voicemail Left',
  follow_up: 'Follow Up / More Info Needed',
  appointment: 'Appointment',
  declined: 'Declined'
};

const VIEW_LABELS = {
  stage1: 'Clients To Contact',
  voicemail: 'Voicemail Left',
  no_answer: 'No Answer',
  follow_up: 'Follow Up / More Info Needed',
  completed: 'Completed'
};

const ICONS = {
  stage1: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v4H7z"/><path d="M5 7h14v14H5z"/><path d="M8 11h8M8 15h5"/></svg>',
  voicemail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0Zm8 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0Z"/><path d="M8 16h8"/></svg>',
  no_answer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4l2 5-3 2a14 14 0 0 0 3 3l2-3 5 2v4c0 2-2 3-4 3C9 20 4 15 4 8c0-2 1-4 3-4Z"/><path d="m16 4 4 4m0-4-4 4"/></svg>',
  follow_up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H8l-4 4Z"/><path d="M8 9h8M8 13h5"/></svg>',
  completed: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>'
};

let activeView = 'stage1';

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
  if (view === 'stage1') return status === 'not_contacted';
  if (view === 'completed') return status === 'appointment' || status === 'declined';
  return status === view;
}

function counterButton(view, label, count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cmp-counter-card';
  button.dataset.cmpCounterView = view;
  button.setAttribute('aria-label', `${label}: ${count}`);
  button.innerHTML = `<span class="cmp-counter-icon">${ICONS[view] || ''}</span><strong>${count}</strong><span class="cmp-counter-label">${label}</span>`;
  return button;
}

function syncCounterState(counters) {
  counters?.querySelectorAll('[data-cmp-counter-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.cmpCounterView === activeView));
  });
}

function buildCounters(root, grouped) {
  const completed = grouped.appointment.length + grouped.declined.length;
  const stageOneCount = grouped.not_contacted.length;
  let counters = root.querySelector('[data-cmp-counters]');
  if (!counters) {
    const oldStats = root.querySelector('.cmp-stats');
    if (!oldStats) return null;
    counters = document.createElement('div');
    counters.className = 'cmp-counter-grid';
    counters.dataset.cmpCounters = 'true';
    oldStats.replaceWith(counters);
  }
  counters.replaceChildren(
    counterButton('stage1', 'Total Clients', stageOneCount),
    counterButton('voicemail', 'Voicemail Left', grouped.voicemail.length),
    counterButton('no_answer', 'No Answer', grouped.no_answer.length),
    counterButton('follow_up', 'Follow Up', grouped.follow_up.length),
    counterButton('completed', 'Completed', completed)
  );
  syncCounterState(counters);
  return counters;
}

function renderView(root, members, cards) {
  const oldStage = root.querySelector('.cmp-stage');
  const filters = root.querySelector('.cmp-member-filters');
  const resultsFoot = root.querySelector('.cmp-results-foot');
  const title = VIEW_LABELS[activeView] || VIEW_LABELS.stage1;
  const shown = cards.filter(card => viewMatches(card.dataset.cmpStageStatus || statusFor(card), activeView));

  members.replaceChildren();
  members.dataset.cmpStageLayout = 'true';
  members.dataset.cmpCurrentView = activeView;
  if (oldStage) oldStage.hidden = true;
  if (filters) filters.hidden = true;

  if (activeView === 'stage1') {
    const stage = document.createElement('section');
    stage.className = 'cmp-stage-list';
    const rows = document.createElement('div');
    rows.className = 'cmp-outcome-rows';
    if (shown.length) shown.forEach(card => rows.append(card));
    else {
      const empty = document.createElement('div');
      empty.className = 'cmp-outcome-empty';
      empty.textContent = 'No clients remain to contact.';
      rows.append(empty);
    }
    stage.append(rows);
    members.append(stage);
  } else {
    const separate = document.createElement('section');
    separate.className = 'cmp-separate-view';
    const head = document.createElement('header');
    head.className = 'cmp-separate-head';
    head.innerHTML = `<button type="button" class="cmp-view-back" data-cmp-view-back>‹ Total Clients</button><div><span>Campaign List</span><strong>${title}</strong><small>${shown.length} client${shown.length === 1 ? '' : 's'}</small></div>`;
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
    head.querySelector('[data-cmp-view-back]').onclick = () => switchView(root, members, cards, 'stage1');
  }

  if (resultsFoot) {
    const count = resultsFoot.querySelector('span');
    if (count) count.textContent = `${shown.length} displayed`;
  }
}

function switchView(root, members, cards, view) {
  activeView = view;
  const grouped = { not_contacted: [], no_answer: [], voicemail: [], follow_up: [], appointment: [], declined: [] };
  cards.forEach(card => (grouped[card.dataset.cmpStageStatus] || (grouped[card.dataset.cmpStageStatus] = [])).push(card));
  const counters = buildCounters(root, grouped);
  renderView(root, members, cards);
  counters?.querySelectorAll('[data-cmp-counter-view]').forEach(button => {
    button.onclick = () => switchView(root, members, cards, button.dataset.cmpCounterView || 'stage1');
  });
}

function enhanceCampaign(root) {
  if (!(root instanceof Element)) return;
  const campaignRoot = root.matches?.('.campaigns-root') ? root : root.closest?.('.campaigns-root') || root.querySelector?.('.campaigns-root');
  if (!campaignRoot) return;
  const members = campaignRoot.querySelector('.cmp-members');
  if (!members || members.dataset.cmpStageLayout === 'true') return;

  const cards = [...members.querySelectorAll(':scope > .cmp-member')];
  if (!cards.length) return;
  for (const card of cards) compactCard(card, statusFor(card));
  switchView(campaignRoot, members, cards, activeView);
}

let queued = false;
function scheduleEnhance() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    document.querySelectorAll('.campaigns-root .cmp-members').forEach(enhanceCampaign);
  });
}

new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.campaigns-root,.cmp-members,.cmp-member') || node.querySelector?.('.campaigns-root,.cmp-members,.cmp-member'))))) {
    scheduleEnhance();
  }
}).observe(document.body, { childList: true, subtree: true });

scheduleEnhance();
