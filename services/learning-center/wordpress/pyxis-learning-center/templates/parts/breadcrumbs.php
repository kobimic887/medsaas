<?php
/**
 * @var array<int, array{0: string, 1: string|null}> $crumbs label, URL (null for the current page)
 */
defined( 'ABSPATH' ) || exit;
?>
<nav class="pxl-crumbs" aria-label="Breadcrumb">
	<ol>
		<?php foreach ( $crumbs as $crumb ) : ?>
			<li>
				<?php if ( $crumb[1] ) : ?>
					<a href="<?php echo esc_url( $crumb[1] ); ?>"><?php echo esc_html( $crumb[0] ); ?></a>
				<?php else : ?>
					<span aria-current="page"><?php echo esc_html( $crumb[0] ); ?></span>
				<?php endif; ?>
			</li>
		<?php endforeach; ?>
	</ol>
</nav>
