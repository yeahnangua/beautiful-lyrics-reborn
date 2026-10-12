

import { DEFAULT_LATENT_BACKGROUND_TUNING, type LatentBackgroundDisplayMode } from '../../../../types';
import LatentBackground from './LatentBackground';

import { defineVisualizerBackground } from '../definition';


// src/components/visualizer/backgrounds/latent/entry.tsx
// Registers the cover-colored, audio-reactive Latent shell background.

const LATENT_DISPLAY_MODES: LatentBackgroundDisplayMode[] = ['dithering', 'mesh', 'both'];

const LATENT_DISPLAY_LABEL_KEYS: Record<LatentBackgroundDisplayMode, string> = {
    dithering: 'options.latentDisplayDithering',
    mesh: 'options.latentDisplayMesh',
    both: 'options.latentDisplayBoth',
};

export default defineVisualizerBackground({
    mode: 'latent',
    order: 35,
    labelKey: 'options.visualizerBackgroundModeLatent',
    labelFallback: 'Latent',
    render: ({ config, theme, coverUrl, audioPower, audioBands, staticMode, paused }) => (
        <LatentBackground
            theme={theme}
            coverUrl={coverUrl}
            audioPower={audioPower}
            audioBands={audioBands}
            staticMode={staticMode}
            paused={paused}
            tuning={config?.latent?.tuning}
        />
    ),
    
    
    
});
