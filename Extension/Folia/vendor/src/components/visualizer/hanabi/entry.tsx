// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
import tuning from './tuning';
const Renderer = React.lazy(() => import('./VisualizerHanabi'));
export default defineVisualizer({mode:'hanabi',order:14,labelKey:'ui.visualizerHanabi',labelFallback:"花火",previewSeed:'hanabi',previewStartOffset:0,render:props=><Renderer {...props} hanabiTuning={tuning.read(props.visualizerTunings)} />});
