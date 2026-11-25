// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerLumiere'));
export default defineVisualizer({mode:'lumiere',order:11,labelKey:'ui.visualizerLumiere',labelFallback:"绘光",previewSeed:'lumiere',previewStartOffset:0,render:props=><Renderer {...props} />});
