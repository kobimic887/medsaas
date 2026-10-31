/* Learning Center hub search: filters the article links already on the page.
   No network requests; every published article is listed in the topic grid. */
(function () {
  var input = document.querySelector('[data-pxl-search-input]');
  var topics = document.querySelector('[data-pxl-topics]');
  var results = document.querySelector('[data-pxl-results]');
  if (!input || !topics || !results) return;

  var list = results.querySelector('[data-pxl-results-list]');
  var status = results.querySelector('[data-pxl-results-status]');
  var seen = {};
  var articles = [];
  topics.querySelectorAll('a[data-pxl-search]').forEach(function (link) {
    if (seen[link.href]) return;
    seen[link.href] = true;
    articles.push({
      href: link.href,
      title: link.textContent.trim(),
      summary: link.getAttribute('data-pxl-summary') || '',
      haystack: link.getAttribute('data-pxl-search') || '',
    });
  });

  function card(article) {
    var a = document.createElement('a');
    a.className = 'pxl-card';
    a.href = article.href;
    var title = document.createElement('span');
    title.className = 'pxl-card__title';
    title.textContent = article.title;
    var summary = document.createElement('span');
    summary.className = 'pxl-card__summary';
    summary.textContent = article.summary;
    a.append(title, summary);
    return a;
  }

  function update() {
    var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || input.value.trim().length < 2) {
      results.hidden = true;
      topics.hidden = false;
      return;
    }
    var matches = articles.filter(function (article) {
      return words.every(function (word) {
        return article.haystack.indexOf(word) !== -1;
      });
    });
    list.replaceChildren.apply(list, matches.map(card));
    status.textContent = matches.length
      ? matches.length + (matches.length === 1 ? ' article' : ' articles') + ' found'
      : 'No articles match "' + input.value.trim() + '".';
    results.hidden = false;
    topics.hidden = true;
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      input.value = '';
      update();
    }
  });
})();
