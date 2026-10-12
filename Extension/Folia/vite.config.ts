import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/postcss';

// Folia is compiled to one local module before the extension's Deno/esbuild pass.
export default defineConfig({
  plugins: [{
    name: 'isolate-paper-shader-css',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/@paper-design/shaders/dist/shader-mount.js')) return;
      const original = 'if (!this.ownerDocument.querySelector("style[data-paper-shader]")) {';
      if (!code.includes(original)) throw new Error('Paper shader CSS injection changed; review the Shadow DOM adapter.');
      return code.replace(original, 'const styleRoot = parentElement.getRootNode();\n    const isolatedRoot = styleRoot instanceof ShadowRoot ? styleRoot : this.ownerDocument;\n    if (!isolatedRoot.querySelector("style[data-paper-shader]")) {')
        .replace('this.ownerDocument.head.prepend(styleElement);', '(styleRoot instanceof ShadowRoot ? styleRoot : this.ownerDocument.head).prepend(styleElement);');
    },
  }],
  css: { postcss: { plugins: [tailwind()] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    lib: { entry: 'src/mount.tsx', formats: ['es'], fileName: () => 'folia.mjs' },
    cssCodeSplit: false,
    assetsInlineLimit: () => true,
    rollupOptions: {
      output: { codeSplitting: false },
      onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); },
    },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
