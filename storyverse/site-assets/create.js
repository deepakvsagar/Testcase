// Mark creation paths that already have a saved studio draft in this browser.
for (const card of document.querySelectorAll('[data-mode]')) {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(`storyverse:draft:${card.dataset.mode}`) ?? 'null'); } catch { draft = null; }
  if (!draft || !(draft.idea || draft.script)) continue;
  const cta = card.querySelector('.path-cta');
  if (cta) cta.textContent = draft.title ? `Continue “${draft.title.slice(0, 40)}”` : 'Continue your draft';
  card.classList.add('has-draft');
}
