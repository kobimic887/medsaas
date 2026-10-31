<?php
// Same stylesheet the live pyxis theme enqueues as "app-css".
add_action(
	'wp_enqueue_scripts',
	function () {
		wp_enqueue_style( 'app', 'https://www.pyxis-discovery.com/wp-content/themes/pyxis/public/css/app.css', array(), null );
		wp_enqueue_style( 'poppins', 'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap', array(), null );
	}
);
add_theme_support( 'title-tag' );

// Mirrors the live site's Insights post type and tags (rest_base pyxis_insights,
// taxonomy pyxis-insights-tag, archive /insights/) for insights-agent tests.
add_action(
	'init',
	function () {
		register_post_type(
			'pyxis_insights',
			array(
				'label'        => 'Insights',
				'public'       => true,
				'has_archive'  => 'insights',
				'rewrite'      => array( 'slug' => 'insights' ),
				'show_in_rest' => true,
				'rest_base'    => 'pyxis_insights',
				'supports'     => array( 'title', 'editor', 'thumbnail', 'revisions' ),
				'taxonomies'   => array( 'pyxis-insights-tag' ),
			)
		);
		register_taxonomy(
			'pyxis-insights-tag',
			'pyxis_insights',
			array(
				'label'        => 'Insight tags',
				'public'       => true,
				'show_in_rest' => true,
			)
		);
	}
);
