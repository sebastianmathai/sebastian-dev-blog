import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://sebastianmathai.github.io',
  base: '/sebastian-dev-blog',
  trailingSlash: 'always',
  output: 'static',
  markdown: { shikiConfig: { theme: 'github-dark' } }
});
