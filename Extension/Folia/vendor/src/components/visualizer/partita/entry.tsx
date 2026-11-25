// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerPartita'));
export default defineVisualizer({mode:'partita',order:2,labelKey:'ui.visualizerPartita',labelFallback:"云阶",previewSeed:'partita',previewStartOffset:0,render:props=><Renderer {...props} />});
