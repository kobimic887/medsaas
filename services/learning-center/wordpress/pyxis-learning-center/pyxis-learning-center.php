<?php
/**
 * Plugin Name: Pyxis Learning Center
 * Description: Educational "What is …?" articles grouped by topic, served at /learning/ (hub, topic pages, articles and an A–Z glossary). Activating the plugin imports the starter articles once.
 * Version: 1.0.0
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * Author: Pyxis Discovery
 *
 * URLs (own rewrite rules; the CPT and taxonomy register with rewrite => false
 * so WordPress cannot generate competing patterns):
 *   /learning/                    hub (post type archive)
 *   /learning/glossary/           A–Z glossary of every article's term
 *   /learning/<topic>/            topic page (pyxis_learn_topic term)
 *   /learning/<topic>/<article>/  article (pyxis_learn post)
 * "glossary" is therefore a reserved topic slug.
 *
 * The site's "pyxis" theme renders through Timber/Twig and never prints editor
 * content for these types, so every Learning Center view uses this plugin's
 * templates: theme header, plugin markup, theme footer (as the stock catalog
 * plugin does).
 */

defined( 'ABSPATH' ) || exit;

const PYXIS_LEARN_VERSION = '1.0.0';
const PYXIS_LEARN_TYPE    = 'pyxis_learn';
const PYXIS_LEARN_TOPIC   = 'pyxis_learn_topic';
const PYXIS_LEARN_BASE    = 'learning';
// Stored option; when it differs from PYXIS_LEARN_VERSION the rewrite rules are
// flushed once, so updating the plugin by upload (which skips activation) still
// picks up URL changes.
const PYXIS_LEARN_RULES_OPTION = 'pyxis_learn_rules_version';

require_once __DIR__ . '/includes/content.php';
require_once __DIR__ . '/includes/admin.php';

add_action( 'init', 'pyxis_learn_register' );
add_action( 'init', 'pyxis_learn_maybe_flush', 99 );
add_filter( 'query_vars', 'pyxis_learn_query_vars' );
add_filter( 'post_type_link', 'pyxis_learn_post_link', 10, 2 );
add_filter( 'term_link', 'pyxis_learn_term_link', 10, 3 );
add_filter( 'post_type_archive_link', 'pyxis_learn_archive_link', 10, 2 );
add_filter( 'template_include', 'pyxis_learn_template_include', 99 );
add_action( 'pre_get_posts', 'pyxis_learn_pre_get_posts' );
add_action( 'wp_enqueue_scripts', 'pyxis_learn_enqueue' );
add_filter( 'document_title_parts', 'pyxis_learn_title_parts' );
add_filter( 'wpseo_title', 'pyxis_learn_seo_title' );
add_filter( 'rank_math/frontend/title', 'pyxis_learn_seo_title' );
add_filter( 'wpseo_canonical', 'pyxis_learn_seo_canonical' );
add_filter( 'rank_math/frontend/canonical', 'pyxis_learn_seo_canonical' );
add_shortcode( 'pyxis_learn_link', 'pyxis_learn_link_shortcode' );

register_activation_hook( __FILE__, 'pyxis_learn_activate' );
register_deactivation_hook( __FILE__, 'pyxis_learn_deactivate' );

