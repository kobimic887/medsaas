<?php
/**
 * Page template for a page whose content holds [pyxis_stock_catalog]. Uses the
 * active theme's header and footer and the pyxis theme's section markup, and
 * prints the page content (the shortcode plus any text an editor adds).
 * The pyxis theme's header.php opens <main class="content-wrapper"> and its
 * footer.php closes it, so this template prints sections only.
 */

defined( 'ABSPATH' ) || exit;

the_post();
// Render before get_header() so the shortcode's stylesheet is enqueued in <head>.
$pyxis_catalog_content = apply_filters( 'the_content', get_the_content() );

get_header();
?>
<section class="section section-content">
	<div class="sk-container sk-container--sm">
		<h1 class="sk-subheading"><?php echo esc_html( get_the_title() ); ?></h1>
	</div>
</section>
<section class="section pyxis-catalog-section">
	<div class="sk-container">
		<?php echo $pyxis_catalog_content; // phpcs:ignore WordPress.Security.EscapeOutput -- filtered post content. ?>
	</div>
</section>
<?php
get_footer();
