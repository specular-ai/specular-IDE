import type { SpecularBridge } from '../shared/types';

/** Native custom-plugin views sit above the renderer's HTML top layer. */
export function observeDialogLayers(api: SpecularBridge) {
  let previous: boolean | undefined;
  const sync = () => {
    const open = !!document.querySelector('dialog[open]');
    if (open === previous) return;
    previous = open;
    void api.setCustomPluginsObscured(open).catch(() => { previous = undefined; });
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  sync();
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}
