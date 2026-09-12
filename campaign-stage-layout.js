const STATUS_LABELS = {
  not_contacted: 'Not Contacted',
  no_answer: 'No Answer',
  voicemail: 'Voicemail Left',
  follow_up: 'Follow Up / More Info Needed',
  appointment: 'Appointment',
  declined: 'Declined'
};

const VIEW_LABELS = {
  stage1: 'Stage 1 — Not Contacted',
  voicemail: 'Voicemail Left',
  no_answer: 'No Answer',
  follow_up: 'Follow Up / More Info Needed',
  completed: 'Completed'
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
  button.innerHTML = `<strong>${count}</strong><span>${label}</span>`;
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

  if (activeView === 'stage1') {
    if (oldStage) {
      oldStage.hidden = false;
      oldStage.innerHTML = `<span>1</span><div><strong>Stage 1 — Contact</strong><small>${shown.length} client${shown.length === 1 ? '' : 's'} still need an initial update. Once updated, they leave Stage 1.</small></div>`;
    }
    if (filters) filters.hidden = true;

    const stage = document.createElement('section');
    stage.className = 'cmp-stage-list';
    const head = document.createElement('header');
    head.className = 'cmp-view-head';
    head.innerHTML = `<div><span>Stage 1</span><strong>Clients To Contact</strong></div><b>${shown.length}</b>`;
    const rows = document.createElement('div');
    rows.className = 'cmp-outcome-rows';
    if (shown.length) shown.forEach(card => rows.append(card));
    else {
      const empty = document.createElement('div');
      empty.className = 'cmp-outcome-empty';
      empty.textContent = 'No clients remain in Stage 1.';
      rows.append(empty);
    }
    stage.append(head, rows);
    members.append(stage);
  } else {
    if (oldStage) oldStage.hidden = true;
    if (filters) filters.hidden = true;

    const separate = document.createElement('section');
    separate.className = 'cmp-separate-view';
    const head = document.createElement('header');
    head.className = 'cmp-separate-head';
    head.innerHTML = `<button type="button" class="cmp-view-back" data-cmp-view-back>‹ Stage 1</button><div><span>Campaign List</span><strong>${title}</strong><small>${shown.length} client${shown.length === 1 ? '' : 's'}</small></div>`;
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
