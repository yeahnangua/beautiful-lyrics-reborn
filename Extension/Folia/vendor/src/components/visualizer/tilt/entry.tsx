// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
const Renderer = React.lazy(() => import('./VisualizerTilt'));
export default defineVisualizer({mode:'tilt',order:4,labelKey:'ui.visualizerTilt',labelFallback:"Tilt",previewSeed:'tilt',previewStartOffset:0,render:props=><Renderer {...props} />});
