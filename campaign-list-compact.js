function compactCampaignCards(root=document){
  const cards=root.querySelectorAll('.campaigns-root .cmp-campaign-card');
  cards.forEach(card=>{
    if(card.dataset.cmpCompactCard==='true') return;
    const name=card.querySelector(':scope > strong')?.textContent?.trim()||'Campaign';
    const foot=card.querySelector('.cmp-card-foot')?.textContent||'';
    const countMatch=foot.match(/(\d+)\s+clients?/i);
    const total=countMatch?Number(countMatch[1]):0;
    const titlebar=card.closest('.campaigns-root')?.querySelector('.cmp-titlebar');
    const allButtons=[...card.parentElement?.querySelectorAll('.cmp-campaign-card')||[]];
    let added='';
    const raw=card.outerHTML.match(/data-cmp-open="([^"]+)"/);
    const id=raw?.[1]||'';
    // Date is already present in campaign list data, but the current card renderer omits it.
    // Read the campaign object's created date from a lightweight dataset hook if later provided.
    // Until then, preserve a neutral label populated from the visible card's DOM when available.
    const dateSource=card.querySelector('[data-cmp-added]')?.textContent?.trim();
    if(dateSource) added=dateSource;
    card.classList.add('cmp-campaign-card-compact');
    card.dataset.cmpCompactCard='true';
    card.innerHTML=`<strong>${name}</strong><div class="cmp-compact-meta"><span class="cmp-compact-date">${added||'Date added'}</span><span class="cmp-compact-total">${total} client${total===1?'':'s'}</span></div>`;
    if(id) card.dataset.cmpOpen=id;
  });
}

let queued=false;
function schedule(){
  if(queued) return;
  queued=true;
  queueMicrotask(()=>{queued=false;compactCampaignCards();});
}

new MutationObserver(mutations=>{
  if(mutations.some(m=>[...m.addedNodes].some(n=>n instanceof Element&&(n.matches?.('.cmp-campaign-card,.cmp-campaign-grid,.campaigns-root')||n.querySelector?.('.cmp-campaign-card'))))) schedule();
}).observe(document.body,{childList:true,subtree:true});

schedule();
