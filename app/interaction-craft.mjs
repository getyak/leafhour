// Keep modal dismissal and keyboard movement consistent, including dynamic audio panels.
export function pointOutside(rect, x, y) {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}
export function tabDestination(key, index, length) {
  if (!length || index < 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index + length - 1) % length;
  return null;
}
export function mountInteractionCraft(document) {
  const win = document.defaultView, openers = new WeakMap(), gestures = new WeakMap(), mounted = new WeakSet();
  const visible = node => node?.isConnected && !node.closest('[hidden], [inert]') && node.getClientRects().length;
  const fallback = () => [...document.querySelectorAll('#library-menu, #exit-focus, #library-account, #library-settings, #account-button, #book-page')].find(visible);
  function syncDialog(dialog, open = dialog.open) {
    if (!dialog.id) return;
    for (const trigger of document.querySelectorAll('[aria-controls="' + dialog.id + '"]')) if (trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', String(open));
  }
  function mount(dialog) {
    if (mounted.has(dialog)) return;
    mounted.add(dialog);
    dialog.addEventListener('beforetoggle', event => {
      syncDialog(dialog, event.newState === 'open');
      if (event.newState === 'open' && !dialog.contains(document.activeElement)) openers.set(dialog, document.activeElement);
    });
    dialog.addEventListener('pointerdown', event => {
      gestures.set(dialog, event.target === dialog && pointOutside(dialog.getBoundingClientRect(), event.clientX, event.clientY));
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || !pointOutside(dialog.getBoundingClientRect(), event.clientX, event.clientY)) return;
      // A drag that starts in the panel is text selection, not a dismissal.
      event.stopImmediatePropagation();
      if (gestures.get(dialog) !== false) dialog.close();
      gestures.delete(dialog);
    }, true);
    dialog.addEventListener('close', () => {
      syncDialog(dialog, false);
      const opener = openers.get(dialog); gestures.delete(dialog);
      win.requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]') || visible(document.activeElement) && document.activeElement !== document.body && !dialog.contains(document.activeElement)) return;
        const target = visible(opener) && !opener.disabled ? opener : fallback();
        target?.focus({preventScroll: true});
      });
    });
  }
  document.querySelectorAll('dialog').forEach(mount);
  const observer = new win.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') { if (record.target.matches('dialog')) syncDialog(record.target); continue; }
      for (const node of record.addedNodes) if (node.nodeType === 1) {
      if (node.matches('dialog')) mount(node);
      node.querySelectorAll('dialog').forEach(mount);
      }
    }
  });
  observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['open']});
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const tab = event.target.closest('[role=tab]'), list = tab?.closest('[role=tablist]');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role=tab]:not(:disabled)')], index = tabDestination(event.key, tabs.indexOf(tab), tabs.length);
    if (index === null) return;
    event.preventDefault(); tabs[index].click(); tabs[index].focus({preventScroll: true});
  });
  // One bookplate at a time keeps keyboard order and overlapping details predictable.
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.matches?.('.book-details') || !details.open || !details.closest('#library-books')) return;
    for (const other of document.querySelectorAll('#library-books .book-details[open]')) if (other !== details) other.open = false;
  }, true);
  return () => observer.disconnect();
}
if (typeof document !== 'undefined') mountInteractionCraft(document);
