const BEAR = 'https://crm.mayerig.com/mayer-bear.png?v=mig-1';

function applyMayerMigBrand() {
  document.title = 'Mayer MIG CRM';
  document.querySelectorAll('.brand img, .top-brand img').forEach(img => {
    img.src = BEAR;
    img.alt = 'Mayer MIG bear';
  });
  const brandText = document.querySelector('.brand span');
  if (brandText) brandText.innerHTML = 'Mayer MIG CRM<small>Standalone</small>';
  const topText = document.querySelector('.top-brand strong');
  if (topText) topText.textContent = 'Mayer MIG CRM';
  const footer = document.querySelector('.sidebar-footer');
  if (footer) footer.innerHTML = 'Mayer MIG CRM<small>Standalone workspace</small>';
  const eyebrow = document.querySelector('.page-heading .eyebrow');
  if (eyebrow) eyebrow.textContent = 'MAYER MIG WORKSPACE';
}

applyMayerMigBrand();
new MutationObserver(applyMayerMigBrand).observe(document.body, { childList: true, subtree: true });
