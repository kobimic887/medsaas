<?php
/**
 * /learning/<topic>/<article>/ — sidebar navigation, learning objectives,
 * body, next/related articles and CTA.
 */
defined( 'ABSPATH' ) || exit;

the_post();
$pyxis_learn_post       = get_post();
$pyxis_learn_topic      = pyxis_learn_primary_topic( $pyxis_learn_post );
$pyxis_learn_objectives = pyxis_learn_objectives( $pyxis_learn_post );
// Render before get_header() so shortcode output is final and nothing enqueued
// late misses <head>.
$pyxis_learn_content = apply_filters( 'the_content', get_the_content() );

$pyxis_learn_siblings = $pyxis_learn_topic ? pyxis_learn_topic_articles( $pyxis_learn_topic ) : array();
$pyxis_learn_related  = array();
foreach ( $pyxis_learn_siblings as $pyxis_learn_index => $pyxis_learn_sibling ) {
	if ( $pyxis_learn_sibling->ID === $pyxis_learn_post->ID ) {
		// The next articles in the topic first, then wrap to the start.
		$pyxis_learn_rest    = array_merge( array_slice( $pyxis_learn_siblings, $pyxis_learn_index + 1 ), array_slice( $pyxis_learn_siblings, 0, $pyxis_learn_index ) );
		$pyxis_learn_related = array_slice( $pyxis_learn_rest, 0, 3 );
		break;
	}
}

$pyxis_learn_crumbs = array( array( 'Learning Center', pyxis_learn_hub_url() ) );
if ( $pyxis_learn_topic ) {
	$pyxis_learn_crumbs[] = array( $pyxis_learn_topic->name, get_term_link( $pyxis_learn_topic ) );
}
$pyxis_learn_crumbs[] = array( pyxis_learn_term_label( $pyxis_learn_post ), null );

get_header();
?>
<div class="pxl">
	<div class="sk-container pxl-layout">
		<?php
		pyxis_learn_template_part(
			'sidebar',
			array(
				'current_topic' => $pyxis_learn_topic,
				'current_id'    => $pyxis_learn_post->ID,
			)
		);
		?>
		<article class="pxl-main pxl-article" id="post-<?php echo (int) $pyxis_learn_post->ID; ?>">
			<?php pyxis_learn_template_part( 'breadcrumbs', array( 'crumbs' => $pyxis_learn_crumbs ) ); ?>
			<h1 class="pxl-title"><?php echo esc_html( get_the_title() ); ?></h1>

			<?php if ( $pyxis_learn_objectives ) : ?>
				<div class="pxl-objectives">
					<p class="pxl-objectives__title">Learning objectives</p>
					<p>After reading this article you will be able to:</p>
					<ul>
						<?php foreach ( $pyxis_learn_objectives as $pyxis_learn_objective ) : ?>
							<li><?php echo esc_html( $pyxis_learn_objective ); ?></li>
						<?php endforeach; ?>
					</ul>
				</div>
			<?php endif; ?>

			<div class="pxl-body">
				<?php echo $pyxis_learn_content; // phpcs:ignore WordPress.Security.EscapeOutput -- filtered post content. ?>
			</div>

			<p class="pxl-updated">Last updated <?php echo esc_html( get_the_modified_date() ); ?></p>

			<?php if ( $pyxis_learn_related ) : ?>
				<section class="pxl-related">
					<h2 class="pxl-related__title">Keep learning</h2>
					<div class="pxl-grid">
						<?php foreach ( $pyxis_learn_related as $article ) : ?>
							<?php pyxis_learn_template_part( 'card', array( 'article' => $article ) ); ?>
						<?php endforeach; ?>
					</div>
				</section>
			<?php endif; ?>

			<?php pyxis_learn_template_part( 'cta' ); ?>
		</article>
	</div>
</div>
<?php
get_footer();
