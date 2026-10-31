// WordPress REST client for the Insights custom post type (pyxis_insights).
// Auth is a WordPress application password (Users → Profile → Application
// Passwords) for a user that can publish Insights — an Editor, not an admin.
export class WordPress {
  constructor({ url, user, appPassword }, { fetchImpl = fetch } = {}) {
    this.base = `${url.replace(/\/$/, '')}/wp-json`;
    this.url = url.replace(/\/$/, '');
    this.auth = user && appPassword ? `Basic ${Buffer.from(`${user}:${appPassword.replace(/\s+/g, '')}`).toString('base64')}` : null;
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', body, auth = true } = {}) {
    if (auth && !this.auth) throw new Error('WP_USER and WP_APP_PASSWORD are required');
    const response = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth ? { Authorization: this.auth } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`WordPress ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }

  /** Published Learning Center articles (public; empty when the plugin is not installed). */
  async learnLinks() {
    try {
      const posts = await this.request('/wp/v2/pyxis_learn?per_page=100&_fields=link,title', { auth: false });
      return posts.map((post) => ({ title: post.title.rendered.replace(/&#8217;/g, '’').replace(/&amp;/g, '&'), url: post.link }));
    } catch {
      return [];
    }
  }

  async tagId(slug) {
    const tags = await this.request(`/wp/v2/pyxis-insights-tag?slug=${encodeURIComponent(slug)}&_fields=id`, { auth: false });
    if (!tags[0]?.id) throw new Error(`Insights tag "${slug}" not found`);
    return tags[0].id;
  }

  /** True when any Insight (in any status) already cites this PMID. */
  async alreadyCovered(pmid) {
    const posts = await this.request(
      `/wp/v2/pyxis_insights?search=${encodeURIComponent(pmid)}&status=publish,draft,pending,future,private&context=edit&_fields=id,content`,
    );
    return posts.some((post) => String(post.content?.raw ?? '').includes(`/${pmid}/`));
  }

  async createInsight({ title, html, slug, status, tagIds = [], featuredMedia }) {
    const post = await this.request('/wp/v2/pyxis_insights', {
      method: 'POST',
      body: {
        title,
        content: html,
        slug,
        status,
        'pyxis-insights-tag': tagIds,
        ...(featuredMedia ? { featured_media: Number(featuredMedia) } : {}),
      },
    });
    return { id: post.id, link: post.link, editLink: `${this.url}/wp-admin/post.php?post=${post.id}&action=edit` };
  }
}
