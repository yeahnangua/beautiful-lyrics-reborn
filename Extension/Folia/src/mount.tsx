import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App';
import { FoliaModel } from './model';
import { makeI18n } from './i18n';
import css from './styles.css?inline';
import type { FoliaActions, FoliaHandle, PlayerSnapshot } from './contracts';

// A single self-contained mount; this module never injects styles into Spotify's document.
export function mountFolia(host: HTMLElement, player: PlayerSnapshot, actions: FoliaActions, language = navigator.language): FoliaHandle {
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = css;
  const container = document.createElement('div'); container.id = 'folia-root';
  shadow.append(style, container);
  const translator = makeI18n(language);
  const root = createRoot(container);
  const model = new FoliaModel(player);
  let destroyed = false;
  const fail = (event: Event) => { event.preventDefault(); model.change({ failed: true }); };
  shadow.addEventListener('webglcontextlost', fail, true);
  shadow.addEventListener('folia-render-failed', fail);
  root.render(<I18nextProvider i18n={translator}><App model={model} actions={actions} /></I18nextProvider>);
  return {
    update: snapshot => { if (!destroyed) model.update(snapshot); },
    step: (time, offset, audio) => { if (!destroyed) model.step(time, offset, audio); },
    closePanel: () => !destroyed && model.closePanel(),
    destroy() {
      if (destroyed) return; destroyed = true;
      shadow.removeEventListener('webglcontextlost', fail, true); shadow.removeEventListener('folia-render-failed', fail);
      root.unmount(); model.destroy(); translator.off('languageChanged'); translator.off('loaded'); shadow.replaceChildren();
    },
  };
}
