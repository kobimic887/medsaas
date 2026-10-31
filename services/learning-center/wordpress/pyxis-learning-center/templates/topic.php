<?php
/**
 * /learning/<topic>/ — topic intro and its articles as cards.
 */
defined( 'ABSPATH' ) || exit;

$pyxis_learn_topic    = get_queried_object();
$pyxis_learn_articles = pyxis_learn_topic_articles( $pyxis_learn_topic );

get_header();
?>
<div class="pxl">
	<div class="sk-container pxl-layout">
		<?php
		pyxis_learn_template_part(
			'sidebar',
			array(
				'current_topic' => $pyxis_learn_topic,
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
						array( $pyxis_learn_topic->name, null ),
					),
				)
			);
			?>
			<h1 class="pxl-title"><?php echo esc_html( $pyxis_learn_topic->name ); ?></h1>
			<?php if ( $pyxis_learn_topic->description ) : ?>
				<p class="pxl-lead"><?php echo esc_html( $pyxis_learn_topic->description ); ?></p>
			<?php endif; ?>
			<div class="pxl-grid">
				<?php foreach ( $pyxis_learn_articles as $article ) : ?>
					<?php pyxis_learn_template_part( 'card', array( 'article' => $article ) ); ?>
				<?php endforeach; ?>
			</div>
			<?php pyxis_learn_template_part( 'cta' ); ?>
		</div>
	</div>
</div>
<?php
get_footer();
