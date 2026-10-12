


import NomandBackgroundLayer from './NomandBackgroundLayer';

import { defineVisualizerBackground } from '../definition';


// src/components/visualizer/backgrounds/nomand/entry.tsx
// Registers the Paper image-effect shell background.

export default defineVisualizerBackground({
    mode: 'nomand',
    order: 30,
    labelKey: 'options.visualizerBackgroundModeNomand',
    labelFallback: 'Nomand',
    render: ({ config, coverUrl, theme, isDaylight }) => (
        <NomandBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            tuning={config?.nomand?.tuning}
            theme={theme}
            isDaylight={isDaylight}
        />
    ),
    
    
    
});
