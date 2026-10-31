<?php
/**
 * /learning/ — hero with search, every topic with its articles, glossary link, CTA.
 * Templates buffer their markup and hand it to pyxis_learn_output(), which
 * places it inside the theme's layout.
 */
defined( 'ABSPATH' ) || exit;

$pyxis_learn_topics = pyxis_learn_topics();
$pyxis_learn_count  = (int) wp_count_posts( PYXIS_LEARN_TYPE )->publish;

ob_start();
?>
<div class="pxl">
	<section class="pxl-hero">
		<div class="sk-container">
			<p class="sk-subheading">Learning Center</p>
			<h1 class="pxl-hero__title">Learn the science behind computational drug discovery</h1>
			<p class="pxl-hero__lead">Plain-language guides to macrocycles, virtual screening, docking, cheminformatics and structure prediction, written by the Pyxis Discovery team.</p>
			<form class="pxl-search" role="search" data-pxl-search-form onsubmit="return false">
				<label class="screen-reader-text" for="pxl-search-input">Search the Learning Center</label>
				<input id="pxl-search-input" type="search" placeholder="Search <?php echo esc_attr( $pyxis_learn_count ); ?> articles, e.g. docking, SMILES, PAMPA" autocomplete="off" data-pxl-search-input>
			</form>
		</div>
	</section>

	<section class="pxl-results sk-container" data-pxl-results hidden aria-live="polite">
		<p class="pxl-results__status" data-pxl-results-status></p>
		<div class="pxl-grid" data-pxl-results-list></div>
	</section>

	<section class="pxl-topics sk-container" data-pxl-topics>
		<?php foreach ( $pyxis_learn_topics as $pyxis_learn_topic ) : ?>
			<?php $pyxis_learn_articles = pyxis_learn_topic_articles( $pyxis_learn_topic ); ?>
			<article class="pxl-topic">
				<h2 class="pxl-topic__title"><a href="<?php echo esc_url( get_term_link( $pyxis_learn_topic ) ); ?>"><?php echo esc_html( $pyxis_learn_topic->name ); ?></a></h2>
				<p class="pxl-topic__desc"><?php echo esc_html( $pyxis_learn_topic->description ); ?></p>
				<ul class="pxl-topic__list">
					<?php foreach ( $pyxis_learn_articles as $pyxis_learn_article ) : ?>
						<li><a href="<?php echo esc_url( get_permalink( $pyxis_learn_article ) ); ?>" data-pxl-search="<?php echo esc_attr( strtolower( get_the_title( $pyxis_learn_article ) . ' ' . pyxis_learn_term_label( $pyxis_learn_article ) . ' ' . pyxis_learn_summary( $pyxis_learn_article ) ) ); ?>" data-pxl-summary="<?php echo esc_attr( pyxis_learn_summary( $pyxis_learn_article ) ); ?>"><?php echo esc_html( get_the_title( $pyxis_learn_article ) ); ?></a></li>
					<?php endforeach; ?>
				</ul>
				<a class="pxl-link-arrow" href="<?php echo esc_url( get_term_link( $pyxis_learn_topic ) ); ?>">All <?php echo esc_html( $pyxis_learn_topic->name ); ?> articles</a>
			</article>
		<?php endforeach; ?>
		<article class="pxl-topic pxl-topic--glossary">
			<h2 class="pxl-topic__title"><a href="<?php echo esc_url( pyxis_learn_glossary_url() ); ?>">Glossary</a></h2>
			<p class="pxl-topic__desc">Every term in the Learning Center from A to Z, each with a one-line definition.</p>
			<a class="pxl-link-arrow" href="<?php echo esc_url( pyxis_learn_glossary_url() ); ?>">Browse the glossary</a>
		</article>
	</section>

	<div class="sk-container">
		<?php pyxis_learn_template_part( 'cta' ); ?>
	</div>
</div>
<?php
pyxis_learn_output( ob_get_clean() );
