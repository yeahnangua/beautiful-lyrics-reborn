// Reborn adapter: upstream renderers, host-owned settings and playback.
import React from 'react';
import { defineVisualizer } from '../definition';
import tuning from './tuning';
const Renderer = React.lazy(() => import('./VisualizerMachi'));
export default defineVisualizer({mode:'machi',order:15,labelKey:'ui.visualizerMachi',labelFallback:"町景",previewSeed:'machi',previewStartOffset:0,background:false,render:props=><Renderer {...props} machiTuning={tuning.read(props.visualizerTunings)} />});
