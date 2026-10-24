<?php
// Minimal WordPress stand-in for exercising the plugin with `php -S` — no
// WordPress install needed. Only the functions the plugin calls are provided;
// REST argument validation mirrors WP's enum/integer checks.
//
//   php -S 127.0.0.1:8790 services/stock-catalog/test/wp-harness.php
//   → /                                   page with the shortcode rendered
//   → /wp-json/pyxis-catalog/v1/compounds  the proxy (live upstream)

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );
const HARNESS_PLUGIN_DIR = __DIR__ . '/../wordpress/pyxis-stock-catalog';

$GLOBALS['harness'] = array( 'actions' => array(), 'routes' => array(), 'transients' => array(), 'styles' => array() );

class WP_Error {
	public $code;
	public $message;
	public $data;
	public function __construct( $code, $message, $data = array() ) {
		$this->code    = $code;
		$this->message = $message;
		$this->data    = $data;
	}
}
class WP_REST_Response {
	public $data;
	public $status;
	public $headers = array();
	public function __construct( $data, $status ) {
		$this->data   = $data;
		$this->status = $status;
	}
	public function header( $name, $value ) {
		$this->headers[ $name ] = $value;
	}
}
function add_action( $hook, $callback ) { $GLOBALS['harness']['actions'][ $hook ][] = $callback; }
function add_shortcode( $tag, $callback ) {}
function register_rest_route( $namespace, $route, $spec ) { $GLOBALS['harness']['routes'][ "/$namespace$route" ] = $spec; }
function __return_true() { return true; }
function is_wp_error( $value ) { return $value instanceof WP_Error; }
function get_transient( $key ) { return $GLOBALS['harness']['transients'][ $key ] ?? false; }
function set_transient( $key, $value, $ttl ) { $GLOBALS['harness']['transients'][ $key ] = $value; }
function wp_json_encode( $value ) { return json_encode( $value ); }
function esc_url( $url ) { return htmlspecialchars( $url, ENT_QUOTES ); }
function rest_url( $path ) { return '/wp-json/' . $path; }
function plugins_url( $path, $file ) { return '/wp-content/plugins/pyxis-stock-catalog/' . $path; }
function wp_enqueue_style( $handle, $src, $deps, $ver ) { $GLOBALS['harness']['styles'][] = "$src?ver=$ver"; }
function shortcode_atts( $defaults, $atts ) { return array_merge( $defaults, array_intersect_key( (array) $atts, $defaults ) ); }
function wp_remote_post( $url, $args ) {
	$headers = array();
	foreach ( $args['headers'] as $name => $value ) {
		$headers[] = "$name: $value";
	}
	$context = stream_context_create( array( 'http' => array(
		'method' => 'POST', 'header' => implode( "\r\n", $headers ), 'content' => $args['body'],
		'timeout' => $args['timeout'], 'ignore_errors' => true,
	) ) );
	$body = @file_get_contents( $url, false, $context );
	if ( false === $body ) {
		return new WP_Error( 'http_request_failed', 'request failed' );
	}
	preg_match( '/^HTTP\/\S+ (\d+)/', $http_response_header[0], $match );
	return array( 'code' => (int) $match[1], 'body' => $body );
}
function wp_remote_retrieve_response_code( $response ) { return $response['code']; }
function wp_remote_retrieve_body( $response ) { return $response['body']; }

require HARNESS_PLUGIN_DIR . '/pyxis-stock-catalog.php';
foreach ( $GLOBALS['harness']['actions']['rest_api_init'] ?? array() as $callback ) {
	$callback();
}

function harness_json( $status, $data, $headers = array() ) {
	http_response_code( $status );
	header( 'Content-Type: application/json' );
	foreach ( $headers as $name => $value ) {
		header( "$name: $value" );
	}
	echo json_encode( $data );
}

function harness_rest( $route, $query ) {
	$spec = $GLOBALS['harness']['routes'][ $route ] ?? null;
	if ( ! $spec ) {
		return harness_json( 404, array( 'code' => 'rest_no_route' ) );
	}
	$params = array();
	foreach ( $spec['args'] as $name => $arg ) {
		$value = $query[ $name ] ?? $arg['default'];
		if ( 'integer' === $arg['type'] ) {
			if ( ! is_numeric( $value ) || (int) $value != $value || $value < $arg['minimum'] || $value > $arg['maximum'] ) {
				return harness_json( 400, array( 'code' => 'rest_invalid_param', 'param' => $name ) );
			}
			$value = (int) $value;
		}
		if ( isset( $arg['enum'] ) && ! in_array( $value, $arg['enum'], true ) ) {
			return harness_json( 400, array( 'code' => 'rest_invalid_param', 'param' => $name ) );
		}
		$params[ $name ] = $value;
	}
	$result = call_user_func( $spec['callback'], $params );
	if ( is_wp_error( $result ) ) {
		return harness_json( $result->data['status'], array( 'code' => $result->code, 'message' => $result->message ) );
	}
	return harness_json( $result->status, $result->data, $result->headers );
}

$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
if ( 0 === strpos( $path, '/wp-json/' ) ) {
	return harness_rest( substr( $path, strlen( '/wp-json' ) ), $_GET );
}
if ( preg_match( '#^/wp-content/plugins/pyxis-stock-catalog/(assets/[a-z.-]+\.(js|css))$#', $path, $match ) ) {
	header( 'Content-Type: ' . ( 'js' === $match[2] ? 'text/javascript' : 'text/css' ) );
	readfile( HARNESS_PLUGIN_DIR . '/' . $match[1] );
	return;
}
if ( '/' !== $path ) {
	http_response_code( 404 );
	return;
}
$markup = pyxis_catalog_shortcode( array() );
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stock compounds | Pyxis Discovery (harness)</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap">
<?php foreach ( $GLOBALS['harness']['styles'] as $href ) : ?>
<link rel="stylesheet" href="<?php echo esc_url( $href ); ?>">
<?php endforeach; ?>
<style>body { margin: 0; background: #f7f7f7; font-family: Poppins, sans-serif; }</style>
</head>
<body><?php echo $markup; ?></body>
</html>
