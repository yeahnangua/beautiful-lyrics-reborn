import React from 'react';

import { defineVisualizer } from '../definition';


const VisualizerCladdagh = React.lazy(() => import('./VisualizerCladdagh'));

// src/components/visualizer/claddagh/entry.tsx

export default defineVisualizer({
    mode: 'claddagh',
    order: 80,
    labelKey: 'ui.visualizerCladdagh',
    labelFallback: 'Claddagh',
    previewSeed: 'claddagh',
    previewStartOffset: 0,
    tuningKind: 'claddagh',
    render: props => <VisualizerCladdagh {...props} />,
    
    
});
