// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
import tuning from './tuning';
import { nebbiaBackgroundConfig } from './nebbiaBehind';
const Renderer = React.lazy(() => import('./VisualizerNebbia'));
export default defineVisualizer({mode:'nebbia',order:13,labelKey:'ui.visualizerNebbia',labelFallback:"雾笺",previewSeed:'nebbia',previewStartOffset:0,background:nebbiaBackgroundConfig,render:props=><Renderer {...props} nebbiaTuning={tuning.read(props.visualizerTunings)} />});
