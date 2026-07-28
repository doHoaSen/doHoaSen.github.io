import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://dohoasen.github.io',
  integrations: [sitemap()],
});
