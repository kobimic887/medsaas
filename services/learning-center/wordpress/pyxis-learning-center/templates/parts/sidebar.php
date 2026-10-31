<?php
/**
 * Topic navigation: every topic, with the current topic expanded.
 *
 * @var WP_Term|null $current_topic
 * @var int          $current_id   current article ID (0 on topic pages)
 */
defined( 'ABSPATH' ) || exit;
?>
<aside class="pxl-sidebar" aria-label="Learning Center topics">
	<p class="pxl-sidebar__title"><a href="<?php echo esc_url( pyxis_learn_hub_url() ); ?>">Learning Center</a></p>
	<ul class="pxl-sidebar__topics">
		<?php foreach ( pyxis_learn_topics() as $topic ) : ?>
			<?php $is_current = $current_topic && $current_topic->term_id === $topic->term_id; ?>
			<li class="<?php echo $is_current ? 'is-open' : ''; ?>">
				<a class="pxl-sidebar__topic" href="<?php echo esc_url( get_term_link( $topic ) ); ?>"<?php echo ( $is_current && ! $current_id ) ? ' aria-current="page"' : ''; ?>><?php echo esc_html( $topic->name ); ?></a>
				<?php if ( $is_current ) : ?>
					<ul>
						<?php foreach ( pyxis_learn_topic_articles( $topic ) as $article ) : ?>
							<li><a href="<?php echo esc_url( get_permalink( $article ) ); ?>"<?php echo $article->ID === $current_id ? ' aria-current="page"' : ''; ?>><?php echo esc_html( get_the_title( $article ) ); ?></a></li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
			</li>
		<?php endforeach; ?>
		<li><a class="pxl-sidebar__topic" href="<?php echo esc_url( pyxis_learn_glossary_url() ); ?>"<?php echo pyxis_learn_is_glossary() ? ' aria-current="page"' : ''; ?>>Glossary</a></li>
	</ul>
</aside>
