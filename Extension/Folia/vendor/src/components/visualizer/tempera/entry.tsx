// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerTempera'));
export default defineVisualizer({mode:'tempera',order:10,labelKey:'ui.visualizerTempera',labelFallback:"Tempera",previewSeed:'tempera',previewStartOffset:0,render:props=><Renderer {...props} />});
