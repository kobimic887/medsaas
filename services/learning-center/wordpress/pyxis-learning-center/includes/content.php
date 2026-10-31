<?php
/**
 * Starter content: content/topics.json and content/articles/*.html.
 *
 * Each article file starts with a front-matter block:
 *
 *   ---
 *   title: What is molecular docking?
 *   topic: molecular-docking
 *   order: 1
 *   term: Molecular docking
 *   summary: One or two sentences.
 *   objectives:
 *   - First objective
 *   - Second objective
 *   ---
 *   <p>Body HTML …</p>
 *
 * The file name (without .html) is the article slug. The importer creates only
 * topics and articles whose slug does not exist yet (in any status, including
 * trash), so it never overwrites an edit and never resurrects a deleted article
 * on re-run. services/learning-center/test.mjs parses the same format.
 */

defined( 'ABSPATH' ) || exit;

function pyxis_learn_content_dir() {
	return dirname( __DIR__ ) . '/content';
}

/** @return array{meta: array, body: string}|null */
function pyxis_learn_parse_article( $raw ) {
	$raw = str_replace( "\r\n", "\n", $raw );
	if ( ! preg_match( '/^---\n(.*?)\n---\n(.*)$/s', $raw, $m ) ) {
		return null;
	}
	$meta = array();
	$list = null;
	foreach ( explode( "\n", $m[1] ) as $line ) {
		if ( null !== $list && preg_match( '/^-\s+(.*)$/', $line, $item ) ) {
			$meta[ $list ][] = trim( $item[1] );
			continue;
		}
		if ( preg_match( '/^([a-z_]+):\s*(.*)$/', $line, $kv ) ) {
			$key   = $kv[1];
			$value = trim( $kv[2] );
			if ( '' === $value ) {
				$list          = $key;
				$meta[ $key ] = array();
			} else {
				$list          = null;
				$meta[ $key ] = $value;
			}
		}
	}
	return array(
		'meta' => $meta,
		'body' => trim( $m[2] ) . "\n",
	);
}

/** @return array<string,int> topic slug => term id */
function pyxis_learn_import_topics() {
	$file   = pyxis_learn_content_dir() . '/topics.json';
	$topics = json_decode( (string) file_get_contents( $file ), true );
	$ids    = array();
	if ( ! is_array( $topics ) ) {
		return $ids;
	}
	foreach ( $topics as $index => $topic ) {
		$existing = get_term_by( 'slug', $topic['slug'], PYXIS_LEARN_TOPIC );
		if ( $existing ) {
			$ids[ $topic['slug'] ] = (int) $existing->term_id;
			continue;
		}
		$created = wp_insert_term(
			$topic['name'],
			PYXIS_LEARN_TOPIC,
			array(
				'slug'        => $topic['slug'],
				'description' => $topic['description'],
			)
		);
		if ( is_wp_error( $created ) ) {
			continue;
		}
		$ids[ $topic['slug'] ] = (int) $created['term_id'];
		update_term_meta( $created['term_id'], 'pyxis_learn_order', ( $index + 1 ) * 10 );
	}
	return $ids;
}

/**
 * @return array{created: string[], skipped: string[], failed: string[]}
 */
function pyxis_learn_import_starter_content() {
	$report = array(
		'created' => array(),
		'skipped' => array(),
		'failed'  => array(),
	);
	$topics = pyxis_learn_import_topics();
	$files  = glob( pyxis_learn_content_dir() . '/articles/*.html' );
	sort( $files );

	foreach ( $files as $file ) {
		$slug   = basename( $file, '.html' );
		$parsed = pyxis_learn_parse_article( (string) file_get_contents( $file ) );
		$meta   = $parsed ? $parsed['meta'] : array();
		if ( ! $parsed || empty( $meta['title'] ) || empty( $meta['topic'] ) || ! isset( $topics[ $meta['topic'] ] ) ) {
			$report['failed'][] = $slug;
			continue;
		}
		$existing = get_posts(
			array(
				'post_type'      => PYXIS_LEARN_TYPE,
				'name'           => $slug,
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'fields'         => 'ids',
			)
		);
		// get_posts() with post_status "any" excludes trash; check it too.
		$trashed = get_posts(
			array(
				'post_type'      => PYXIS_LEARN_TYPE,
				'name'           => $slug . '__trashed',
				'post_status'    => 'trash',
				'posts_per_page' => 1,
				'fields'         => 'ids',
			)
		);
		if ( $existing || $trashed ) {
			$report['skipped'][] = $slug;
			continue;
		}

		$post_id = wp_insert_post(
			array(
				'post_type'    => PYXIS_LEARN_TYPE,
				'post_status'  => 'publish',
				'post_name'    => $slug,
				'post_title'   => $meta['title'],
				'post_content' => $parsed['body'],
				'meta_input'   => array(
					'pyxis_learn_term'       => isset( $meta['term'] ) ? $meta['term'] : '',
					'pyxis_learn_summary'    => isset( $meta['summary'] ) ? $meta['summary'] : '',
					'pyxis_learn_objectives' => isset( $meta['objectives'] ) ? implode( "\n", (array) $meta['objectives'] ) : '',
					'pyxis_learn_order'      => isset( $meta['order'] ) ? (int) $meta['order'] : 0,
				),
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			$report['failed'][] = $slug;
			continue;
		}
		wp_set_object_terms( $post_id, array( $topics[ $meta['topic'] ] ), PYXIS_LEARN_TOPIC );
		$report['created'][] = $slug;
	}
	return $report;
}
