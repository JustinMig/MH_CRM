const STATUS_ORDER = ['not_contacted','no_answer','voicemail','follow_up','appointment','declined'];
const STATUS_LABELS = {
  not_contacted: 'Contact',
  no_answer: 'No Answer',
  voicemail: 'Voicemail Left',
  follow_up: 'Follow Up / More Info Needed',
  appointment: 'Appointment',
  declined: 'Declined'
};

function statusFor(card) {
  const badge = card.querySelector('.cmp-badge');
  if (!badge) return 'not_contacted';
  const found = [...badge.classList].find(name => name.startsWith('is-') && name !== 'is-deceased');
  return found ? found.slice(3) : 'not_contacted';
}

function makeOutcomeBox(status, cards, stageLabel) {
  const section = document.createElement('section');
  section.className = `cmp-outcome-box is-${status}`;
  section.dataset.cmpOutcomeBox = status;
  const head = document.createElement('header');
  head.className = 'cmp-outcome-head';
  head.innerHTML = `<div><span>${stageLabel}</span><strong>${STATUS_LABELS[status] || status}</strong></div><b>${cards.length}</b>`;
  const rows = document.createElement('div');
  rows.className = 'cmp-outcome-rows';
  if (cards.length) cards.forEach(card => rows.append(card));
  else {
    const empty = document.createElement('div');
    empty.className = 'cmp-outcome-empty';
    empty.textContent = 'No clients in this box.';
    rows.append(empty);
  }
  section.append(head, rows);
  return section;
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

function enhanceCampaign(root) {
  if (!(root instanceof Element)) return;
  const members = root.matches?.('.cmp-members') ? root : root.querySelector?.('.cmp-members');
  if (!members || members.dataset.cmpStageLayout === 'true') return;
  const cards = [...members.querySelectorAll(':scope > .cmp-member')];
  if (!cards.length) return;

  members.dataset.cmpStageLayout = 'true';
  const filter = members.closest('.campaigns-root')?.querySelector('.cmp-member-filters select[name="status"]')?.closest('label');
  if (filter) filter.hidden = true;
  const oldStage = members.closest('.campaigns-root')?.querySelector('.cmp-stage');
  if (oldStage) {
    oldStage.innerHTML = '<span>1</span><div><strong>Contact</strong><small>New campaign clients begin here. Updates move them into the outcome boxes below.</small></div>';
  }

  const grouped = Object.fromEntries(STATUS_ORDER.map(status => [status, []]));
  for (const card of cards) {
    const status = statusFor(card);
    compactCard(card, status);
    (grouped[status] || (grouped[status] = [])).push(card);
  }

  members.replaceChildren();

  const contactStage = document.createElement('section');
  contactStage.className = 'cmp-stage-group cmp-stage-contact';
  contactStage.innerHTML = '<header class="cmp-stage-group-head"><div><span>Stage 1</span><strong>Contact</strong><small>Clients not contacted yet</small></div></header>';
  contactStage.append(makeOutcomeBox('not_contacted', grouped.not_contacted, 'New / Not Contacted'));

  const retryStage = document.createElement('section');
  retryStage.className = 'cmp-stage-group cmp-stage-retry';
  retryStage.innerHTML = '<header class="cmp-stage-group-head"><div><span>Stage 2</span><strong>Retry / Follow Up</strong><small>Work these clients again until an appointment is set or they decline</small></div></header>';
  retryStage.append(
    makeOutcomeBox('no_answer', grouped.no_answer, 'Retry'),
    makeOutcomeBox('voicemail', grouped.voicemail, 'Retry'),
    makeOutcomeBox('follow_up', grouped.follow_up, 'Follow Up')
  );

  const completeStage = document.createElement('section');
  completeStage.className = 'cmp-stage-group cmp-stage-complete';
  completeStage.innerHTML = '<header class="cmp-stage-group-head"><div><span>Completed</span><strong>Finished Outcomes</strong><small>Appointment set or client declined</small></div></header>';
  completeStage.append(
    makeOutcomeBox('appointment', grouped.appointment, 'Completed'),
    makeOutcomeBox('declined', grouped.declined, 'Completed')
  );

  members.append(contactStage, retryStage, completeStage);
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
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.campaigns-root,.cmp-members,.cmp-member') || node.querySelector?.('.campaigns-root,.cmp-members,.cmp-member'))))) scheduleEnhance();
}).observe(document.body, { childList: true, subtree: true });

scheduleEnhance();
