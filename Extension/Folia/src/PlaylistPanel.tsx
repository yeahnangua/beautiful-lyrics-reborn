import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Plus, X } from 'lucide-react';
import type { FoliaActions, LibraryItem } from './contracts';

// Requests and mutations capture their track/folder, and late replies never update a closed panel.
export function PlaylistPanel({ actions, trackKey, close }: { actions: FoliaActions; trackKey: string; close(): void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState([{ uri: '', name: t('library') }]);
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [creation, setCreation] = useState<'folder' | 'playlist' | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const folder = path[path.length - 1].uri;
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setItems([]);
    const timer = setTimeout(() => {
      actions.listFolder(folder, filter).then(result => { if (alive) setItems(result); }, cause => { if (alive) setError(String(cause)); })
        .finally(() => { if (alive) setLoading(false); });
    }, 160);
    return () => { alive = false; clearTimeout(timer); };
  }, [actions, folder, filter, revision]);
  useEffect(() => { setCreation(null); setName(''); }, [folder]);
  return <aside className="folia-panel" role="dialog" aria-label={t('playlist')}>
    <div className="folia-panel-header"><h2>{t('playlist')}</h2><button aria-label={t('close')} onClick={close}><X size={20} /></button></div>
    <nav className="folia-breadcrumb">{path.map((branch, i) => <button key={branch.uri} onClick={() => { setPath(path.slice(0, i + 1)); setFilter(''); }}>{branch.name}</button>)}</nav>
    <input type="search" aria-label={t('search')} placeholder={t('search')} value={filter} onChange={event => setFilter(event.target.value)} />
    <div className="folia-row"><button onClick={() => setCreation('folder')}>{t('newFolder')}</button><button onClick={() => setCreation('playlist')}>{t('newPlaylist')}</button></div>
    {creation && <form className="folia-row" onSubmit={event => {
      event.preventDefault(); if (!name.trim() || creating) return;
      setCreating(true);
      actions.createLibraryItem(creation, name.trim(), folder).then(() => { if (aliveRef.current) { setCreation(null); setName(''); setRevision(value => value + 1); } }, cause => { if (aliveRef.current) setError(String(cause)); }).finally(() => { if (aliveRef.current) setCreating(false); });
    }}><input autoFocus maxLength={200} aria-label={t('name')} value={name} onChange={event => setName(event.target.value)} /><button disabled={creating || !name.trim()}>{t('create')}</button></form>}
    {loading && <p role="status">{t('audioLoading')}</p>}
    {error && <p role="alert">{error} <button onClick={() => setRevision(value => value + 1)}>{t('retry')}</button></p>}
    {!loading && !error && items.length === 0 && <p>{t('empty')}</p>}
    <div className="folia-library-list">{items.map(item => item.type === 'folder'
      ? <button className="folia-playlist-row" key={item.uri} onClick={() => { setPath([...path, { uri: item.uri, name: item.name }]); setFilter(''); }}><Folder size={24} /><span>{item.name}</span></button>
      : <PlaylistRow key={`${trackKey}:${item.uri}`} item={item} actions={actions} trackKey={trackKey} />)}</div>
  </aside>;
}
function PlaylistRow({ item, actions, trackKey }: { item: LibraryItem; actions: FoliaActions; trackKey: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'busy' | 'added'>('idle');
  const [error, setError] = useState('');
  const [details, setDetails] = useState(item);
  const row = useRef<HTMLDivElement>(null), aliveRef = useRef(true);
  useEffect(() => {
    let started = false;
    aliveRef.current = true;
    const observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return;
      started = true; observer.disconnect();
      actions.playlistDetails(item.uri).then(value => { if (aliveRef.current) setDetails(value); }, () => {});
    }, { rootMargin: '160px' });
    if (row.current) observer.observe(row.current);
    return () => { aliveRef.current = false; observer.disconnect(); };
  }, [actions, item.uri]);
  return <div ref={row}><button className="folia-playlist-row" disabled={status !== 'idle'} onClick={async () => {
    setStatus('busy'); setError('');
    try { await actions.addToPlaylist(item.uri, trackKey); if (aliveRef.current) setStatus('added'); }
    catch (cause) { if (aliveRef.current) { setStatus('idle'); setError(String(cause)); } }
  }}>{details.cover ? <img src={details.cover} alt="" /> : <Plus size={24} />}<span>{details.name}</span><small>{status === 'added' ? t('added') : t('add')}</small></button>{error && <p role="alert">{error}</p>}</div>;
}
