// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
import { DEFAULT_MONET_TUNING } from '../../../types';
const Renderer = React.lazy(() => import('./VisualizerMonet'));
export default defineVisualizer({mode:'monet',order:6,labelKey:'ui.visualizerMonet',labelFallback:"Monet",previewSeed:'monet',previewStartOffset:0,render:props=><Renderer {...props} monetTuning={{...(props.monetTuning ?? DEFAULT_MONET_TUNING),fontScale:(props.monetTuning ?? DEFAULT_MONET_TUNING).fontScale*(props.lyricsFontScale??1)}} />});
