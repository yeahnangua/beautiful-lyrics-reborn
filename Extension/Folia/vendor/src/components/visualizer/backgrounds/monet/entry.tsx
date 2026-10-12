


import MonetBackgroundLayer from './MonetBackgroundLayer';
import { defineVisualizerBackground } from '../definition';


// src/components/visualizer/backgrounds/monet/entry.tsx
// Registers the Monet image-treatment shell background.

export default defineVisualizerBackground({
    mode: 'monet',
    order: 20,
    labelKey: 'options.visualizerBackgroundModeMonet',
    labelFallback: 'Monet',
    render: ({ config, coverUrl, theme, isDaylight, staticMode }) => (
        <MonetBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            theme={theme}
            isDaylight={isDaylight}
            tuning={config?.monet?.tuning}
            transparentBackground={config?.transparent}
            staticMode={staticMode}
        />
    ),
    
    
    
});
