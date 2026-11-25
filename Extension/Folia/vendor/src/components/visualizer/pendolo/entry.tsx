// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerPendolo'));
export default defineVisualizer({mode:'pendolo',order:8,labelKey:'ui.visualizerPendolo',labelFallback:"Pendolo",previewSeed:'pendolo',previewStartOffset:0,render:props=><Renderer {...props} />});
