# Sebastian Dev Blog

Practical articles about modern C++, embedded software, and software design.

Working series: **C++ Mental Models**.

## Current status

This is an Astro website with a homepage, article archive, topic filtering,
search, About page, and Markdown articles. Deployment is configured in
`.github/workflows/deploy.yml`.

## Develop locally

Use Node.js 24 or newer. Run `npm ci`, then `npm run dev`.
Open the address printed by Astro, including `/sebastian-dev-blog/`.
Run `npm run build` to generate `dist/`, and `npm run preview` to inspect it.

## Start writing

1. Choose a topic from [the backlog](TOPICS.md).
2. Copy [the publishing template](templates/post.md) into src/pages/articles/<article-slug>.md.
3. Add runnable code under examples/<article-slug>/ where useful.
4. Verify language rules, compile the examples, and review the article.
5. Run `npm run build`, then commit and push to `main` to deploy.

The archive discovers Markdown articles automatically. Update the title,
description, date, category, and readingTime in each article's frontmatter.
Keep unfinished drafts outside `src/pages/`; files inside it become public pages.

## Editorial principles

- Explain why, not just which syntax to use.
- Keep scope, lifetime, ownership, and threading assumptions explicit.
- Name the C++ standard and compiler used for examples.
- Distinguish standard guarantees from compiler-specific behavior.
- Cite authoritative sources and verify AI-assisted material.
- Never commit credentials, proprietary code, or personal information.

This repository is public: draft files committed here are public too.

## GitHub Pages setup

In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the
source. Run **Build and deploy blog** from the Actions tab after enabling Pages
if the initial deployment needs to be retried. No custom secrets are needed.

Expected address: https://sebastianmathai.github.io/sebastian-dev-blog/

Pull requests build without deploying. Pushes to `main` and manual workflow runs
build and deploy. The build uses read-only repository permissions; only the
deployment job receives `pages: write` and `id-token: write`.

The base path is configured in `astro.config.mjs`. For a custom domain, update
`site` and `base` there and configure GitHub Pages and DNS accordingly.
Domain registration is optional.
