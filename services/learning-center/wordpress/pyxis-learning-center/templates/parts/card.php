<?php
/**
 * @var WP_Post $article
 */
defined( 'ABSPATH' ) || exit;
?>
<a class="pxl-card" href="<?php echo esc_url( get_permalink( $article ) ); ?>" data-pxl-search="<?php echo esc_attr( strtolower( get_the_title( $article ) . ' ' . pyxis_learn_term_label( $article ) . ' ' . pyxis_learn_summary( $article ) ) ); ?>">
	<span class="pxl-card__title"><?php echo esc_html( get_the_title( $article ) ); ?></span>
	<span class="pxl-card__summary"><?php echo esc_html( pyxis_learn_summary( $article ) ); ?></span>
</a>
