import React from 'react';
import { defineVisualizer } from '../definition';


const VisualizerPartita = React.lazy(() => import('./VisualizerPartita'));

// src/components/visualizer/partita/entry.tsx
// Registers Partita and its preview tuning panel.
export default defineVisualizer({
    mode: 'partita',
    order: 50,
    labelKey: 'ui.visualizerPartita',
    labelFallback: '云阶',
    previewSeed: 'partita',
    previewStartOffset: 0,
    tuningKind: 'partita',
    usesWordSegmentation: true,
    render: props => <VisualizerPartita {...props} />,
    
    
});
