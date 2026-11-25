// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
import { DEFAULT_CADENZA_TUNING } from '../../../types';
const Renderer = React.lazy(() => import('./VisualizerCadenza'));
export default defineVisualizer({mode:'cadenza',order:1,labelKey:'ui.visualizerCadenza',labelFallback:"Mindscape",previewSeed:'cadenza',previewStartOffset:0,render:props=><Renderer {...props} cadenzaTuning={{...(props.cadenzaTuning ?? DEFAULT_CADENZA_TUNING),fontScale:(props.cadenzaTuning ?? DEFAULT_CADENZA_TUNING).fontScale*(props.lyricsFontScale??1)}} />});