function pyxis_learn_register() {
	register_post_type(
		PYXIS_LEARN_TYPE,
		array(
			'labels'        => array(
				'name'          => 'Learning Center',
				'singular_name' => 'Learning article',
				'add_new_item'  => 'Add learning article',
				'edit_item'     => 'Edit learning article',
				'all_items'     => 'All articles',
				'menu_name'     => 'Learning Center',
			),
			'public'        => true,
			// Needed for is_post_type_archive(); the /learning/ rule is ours and
			// post_type_archive_link is filtered to it.
			'has_archive'   => true,
			'rewrite'       => false,
			'query_var'     => PYXIS_LEARN_TYPE,
			'show_in_rest'  => true,
			'rest_base'     => 'pyxis_learn',
			'menu_icon'     => 'dashicons-welcome-learn-more',
			'menu_position' => 21,
			'supports'      => array( 'title', 'editor', 'thumbnail', 'revisions', 'custom-fields', 'author' ),
		)
	);

	register_taxonomy(
		PYXIS_LEARN_TOPIC,
		PYXIS_LEARN_TYPE,
		array(
			'labels'            => array(
				'name'          => 'Topics',
				'singular_name' => 'Topic',
				'add_new_item'  => 'Add topic',
			),
			'public'            => true,
			'hierarchical'      => true,
			'rewrite'           => false,
			'query_var'         => PYXIS_LEARN_TOPIC,
			'show_in_rest'      => true,
			'show_admin_column' => true,
		)
	);

	// Plain keys (no leading underscore) so the REST API and the insights agent
	// can write them.
	$meta = array(
		'pyxis_learn_term'       => array( 'string', 'Glossary term, e.g. "Molecular docking".' ),
		'pyxis_learn_summary'    => array( 'string', 'One- or two-sentence definition for cards and the glossary.' ),
		'pyxis_learn_objectives' => array( 'string', 'Learning objectives, one per line.' ),
		'pyxis_learn_order'      => array( 'integer', 'Position inside its topic (low first).' ),
	);
	foreach ( $meta as $key => $spec ) {
		register_post_meta(
			PYXIS_LEARN_TYPE,
			$key,
			array(
				'type'          => $spec[0],
				'description'   => $spec[1],
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
	register_term_meta(
		PYXIS_LEARN_TOPIC,
		'pyxis_learn_order',
		array(
			'type'         => 'integer',
			'single'       => true,
			'show_in_rest' => true,
		)
	);

	$base = PYXIS_LEARN_BASE;
	add_rewrite_rule( "^{$base}/?$", 'index.php?post_type=' . PYXIS_LEARN_TYPE, 'top' );
	add_rewrite_rule( "^{$base}/glossary/?$", 'index.php?post_type=' . PYXIS_LEARN_TYPE . '&pyxis_learn_view=glossary', 'top' );
	add_rewrite_rule( "^{$base}/([^/]+)/?$", 'index.php?' . PYXIS_LEARN_TOPIC . '=$matches[1]', 'top' );
	add_rewrite_rule( "^{$base}/([^/]+)/([^/]+)/?$", 'index.php?' . PYXIS_LEARN_TYPE . '=$matches[2]&pyxis_learn_in=$matches[1]', 'top' );
}

function pyxis_learn_query_vars( $vars ) {
	$vars[] = 'pyxis_learn_view';
	$vars[] = 'pyxis_learn_in';
	return $vars;
}

function pyxis_learn_activate() {
	pyxis_learn_register();
	flush_rewrite_rules();
	update_option( PYXIS_LEARN_RULES_OPTION, PYXIS_LEARN_VERSION );
	// Starter content is created only where the slug is missing; edits made in
	// WordPress are never overwritten.
	pyxis_learn_import_starter_content();
}

function pyxis_learn_deactivate() {
	flush_rewrite_rules();
	delete_option( PYXIS_LEARN_RULES_OPTION );
}

function pyxis_learn_maybe_flush() {
	if ( get_option( PYXIS_LEARN_RULES_OPTION ) !== PYXIS_LEARN_VERSION ) {
		flush_rewrite_rules();
		update_option( PYXIS_LEARN_RULES_OPTION, PYXIS_LEARN_VERSION );
	}
}

/** The topic an article lives under: its lowest-ordered topic term. */
function pyxis_learn_primary_topic( $post ) {
	$terms = get_the_terms( $post, PYXIS_LEARN_TOPIC );
	if ( ! $terms || is_wp_error( $terms ) ) {
		return null;
	}
	usort( $terms, 'pyxis_learn_compare_topics' );
	return $terms[0];
}

function pyxis_learn_post_link( $link, $post ) {
	if ( PYXIS_LEARN_TYPE !== $post->post_type || 'publish' !== $post->post_status ) {
		return $link;
	}
	$topic = pyxis_learn_primary_topic( $post );
	$slug  = $topic ? $topic->slug : 'general';
	return home_url( user_trailingslashit( PYXIS_LEARN_BASE . '/' . $slug . '/' . $post->post_name ) );
}

function pyxis_learn_term_link( $link, $term, $taxonomy ) {
	if ( PYXIS_LEARN_TOPIC !== $taxonomy ) {
		return $link;
	}
	return home_url( user_trailingslashit( PYXIS_LEARN_BASE . '/' . $term->slug ) );
}

function pyxis_learn_archive_link( $link, $post_type ) {
	return PYXIS_LEARN_TYPE === $post_type ? pyxis_learn_hub_url() : $link;
}

function pyxis_learn_hub_url() {
	return home_url( user_trailingslashit( PYXIS_LEARN_BASE ) );
}

function pyxis_learn_glossary_url() {
	return home_url( user_trailingslashit( PYXIS_LEARN_BASE . '/glossary' ) );
}

function pyxis_learn_is_glossary() {
	return is_post_type_archive( PYXIS_LEARN_TYPE ) && 'glossary' === get_query_var( 'pyxis_learn_view' );
}

/**
 * Articles are ordered by their meta order then title. An article requested
 * under the wrong topic (/learning/other-topic/article/) redirects to its
 * canonical URL instead of rendering a duplicate.
 */
function pyxis_learn_pre_get_posts( $query ) {
	if ( is_admin() || ! $query->is_main_query() ) {
		return;
	}
	if ( $query->is_post_type_archive( PYXIS_LEARN_TYPE ) || $query->is_tax( PYXIS_LEARN_TOPIC ) ) {
		$query->set( 'posts_per_page', -1 );
		$query->set( 'orderby', array( 'title' => 'ASC' ) );
	}
}

add_action( 'template_redirect', 'pyxis_learn_canonical_redirect' );
function pyxis_learn_canonical_redirect() {
	if ( ! is_singular( PYXIS_LEARN_TYPE ) ) {
		return;
	}
	$requested = get_query_var( 'pyxis_learn_in' );
	$topic     = pyxis_learn_primary_topic( get_queried_object() );
	if ( $requested && $topic && $requested !== $topic->slug ) {
		wp_safe_redirect( get_permalink( get_queried_object() ), 301 );
		exit;
	}
}

function pyxis_learn_template_include( $template ) {
	if ( pyxis_learn_is_glossary() ) {
		return __DIR__ . '/templates/glossary.php';
	}
	if ( is_post_type_archive( PYXIS_LEARN_TYPE ) ) {
		return __DIR__ . '/templates/hub.php';
	}
	if ( is_tax( PYXIS_LEARN_TOPIC ) ) {
		return __DIR__ . '/templates/topic.php';
	}
	if ( is_singular( PYXIS_LEARN_TYPE ) ) {
		return __DIR__ . '/templates/article.php';
	}
	return $template;
}

function pyxis_learn_is_view() {
	return is_post_type_archive( PYXIS_LEARN_TYPE ) || is_tax( PYXIS_LEARN_TOPIC ) || is_singular( PYXIS_LEARN_TYPE );
}

function pyxis_learn_enqueue() {
	if ( ! pyxis_learn_is_view() ) {
		return;
	}
	$base = plugins_url( 'assets/', __FILE__ );
	wp_enqueue_style( 'pyxis-learning-center', $base . 'learning.css', array(), PYXIS_LEARN_VERSION );
	wp_enqueue_script( 'pyxis-learning-center', $base . 'learning.js', array(), PYXIS_LEARN_VERSION, true );
}

function pyxis_learn_title_parts( $parts ) {
	if ( pyxis_learn_is_glossary() ) {
		$parts['title'] = 'Glossary – Learning Center';
	} elseif ( is_post_type_archive( PYXIS_LEARN_TYPE ) ) {
		$parts['title'] = 'Learning Center';
	} elseif ( is_tax( PYXIS_LEARN_TOPIC ) ) {
		$parts['title'] = single_term_title( '', false ) . ' – Learning Center';
	}
	return $parts;
}

/** SEO plugins build their own titles; only the views they cannot name are changed. */
function pyxis_learn_seo_title( $title ) {
	if ( pyxis_learn_is_glossary() ) {
		return 'Drug discovery glossary – Learning Center – ' . get_bloginfo( 'name' );
	}
	if ( is_post_type_archive( PYXIS_LEARN_TYPE ) ) {
		return 'Learning Center – ' . get_bloginfo( 'name' );
	}
	return $title;
}

function pyxis_learn_seo_canonical( $url ) {
	if ( pyxis_learn_is_glossary() ) {
		return pyxis_learn_glossary_url();
	}
	if ( is_post_type_archive( PYXIS_LEARN_TYPE ) ) {
		return pyxis_learn_hub_url();
	}
	return $url;
}

/** [pyxis_learn_link slug="what-is-molecular-docking"]docking[/pyxis_learn_link] */
function pyxis_learn_link_shortcode( $atts, $content = '' ) {
	$atts = shortcode_atts( array( 'slug' => '' ), $atts, 'pyxis_learn_link' );
	$text = '' !== $content ? do_shortcode( $content ) : '';
	$post = $atts['slug'] ? get_page_by_path( sanitize_title( $atts['slug'] ), OBJECT, PYXIS_LEARN_TYPE ) : null;
	if ( ! $post || 'publish' !== $post->post_status ) {
		// An unpublished target degrades to plain text, never a broken link.
		return '' !== $text ? $text : esc_html( $atts['slug'] );
	}
	if ( '' === $text ) {
		$text = esc_html( get_the_title( $post ) );
	}
	return '<a href="' . esc_url( get_permalink( $post ) ) . '">' . $text . '</a>';
}

/* ---------- Data helpers for the templates ---------- */

function pyxis_learn_compare_topics( $a, $b ) {
	$oa = (int) get_term_meta( $a->term_id, 'pyxis_learn_order', true );
	$ob = (int) get_term_meta( $b->term_id, 'pyxis_learn_order', true );
	return $oa === $ob ? strcasecmp( $a->name, $b->name ) : $oa - $ob;
}

/** Topics that hold at least one published article, in display order. */
function pyxis_learn_topics() {
	$terms = get_terms(
		array(
			'taxonomy'   => PYXIS_LEARN_TOPIC,
			'hide_empty' => true,
		)
	);
	if ( is_wp_error( $terms ) ) {
		return array();
	}
	usort( $terms, 'pyxis_learn_compare_topics' );
	return $terms;
}

/** Published articles of a topic, ordered by pyxis_learn_order then title. */
function pyxis_learn_topic_articles( $term ) {
	$posts = get_posts(
		array(
			'post_type'      => PYXIS_LEARN_TYPE,
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'tax_query'      => array(
				array(
					'taxonomy'         => PYXIS_LEARN_TOPIC,
					'terms'            => $term->term_id,
					'include_children' => false,
				),
			),
		)
	);
	usort( $posts, 'pyxis_learn_compare_articles' );
	return $posts;
}

function pyxis_learn_compare_articles( $a, $b ) {
	$oa = (int) get_post_meta( $a->ID, 'pyxis_learn_order', true );
	$ob = (int) get_post_meta( $b->ID, 'pyxis_learn_order', true );
	return $oa === $ob ? strcasecmp( $a->post_title, $b->post_title ) : $oa - $ob;
}

function pyxis_learn_summary( $post ) {
	$summary = trim( (string) get_post_meta( $post->ID, 'pyxis_learn_summary', true ) );
	if ( '' === $summary ) {
		$summary = wp_trim_words( wp_strip_all_tags( strip_shortcodes( $post->post_content ) ), 28 );
	}
	return $summary;
}

function pyxis_learn_term_label( $post ) {
	$term = trim( (string) get_post_meta( $post->ID, 'pyxis_learn_term', true ) );
	if ( '' !== $term ) {
		return $term;
	}
	// "What is a macrocycle?" -> "Macrocycle"
	$title = preg_replace( '/^what (is|are) (an? |the )?/i', '', get_the_title( $post ) );
	return ucfirst( rtrim( $title, '?' ) );
}

function pyxis_learn_objectives( $post ) {
	$raw = (string) get_post_meta( $post->ID, 'pyxis_learn_objectives', true );
	return array_values( array_filter( array_map( 'trim', preg_split( '/\R/', $raw ) ) ) );
}

/** Link to the Pyxis web app; filterable so the site can point elsewhere. */
function pyxis_learn_app_url() {
	return apply_filters( 'pyxis_learn_app_url', 'https://app.pyxis-discovery.com/auth/sign-in' );
}

function pyxis_learn_template_part( $name, $vars = array() ) {
	// phpcs:ignore WordPress.PHP.DontExtract -- template locals only.
	extract( $vars, EXTR_SKIP );
	include __DIR__ . '/templates/parts/' . $name . '.php';
}
