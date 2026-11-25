// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerCladdagh'));
export default defineVisualizer({mode:'claddagh',order:5,labelKey:'ui.visualizerCladdagh',labelFallback:"Claddagh",previewSeed:'claddagh',previewStartOffset:0,render:props=><Renderer {...props} />});
