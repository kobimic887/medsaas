<?php
/**
 * Plugin Name: Pyxis Stock Catalog
 * Description: Pyxis-branded browse page for the stock screening compounds. Add the shortcode [pyxis_stock_catalog] to a page.
 * Version: 1.1.0
 * Requires PHP: 7.4
 * Author: Pyxis Discovery
 *
 * Data is the Asinex stock shop (stock.asinex.com:5443/api/Shop) and its
 * CloudFront structure images (compounds.asinex.com). The shop API sends no
 * CORS headers, so browsers on this site cannot call it directly; this plugin
 * exposes a fixed, read-only proxy at /wp-json/pyxis-catalog/v1/compounds.
 * Only sort, order and page pass through — never SMILES, codes or filters.
 *
 * The site's "pyxis" theme builds pages from its own sections and never prints
 * the editor content, so a page whose content holds the shortcode is rendered
 * with this plugin's template (theme header + title + catalog + theme footer).
 */

defined('ABSPATH') || exit;

const PYXIS_CATALOG_VERSION = '1.1.0';
const PYXIS_CATALOG_UPSTREAM = 'https://stock.asinex.com:5443/api/Shop';
const PYXIS_CATALOG_PAGE_SIZE = 25;
// Upstream orderBy codes. The shop's library order runs Z→A for "asc", so it is
// inverted here to give the widget an alphabetical "asc".
const PYXIS_CATALOG_SORTS = array(
	'id'           => array( 'orderBy' => 1, 'invert' => false ),
	'library'      => array( 'orderBy' => 2, 'invert' => true ),
	'mw'           => array( 'orderBy' => 3, 'invert' => false ),
	'availability' => array( 'orderBy' => 4, 'invert' => false ),
);
// Pages beyond this are not cached server-side, so crawlers walking 25k pages
// per sort cannot fill wp_options with transients.
const PYXIS_CATALOG_CACHED_PAGES = 40;
const PYXIS_CATALOG_CACHE_SECONDS = 600;
const PYXIS_CATALOG_MAX_PAGE = 100000;

add_action( 'rest_api_init', 'pyxis_catalog_register_routes' );
add_shortcode( 'pyxis_stock_catalog', 'pyxis_catalog_shortcode' );
add_filter( 'template_include', 'pyxis_catalog_template_include', 99 );

function pyxis_catalog_template_include( $template ) {
	if ( is_page() && has_shortcode( (string) get_post_field( 'post_content', get_queried_object_id() ), 'pyxis_stock_catalog' ) ) {
		return __DIR__ . '/templates/catalog-page.php';
	}
	return $template;
}

function pyxis_catalog_register_routes() {
	register_rest_route(
		'pyxis-catalog/v1',
		'/compounds',
		array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => 'pyxis_catalog_compounds',
			'args'                => array(
				'sort'  => array(
					'type'    => 'string',
					'enum'    => array_keys( PYXIS_CATALOG_SORTS ),
					'default' => 'id',
				),
				'order' => array(
					'type'    => 'string',
					'enum'    => array( 'asc', 'desc' ),
					'default' => 'desc',
				),
				'page'  => array(
					'type'    => 'integer',
					'minimum' => 0,
					'maximum' => PYXIS_CATALOG_MAX_PAGE,
					'default' => 0,
				),
			),
		)
	);
}

function pyxis_catalog_compounds( $request ) {
	$sort  = $request['sort'];
	$order = $request['order'];
	$page  = (int) $request['page'];

	$cacheable = $page < PYXIS_CATALOG_CACHED_PAGES;
	$cache_key = 'pyxis_catalog_v1_' . $sort . '_' . $order . '_' . $page;
	$payload   = $cacheable ? get_transient( $cache_key ) : false;

	if ( false === $payload ) {
		$payload = pyxis_catalog_fetch( $sort, $order, $page );
		if ( is_wp_error( $payload ) ) {
			return $payload;
		}
		if ( $cacheable ) {
			set_transient( $cache_key, $payload, PYXIS_CATALOG_CACHE_SECONDS );
		}
	}

	$response = new WP_REST_Response( $payload, 200 );
	$response->header( 'Cache-Control', 'public, max-age=' . PYXIS_CATALOG_CACHE_SECONDS );
	return $response;
}

