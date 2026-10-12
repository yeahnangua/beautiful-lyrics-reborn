


import SoraBackground from './SoraBackground';

import { defineVisualizerBackground } from '../definition';


// src/components/visualizer/backgrounds/sora/entry.tsx
// Registers the shader-based Sora starfield shell background.

export default defineVisualizerBackground({
    mode: 'sora',
    order: 50,
    labelKey: 'options.visualizerBackgroundModeSora',
    labelFallback: 'Sora',
    // Blank mode never mounts the WebGL canvas: just a static black (night) / white (daylight) frame.
    // Static mode intentionally freezes the starfield, matching the shared background contract.
    render: ({ config, theme, isDaylight, paused, staticMode }) => (
        <div className="absolute inset-0 z-0" style={{ backgroundColor: isDaylight ? '#ffffff' : '#000000' }}>
            {!config?.sora?.tuning?.blank && (
                <SoraBackground theme={theme} isDaylight={isDaylight} paused={paused || staticMode} />
            )}
        </div>
    ),
    
    
    
});
