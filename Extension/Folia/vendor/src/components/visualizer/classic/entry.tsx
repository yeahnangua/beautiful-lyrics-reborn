// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./Visualizer'));
export default defineVisualizer({mode:'classic',order:0,labelKey:'ui.visualizerClassic',labelFallback:"Luminous",previewSeed:'classic',previewStartOffset:0,render:props=><Renderer {...props} />});
