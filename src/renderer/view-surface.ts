import type { SurfaceFactory } from './abstraction-views';

/** Grouped views share a workspace tab and a mode bar, without knowing one another. */
export function workspaceSurface(parent: HTMLElement): SurfaceFactory {
  return (group, definitions, open) => {
    const root = document.createElement('section'); root.id = group.containerId;
    root.className = 'relationship-map'; root.setAttribute('aria-label', `${group.title} view`); root.hidden = true;
    const navigation = document.createElement('nav'); navigation.className = 'relationship-modes';
    navigation.setAttribute('aria-label', `${group.title} views`);
    const containers = new Map<string, HTMLElement>(), buttons = new Map<string, HTMLButtonElement>();
    for (const definition of definitions) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button';
      button.textContent = definition.title; button.onclick = () => open(definition.id);
      const container = document.createElement('div'); container.id = definition.containerId ?? `view-${definition.id}`;
      container.hidden = true; containers.set(definition.id, container); buttons.set(definition.id, button);
      navigation.append(button); root.append(container);
    }
    if (definitions.length > 1) root.prepend(navigation);
    parent.append(root);
    return {
      container: id => containers.get(id)!,
      show: id => {
        root.hidden = !id;
        for (const [key, container] of containers) { container.hidden = key !== id; buttons.get(key)!.setAttribute('aria-pressed', String(key === id)); }
      },
      dispose: () => { for (const button of buttons.values()) button.onclick = null; root.remove(); containers.clear(); buttons.clear(); },
    };
  };
}