function pyxis_catalog_fetch( $sort, $order, $page ) {
	$spec           = PYXIS_CATALOG_SORTS[ $sort ];
	$upstream_order = ( 'asc' === $order ) !== $spec['invert'] ? 'asc' : 'desc';
	// The filter bounds mirror the shop's own browse request; in browse mode
	// (searchMode 0) the shop returns the whole catalog.
	$body = array(
		'searchMode' => 0,
		'smiles'     => '',
		'codes'      => array( '' ),
		'requestid'  => null,
		'orderBy'    => $spec['orderBy'],
		'page'       => $page,
		'order'      => $upstream_order,
		'perPage'    => PYXIS_CATALOG_PAGE_SIZE,
		'minMW'      => 0,
		'maxMW'      => 500,
		'minHAC'     => 0,
		'maxHAC'     => 5,
		'minCLP'     => -10,
		'maxCLP'     => 10,
		'headers'    => new stdClass(),
	);

	$result = wp_remote_post(
		PYXIS_CATALOG_UPSTREAM,
		array(
			'timeout' => 20,
			'headers' => array(
				'Content-Type' => 'application/json',
				'Accept'       => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		)
	);
	$unavailable = new WP_Error( 'pyxis_catalog_unavailable', 'The compound catalog is temporarily unavailable.', array( 'status' => 502 ) );
	if ( is_wp_error( $result ) || 200 !== (int) wp_remote_retrieve_response_code( $result ) ) {
		return $unavailable;
	}
	$data = json_decode( wp_remote_retrieve_body( $result ), true );
	// The shop answers some failures with HTTP 200 and a SystemError object.
	if ( ! is_array( $data ) || ! isset( $data['list'] ) || ! is_array( $data['list'] ) ) {
		return $unavailable;
	}

	$rows = array();
	foreach ( $data['list'] as $item ) {
		$code = isset( $item['baS_CODE'] ) ? trim( (string) $item['baS_CODE'] ) : '';
		if ( ! preg_match( '/^[A-Z0-9]{2,6} \d+$/', $code ) ) {
			continue;
		}
		$rows[] = array(
			'code'      => $code,
			'smiles'    => isset( $item['smiles'] ) ? (string) $item['smiles'] : '',
			'mw'        => isset( $item['molwt'] ) ? (float) $item['molwt'] : null,
			'formula'   => isset( $item['molformula'] ) ? str_replace( ' ', '', (string) $item['molformula'] ) : '',
			'available' => isset( $item['availablE_STRING'] ) ? (string) $item['availablE_STRING'] : '',
		);
	}

	return array(
		'total'    => isset( $data['totalFound'] ) ? (int) $data['totalFound'] : 0,
		'pageSize' => PYXIS_CATALOG_PAGE_SIZE,
		'page'     => $page,
		'rows'     => $rows,
	);
}

function pyxis_catalog_shortcode( $atts ) {
	$atts = shortcode_atts(
		array( 'shop_url' => 'https://app.pyxis-discovery.com/dashboard/simulation' ),
		$atts,
		'pyxis_stock_catalog'
	);
	$base = plugins_url( 'assets/', __FILE__ );
	wp_enqueue_style( 'pyxis-stock-catalog', $base . 'pyxis-catalog.css', array(), PYXIS_CATALOG_VERSION );
	// A module script, printed inline with its mount point so it works with any
	// theme and WordPress version (wp_enqueue_script_module needs 6.5+).
	return sprintf(
		'<div data-pyxis-catalog data-api="%s" data-shop-url="%s"></div><script type="module" src="%s"></script>',
		esc_url( rest_url( 'pyxis-catalog/v1/compounds' ) ),
		esc_url( $atts['shop_url'] ),
		esc_url( $base . 'pyxis-catalog.js?ver=' . PYXIS_CATALOG_VERSION )
	);
}
