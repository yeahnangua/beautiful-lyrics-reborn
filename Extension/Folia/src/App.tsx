import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import VisualizerRenderer from '../vendor/src/components/visualizer/VisualizerRenderer';
import VisualizerStill from '../vendor/src/components/visualizer/still/VisualizerStill';
import VisualizerBackgroundRenderer from '../vendor/src/components/visualizer/backgrounds/VisualizerBackgroundRenderer';
import { VISUALIZER_REGISTRY } from '../vendor/src/components/visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY } from '../vendor/src/components/visualizer/backgrounds/registry';
import { DEFAULT_THEME } from '../vendor/src/services/baseThemes';
import { PlayerBottomBarLayoutContext } from '../vendor/src/components/floating-player/PlayerBottomBarLayoutContext';
import type { VisualizerSharedProps } from '../vendor/src/components/visualizer/definition';
import { Controls } from './Controls';
import { PlaylistPanel } from './PlaylistPanel';
import { loadSettings, saveSettings, type Settings } from './settings';
import { lyricSeekTime } from './lyrics';
import type { FoliaActions } from './contracts';
import type { FoliaModel } from './model';

// The host shell composes the original visualizers with a small Spotify-specific settings surface.
export function App({ model, actions }: { model: FoliaModel; actions: FoliaActions }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const { player, index, panel, failed } = state;
  const { t } = useTranslation();
  const [settings, setSettings] = useState(loadSettings);
  const changeSettings = (patch: Partial<Settings>) => {
    setSettings(previous => { const next = { ...previous, ...patch }; saveSettings(next); return next; });
    model.change({ failed: false });
  };
  const timed = player.lyrics.status === 'synced';
  const props: VisualizerSharedProps = {
    currentTime: model.lyricTime, currentLineIndex: index, lines: player.lyrics.lines, theme: DEFAULT_THEME,
    audioPower: model.audioPower, audioBands: model.audioBands, songTitle: player.title, songArtist: player.artist,
    songAlbum: player.album, coverUrl: player.coverUrl, seed: player.key, paused: !player.playing,
    showText: timed && settings.showLyrics, lyricsFontScale: settings.fontScale,
    background: { mode: settings.background, common: { useCoverColorBg: true } },
    isPlayerChromeHidden: false, hideTranslationSubtitle: !settings.showSubtitles, showHarmonySubtitle: settings.showSubtitles,
    subtitleContentMode: 'translation',
    isPanelOpen: panel !== null, onBack: actions.close,
    onLyricLineSeek: time => { if (player.canSeek) actions.seek(lyricSeekTime(time, model.offset.get(), player.duration)); },
  };
  const key = `${settings.mode}:${settings.background}:${player.key}`;
  return <PlayerBottomBarLayoutContext.Provider value={true}><main className="folia-app" dir={player.lyrics.direction} data-mode={failed ? 'still' : settings.mode}>
    <div className="folia-visual-surface">
      <RenderBoundary key={key} fallback={<VisualizerStill {...props} />} onFailure={() => model.change({ failed: true })}>
        {failed ? <VisualizerStill {...props} /> : player.lyrics.status === 'static'
          ? <VisualizerBackgroundRenderer config={props.background} theme={DEFAULT_THEME} isDaylight={false} coverUrl={player.coverUrl} audioPower={model.audioPower} audioBands={model.audioBands} staticMode={false} paused={!player.playing} />
          : <VisualizerRenderer mode={settings.mode} {...props} />}
      </RenderBoundary>
      {settings.showLyrics && player.lyrics.status === 'static' && <section className="folia-static" aria-label={t('static')} style={{ fontSize: `${1.5 * settings.fontScale}rem` }}>
        <small>{t('static')}</small>{player.lyrics.staticLines.map((line, i) => <p key={i}>{line || '\u00a0'}</p>)}
      </section>}
      {settings.showLyrics && !timed && player.lyrics.status !== 'static' && <div className="folia-empty" role="status">{t(player.lyrics.status)}</div>}
    </div>
    {failed && <p className="folia-failure" role="alert">{t('failed')}</p>}
    <Controls player={player} time={model.time} actions={actions} panel={name => model.change({ panel: panel === name ? null : name })} />
    {panel === 'settings' && <SettingsPanel settings={settings} model={model} change={changeSettings} actions={actions} close={() => model.closePanel()} audioStatus={player.audioStatus} />}
    {panel === 'playlist' && <PlaylistPanel actions={actions} trackKey={player.key} close={() => model.closePanel()} />}
  </main></PlayerBottomBarLayoutContext.Provider>;
}
function SettingsPanel({ settings, model, change, actions, close, audioStatus }: {
  settings: Settings; model: FoliaModel; change(patch: Partial<Settings>): void; actions: FoliaActions; close(): void; audioStatus: string;
}) {
  const { t } = useTranslation();
  const offsetLabel = useRef<HTMLOutputElement>(null), first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const update = (offset: number) => { if (offsetLabel.current) offsetLabel.current.value = `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`; };
    update(model.offset.get()); return model.offset.on('change', update);
  }, [model]);
  return <aside className="folia-panel" role="dialog" aria-label={t('settings')} dir="ltr">
    <div className="folia-panel-header"><h2>{t('settings')}</h2><button aria-label={t('close')} onClick={close}><X size={20} /></button></div>
    <label>{t('mode')}<select aria-label={t('mode')} ref={first} value={settings.mode} onChange={event => change({ mode: event.target.value })}>
      {VISUALIZER_REGISTRY.map(entry => <option key={entry.mode} value={entry.mode}>{entry.mode.charAt(0).toUpperCase() + entry.mode.slice(1)}{entry.labelFallback.toLowerCase() !== entry.mode ? ` · ${entry.labelFallback}` : ''}</option>)}
    </select></label>
    <label>{t('background')}<select aria-label={t('background')} value={settings.background} onChange={event => change({ background: event.target.value })}>
      {VISUALIZER_BACKGROUND_REGISTRY.map(entry => <option key={entry.mode} value={entry.mode}>{entry.labelFallback}</option>)}
    </select></label>
    <label>{t('fontSize')} <output>{Math.round(settings.fontScale * 100)}%</output><input aria-label={t('fontSize')} type="range" min={0.5} max={2} step={0.05} value={settings.fontScale} onChange={event => change({ fontScale: Number(event.target.value) })} /></label>
    <label className="folia-checkbox"><span>{t('lyrics')}</span><input type="checkbox" checked={settings.showLyrics} onChange={event => change({ showLyrics: event.target.checked })} /></label>
    <label className="folia-checkbox"><span>{t('subtitles')}</span><input type="checkbox" checked={settings.showSubtitles} onChange={event => change({ showSubtitles: event.target.checked })} /></label>
    <label>{t('offset')} <output ref={offsetLabel}>0.0s</output></label>
    <div className="folia-row"><button aria-label={`${t('offset')} −0.2s`} onClick={() => actions.adjustOffset(-0.2)}>−0.2s</button><button onClick={actions.resetOffset}>{t('reset')}</button><button aria-label={`${t('offset')} +0.2s`} onClick={() => actions.adjustOffset(0.2)}>+0.2s</button></div>
    <p className="folia-analysis">{t('analysis')}<br />{t(audioStatus === 'loading' ? 'audioLoading' : audioStatus)}</p>
  </aside>;
}
class RenderBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode; onFailure(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn('[BeautifulLyrics/Folia] Renderer failed', error); this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
