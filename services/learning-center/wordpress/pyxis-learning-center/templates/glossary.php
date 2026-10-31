<?php
/**
 * /learning/glossary/ — every published article's term, A–Z, with its summary.
 */
defined( 'ABSPATH' ) || exit;

$pyxis_learn_entries = array();
foreach ( get_posts(
	array(
		'post_type'      => PYXIS_LEARN_TYPE,
		'post_status'    => 'publish',
		'posts_per_page' => -1,
	)
) as $pyxis_learn_post ) {
	$pyxis_learn_entries[] = array(
		'term'    => pyxis_learn_term_label( $pyxis_learn_post ),
		'summary' => pyxis_learn_summary( $pyxis_learn_post ),
		'url'     => get_permalink( $pyxis_learn_post ),
	);
}
usort(
	$pyxis_learn_entries,
	function ( $a, $b ) {
		return strcasecmp( $a['term'], $b['term'] );
	}
);
$pyxis_learn_letters = array();
foreach ( $pyxis_learn_entries as $pyxis_learn_entry ) {
	$pyxis_learn_letter = strtoupper( substr( remove_accents( $pyxis_learn_entry['term'] ), 0, 1 ) );
	if ( ! preg_match( '/[A-Z]/', $pyxis_learn_letter ) ) {
		$pyxis_learn_letter = '#';
	}
	$pyxis_learn_letters[ $pyxis_learn_letter ][] = $pyxis_learn_entry;
}

get_header();
?>
<div class="pxl">
	<div class="sk-container pxl-layout">
		<?php
		pyxis_learn_template_part(
			'sidebar',
			array(
				'current_topic' => null,
				'current_id'    => 0,
			)
		);
		?>
		<div class="pxl-main">
			<?php
			pyxis_learn_template_part(
				'breadcrumbs',
				array(
					'crumbs' => array(
						array( 'Learning Center', pyxis_learn_hub_url() ),
						array( 'Glossary', null ),
					),
				)
			);
			?>
			<h1 class="pxl-title">Drug discovery glossary</h1>
			<p class="pxl-lead">Short definitions of the terms used across the Learning Center. Each links to the full article.</p>
			<nav class="pxl-letters" aria-label="Jump to letter">
				<?php foreach ( array_keys( $pyxis_learn_letters ) as $pyxis_learn_letter ) : ?>
					<a href="#pxl-letter-<?php echo esc_attr( '#' === $pyxis_learn_letter ? 'num' : $pyxis_learn_letter ); ?>"><?php echo esc_html( $pyxis_learn_letter ); ?></a>
				<?php endforeach; ?>
			</nav>
			<?php foreach ( $pyxis_learn_letters as $pyxis_learn_letter => $pyxis_learn_group ) : ?>
				<section class="pxl-glossary__group" id="pxl-letter-<?php echo esc_attr( '#' === $pyxis_learn_letter ? 'num' : $pyxis_learn_letter ); ?>">
					<h2 class="pxl-glossary__letter"><?php echo esc_html( $pyxis_learn_letter ); ?></h2>
					<dl class="pxl-glossary">
						<?php foreach ( $pyxis_learn_group as $pyxis_learn_entry ) : ?>
							<dt><a href="<?php echo esc_url( $pyxis_learn_entry['url'] ); ?>"><?php echo esc_html( $pyxis_learn_entry['term'] ); ?></a></dt>
							<dd><?php echo esc_html( $pyxis_learn_entry['summary'] ); ?></dd>
						<?php endforeach; ?>
					</dl>
				</section>
			<?php endforeach; ?>
		</div>
	</div>
</div>
<?php
get_footer();
