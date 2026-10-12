import React, { useEffect, useRef, useState } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart, ListPlus, Settings2, Flag, Volume2, Maximize, Minimize, X } from 'lucide-react';
import type { PlayerSnapshot, FoliaActions } from './contracts';

// Folia's expanding glass capsule adapted to host-owned Spotify transport actions.
export function Controls({ player, time, actions, panel }: { player: PlayerSnapshot; time: MotionValue<number>; actions: FoliaActions; panel(name: 'settings' | 'playlist'): void }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const expanded = hovered || !player.playing;
  const button = (label: string, icon: React.ReactNode, action: () => void, active = false, disabled = false) =>
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={action} className={active ? 'active' : ''}>{icon}</button>;
  return <>
    <div className="folia-top-actions">
      {button(t('settings'), <Settings2 size={20} />, () => panel('settings'))}
      {button(t(player.fullscreen ? 'exitFullscreen' : 'enterFullscreen'), player.fullscreen ? <Minimize size={20} /> : <Maximize size={20} />, actions.toggleFullscreen)}
      {button(t('close'), <X size={20} />, actions.close)}
    </div>
    <motion.div className="folia-controls" initial={false} animate={{ width: expanded ? 'min(780px, calc(100vw - 40px))' : 'min(580px, calc(100vw - 40px))' }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setHovered(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false); }} data-expanded={expanded}>
      <div className="folia-track">
        <img src={player.coverUrl} alt="" /><div><strong>{player.title}</strong><span>{player.artist}</span></div>
        {button(t(player.playing ? 'pause' : 'play'), player.playing ? <Pause size={20} /> : <Play size={20} />, actions.togglePlay)}
      </div>
      <div className="folia-expanded" aria-hidden={!expanded} inert={!expanded}>
        <div className="folia-transport">
          {button(t('shuffle'), <Shuffle size={18} />, actions.toggleShuffle, player.shuffle)}
          {button(t('prev'), <SkipBack size={20} />, actions.prev)}
          {button(t(player.playing ? 'pause' : 'play'), player.playing ? <Pause size={24} /> : <Play size={24} />, actions.togglePlay)}
          {button(t('next'), <SkipForward size={20} />, actions.next)}
          {button(t('loop') + ` (${player.loop})`, player.loop === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />, actions.toggleLoop, player.loop !== 'off')}
          {button(t(player.liked ? 'unlike' : 'like'), <Heart size={18} fill={player.liked ? 'currentColor' : 'none'} />, actions.toggleLike, player.liked, !player.canLike)}
          {button(t('playlist'), <ListPlus size={18} />, () => panel('playlist'), false, !player.canPlaylist)}
          {button(t('feedback'), <Flag size={18} />, actions.feedback, false, !player.canFeedback)}
          <label className="folia-volume"><Volume2 size={17} /><input aria-label={t('volume')} type="range" min={0} max={1} step={0.01} value={player.volume} onChange={event => actions.setVolume(Number(event.target.value))} /></label>
        </div>
      </div>
      <Progress time={time} duration={player.duration} disabled={!player.canSeek} seek={actions.seek} />
    </motion.div>
  </>;
}
const timeText = (time: number) => `${Math.floor(Math.max(0, time) / 60)}:${String(Math.floor(Math.max(0, time) % 60)).padStart(2, '0')}`;
function Progress({ time, duration, disabled, seek }: { time: MotionValue<number>; duration: number; disabled: boolean; seek(time: number): void }) {
  const { t } = useTranslation();
  const range = useRef<HTMLInputElement>(null), label = useRef<HTMLSpanElement>(null), dragging = useRef(false);
  useEffect(() => {
    const update = (value: number) => {
      if (!dragging.current && range.current) range.current.value = String(Math.max(0, Math.min(duration, value)));
      if (!dragging.current && label.current) label.current.textContent = timeText(value);
    };
    update(time.get()); return time.on('change', update);
  }, [time, duration]);
  return <div className="folia-progress"><span ref={label}>{timeText(time.get())}</span><input ref={range} type="range" aria-label={t('seek')} min={0} max={Math.max(0.01, duration)} step={0.01} disabled={disabled}
    defaultValue={time.get()} onPointerDown={() => { dragging.current = true; }} onPointerUp={event => { dragging.current = false; seek(Number(event.currentTarget.value)); }}
    onPointerCancel={() => { dragging.current = false; }} onChange={event => { if (label.current) label.current.textContent = timeText(Number(event.target.value)); }}
    onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) seek(Number(event.currentTarget.value)); }}
    onBlur={event => { if (dragging.current) { dragging.current = false; seek(Number(event.currentTarget.value)); } }} /><span>{timeText(duration)}</span></div>;
}
