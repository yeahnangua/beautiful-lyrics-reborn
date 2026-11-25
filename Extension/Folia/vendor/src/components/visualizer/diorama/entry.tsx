// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerDiorama'));
export default defineVisualizer({mode:'diorama',order:7,labelKey:'ui.visualizerDiorama',labelFallback:"镜台",previewSeed:'diorama',previewStartOffset:0,render:props=><Renderer {...props} />});
