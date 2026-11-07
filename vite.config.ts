import { defineConfig } from 'vite';

// Relative base so the same build works at ishu-dev.github.io/chalk-riot/ and inside an itch.io iframe.
export default defineConfig({
  base: './',
});
