// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerSonnet'));
export default defineVisualizer({mode:'sonnet',order:9,labelKey:'ui.visualizerSonnet',labelFallback:"商籁",previewSeed:'sonnet',previewStartOffset:0,render:props=><Renderer {...props} />});
