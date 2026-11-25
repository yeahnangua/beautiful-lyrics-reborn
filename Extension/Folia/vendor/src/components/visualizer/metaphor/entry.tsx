// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
import tuning from './tuning';
const Renderer = React.lazy(() => import('./VisualizerMetaphor'));
export default defineVisualizer({mode:'metaphor',order:16,labelKey:'ui.visualizerMetaphor',labelFallback:"隐喻",previewSeed:'metaphor',previewStartOffset:0,background:false,render:props=><Renderer {...props} metaphorTuning={tuning.read(props.visualizerTunings)} />});
