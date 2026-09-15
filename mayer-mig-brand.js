const BEAR = 'https://crm.mayerig.com/mayer-bear.png?v=mig-1';

function applyMayerMigBrand() {
  if (document.title !== 'Mayer MIG CRM') document.title = 'Mayer MIG CRM';
  document.querySelectorAll('.brand img, .top-brand img').forEach(img => {
    if (img.src !== BEAR) img.src = BEAR;
    if (img.alt !== 'Mayer MIG bear') img.alt = 'Mayer MIG bear';
  });
  const brandText = document.querySelector('.brand span');
  const brandMarkup = 'Mayer MIG CRM<small>Standalone</small>';
  if (brandText && brandText.innerHTML !== brandMarkup) brandText.innerHTML = brandMarkup;
  const topText = document.querySelector('.top-brand strong');
  if (topText && topText.textContent !== 'Mayer MIG CRM') topText.textContent = 'Mayer MIG CRM';
  const footer = document.querySelector('.sidebar-footer');
  const footerMarkup = 'Mayer MIG CRM<small>Standalone workspace</small>';
  if (footer && footer.innerHTML !== footerMarkup) footer.innerHTML = footerMarkup;
  const eyebrow = document.querySelector('.page-heading .eyebrow');
  if (eyebrow && eyebrow.textContent !== 'MAYER MIG WORKSPACE') eyebrow.textContent = 'MAYER MIG WORKSPACE';
}

applyMayerMigBrand();
const observer = new MutationObserver(applyMayerMigBrand);
observer.observe(document.body, { childList: true, subtree: true });
