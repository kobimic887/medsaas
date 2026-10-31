#!/usr/bin/env bash
# Throwaway WordPress (Docker) with the Learning Center plugin and the pyxis
# stub theme, for checking URLs, templates and the importer. Needs Docker; run
# on a dev host such as kobivps, never on the live WordPress server.
#   services/learning-center/test/run-wordpress.sh up     # http://127.0.0.1:8791
#   services/learning-center/test/run-wordpress.sh check  # URL + importer checks
#   services/learning-center/test/run-wordpress.sh down
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$here/../wordpress/pyxis-learning-center"
port="${PXL_PORT:-8791}"
url="http://127.0.0.1:$port"
net=pxl-test
wpcli() { docker run --rm --network "$net" --user 33:33 -e WORDPRESS_DB_HOST=pxl-db -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp -e WORDPRESS_DB_NAME=wp --volumes-from pxl-wp wordpress:cli wp "$@"; }

case "${1:-up}" in
up)
  # PXL_TIMBER=1 (default) installs Timber 1.24.1 into the stub theme, matching
  # the live theme's rendering path; PXL_TIMBER=0 tests the get_header() fallback.
  if [ "${PXL_TIMBER:-1}" = 1 ]; then
    docker run --rm --user "$(id -u):$(id -g)" -v "$here/pyxis-stub-theme:/app" -w /app composer:2 install --no-dev --quiet --ignore-platform-reqs
  else
    rm -rf "$here/pyxis-stub-theme/vendor"
  fi
  docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" >/dev/null
  docker run -d --name pxl-db --network "$net" -e MARIADB_DATABASE=wp -e MARIADB_USER=wp -e MARIADB_PASSWORD=wp -e MARIADB_RANDOM_ROOT_PASSWORD=1 mariadb:11 >/dev/null
  docker run -d --name pxl-wp --network "$net" -p "127.0.0.1:$port:80" \
    -e WORDPRESS_DB_HOST=pxl-db -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp -e WORDPRESS_DB_NAME=wp \
    -v "$plugin:/var/www/html/wp-content/plugins/pyxis-learning-center:ro" \
    -v "$here/pyxis-stub-theme:/var/www/html/wp-content/themes/pyxis-stub:ro" \
    wordpress:php8.2-apache >/dev/null
  for _ in $(seq 60); do wpcli core is-installed >/dev/null 2>&1 && break; wpcli db check >/dev/null 2>&1 && break; sleep 2; done
  wpcli core install --url="$url" --title="Pyxis Discovery" --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
  wpcli rewrite structure '/%postname%/'
  wpcli theme activate pyxis-stub
  wpcli plugin activate pyxis-learning-center
  # Insights agent fixtures: the live tags, and an Editor with an application
  # password (WP_ENVIRONMENT_TYPE=local allows application passwords over http).
  wpcli config set WP_ENVIRONMENT_TYPE local
  for tag in Event Insight News Publication; do wpcli term create pyxis-insights-tag "$tag" >/dev/null; done
  wpcli user create insights-agent agent@example.com --role=editor >/dev/null
  wpcli rewrite flush
  echo "WordPress: $url (admin/admin)"
  ;;
check)
  status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
  fails=0
  expect() { got="$(status "$url$2")"; if [ "$got" = "$1" ]; then echo "ok   $1 $2"; else echo "FAIL $got (want $1) $2"; fails=$((fails+1)); fi; }
  # A 200 alone is not enough: the theme's index.php also answers 200.
  # Capture first: under pipefail, grep -q closing the pipe early fails curl.
  renders() { local page; page="$(curl -s "$url$1")"; if grep -qF "$2" <<<"$page"; then echo "ok   $1 renders $2"; else echo "FAIL $1 does not render $2"; fails=$((fails+1)); fi; }
  expect 200 /learning/
  expect 200 /learning/glossary/
  expect 200 /learning/macrocycles/
  expect 200 /learning/macrocycles/what-is-a-macrocycle/
  expect 200 /learning/molecular-docking/what-is-diffdock/
  if [ -d "$here/pyxis-stub-theme/vendor" ]; then
    renders /learning/ 'data-stub="timber-header"'
    renders /learning/macrocycles/what-is-a-macrocycle/ 'data-stub="timber-footer"'
  fi
  renders /learning/ 'class="pxl-hero"'
  renders /learning/glossary/ 'class="pxl-glossary"'
  renders /learning/macrocycles/ 'class="pxl-grid"'
  renders /learning/macrocycles/what-is-a-macrocycle/ 'class="pxl-main pxl-article"'
  renders /learning/ '<title>Learning Center'
  renders /learning/glossary/ '<title>Glossary'
  expect 301 /learning/cheminformatics/what-is-a-macrocycle/
  expect 404 /learning/no-such-topic/
  expect 404 /learning/macrocycles/no-such-article/
  count="$(wpcli post list --post_type=pyxis_learn --post_status=publish --format=count)"
  echo "published articles: $count"
  html="$(curl -s "$url/learning/macrocycles/what-is-a-macrocycle/")"
  grep -q 'pxl-objectives' <<<"$html" && echo "ok   objectives box" || { echo "FAIL objectives box"; fails=$((fails+1)); }
  grep -q 'href="'"$url"'/learning/macrocycles/what-is-beyond-rule-of-five/"' <<<"$html" && echo "ok   [pyxis_learn_link] resolves" || { echo "FAIL [pyxis_learn_link]"; fails=$((fails+1)); }
  grep -q '\[pyxis_learn_link' <<<"$html" && { echo "FAIL raw shortcode in output"; fails=$((fails+1)); } || echo "ok   no raw shortcodes"
  # Re-running the importer must not duplicate or overwrite.
  wpcli eval 'print_r( array_map( "count", pyxis_learn_import_starter_content() ) );'
  [ "$(wpcli post list --post_type=pyxis_learn --post_status=publish --format=count)" = "$count" ] && echo "ok   importer is idempotent" || { echo "FAIL importer duplicated"; fails=$((fails+1)); }
  exit "$fails"
  ;;
app-password)
  # Prints a fresh application password for the insights-agent test user.
  wpcli user application-password create insights-agent "insights-agent test" --porcelain
  ;;
down)
  docker rm -f pxl-wp pxl-db >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  ;;
esac
