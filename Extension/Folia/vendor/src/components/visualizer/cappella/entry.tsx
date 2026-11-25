// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerCappella'));
export default defineVisualizer({mode:'cappella',order:3,labelKey:'ui.visualizerCappella',labelFallback:"Cappella",previewSeed:'cappella',previewStartOffset:0,render:props=><Renderer {...props} />});
