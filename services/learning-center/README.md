# Pyxis Learning Center (WordPress plugin)

A Cloudflare-style learning center for `www.pyxis-discovery.com`: plain-language
"What is …?" articles grouped by topic, written for chemists and biotech teams.

| URL | View |
|---|---|
| `/learning/` | Hub: hero with instant search, every topic with its articles, glossary card, CTA |
| `/learning/<topic>/` | Topic intro and article cards |
| `/learning/<topic>/<article>/` | Article: topic sidebar, breadcrumbs, learning objectives, body, "Keep learning", CTA |
| `/learning/glossary/` | A–Z glossary of every article's term and one-line summary |

The plugin registers the `pyxis_learn` post type and the `pyxis_learn_topic`
taxonomy with `rewrite => false` and adds its own four rewrite rules, so
WordPress cannot generate competing URL patterns (`glossary` is therefore a
reserved topic slug). An article opened under the wrong topic 301-redirects to
its canonical URL. Like the stock catalog plugin, it renders with its own
templates inside the theme's `base.twig` content block, because the `pyxis`
theme (Timber/Twig) has no classic header/footer templates. Themes without
Timber use `get_header()` and `get_footer()` instead. Styles are scoped under `.pxl` and
use the theme's `--sk-*` colour tokens and Poppins.

## Content

- `content/topics.json`: topics (slug, name, description), in display order.
- `content/articles/<slug>.html`: one article per file, a front-matter block
  (title, topic, order, term, summary, objectives) followed by body HTML that
  starts at `<h2>`. Link to another article with
  `[pyxis_learn_link slug="what-is-a-macrocycle"]macrocycles[/pyxis_learn_link]`;
  an unpublished target renders as plain text, never as a broken link.

Activating the plugin imports the starter content: 6 topics and 21 articles.
**Learning Center → Starter content** re-runs the import. It creates only
missing slugs and never overwrites an edited, drafted or trashed article.
After launch, articles are edited in WordPress (block editor plus the "Learning
details" box). The repo files are the starter set, not a sync source.

Fields per article (REST-visible post meta, also editable in the meta box):
`pyxis_learn_term`, `pyxis_learn_summary`, `pyxis_learn_objectives` (one per
line), `pyxis_learn_order`. Topic order is term meta `pyxis_learn_order`.

## Install on WordPress

1. `cd services/learning-center/wordpress && zip -r pyxis-learning-center.zip pyxis-learning-center`
2. WP admin → Plugins → Add New → Upload → install and **activate**. Activation
   flushes rewrite rules and imports the starter articles. Updating by upload
   (no re-activation) still flushes once because of `PYXIS_LEARN_VERSION`; bump
   it with every release.
3. Add a header menu item: Appearance → Menus → Custom link `/learning/`,
   labelled "Learning Center".
4. Yoast/Rank Math pick up the post type automatically; check that
   "Learning Center" is included in the sitemap settings.

## Verify

```bash
bun run test:learning-center   # front matter, topics, internal links, allowed HTML
# Real WordPress in Docker (PHP 8.2, MariaDB, stub of the pyxis theme that loads the
# live CSS and Timber 1.24.1 / Twig 2.16.0 rendering path). The test-only Composer
config permits those legacy dependencies to match production; never deploy its
`vendor/` directory. Run on a Docker host such as kobivps, not on the live server:
services/learning-center/test/run-wordpress.sh up      # http://127.0.0.1:8791
services/learning-center/test/run-wordpress.sh check   # URLs, templates, titles, redirects, 404s, idempotent import
services/learning-center/test/run-wordpress.sh down
```

The plugin requires PHP 7.4 or later. Lint the plugin with
`docker run --rm -v "$PWD":/app -w /app php:7.4-cli php -l <file>`.
