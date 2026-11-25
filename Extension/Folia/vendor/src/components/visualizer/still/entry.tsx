// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerStill'));
export default defineVisualizer({mode:'still',order:12,labelKey:'ui.visualizerStill',labelFallback:"Still",previewSeed:'still',previewStartOffset:0,background:false,render:props=><Renderer {...props} />});
