// Restore a replaced action only while the user has kept focus with that operation.
export function trackActionFocus(document, trigger) {
  const hadFocus = !!trigger && document.activeElement === trigger;
  let moved = false;
  const track = event => { if (event.target !== trigger && event.target !== document.body) moved = true; };
  document.addEventListener('focusin', track);
  const stop = () => document.removeEventListener('focusin', track);
  return {stop, restore(target) {
    stop();
    if (hadFocus && !moved && (document.activeElement === document.body || document.activeElement === trigger)) target?.focus({preventScroll: true});
  }};
}
