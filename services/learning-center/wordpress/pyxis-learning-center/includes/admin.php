<?php
/**
 * Admin: a "Learning details" meta box (term, summary, objectives, order) and a
 * Learning Center → Starter content screen that re-runs the safe importer.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'add_meta_boxes_' . PYXIS_LEARN_TYPE, 'pyxis_learn_add_meta_box' );
add_action( 'save_post_' . PYXIS_LEARN_TYPE, 'pyxis_learn_save_meta_box', 10, 2 );
add_action( 'admin_menu', 'pyxis_learn_admin_menu' );

function pyxis_learn_add_meta_box() {
	add_meta_box( 'pyxis-learn-details', 'Learning details', 'pyxis_learn_render_meta_box', PYXIS_LEARN_TYPE, 'normal', 'high' );
}

function pyxis_learn_render_meta_box( $post ) {
	wp_nonce_field( 'pyxis_learn_meta', 'pyxis_learn_meta_nonce' );
	$term       = get_post_meta( $post->ID, 'pyxis_learn_term', true );
	$summary    = get_post_meta( $post->ID, 'pyxis_learn_summary', true );
	$objectives = get_post_meta( $post->ID, 'pyxis_learn_objectives', true );
	$order      = get_post_meta( $post->ID, 'pyxis_learn_order', true );
	?>
	<p>
		<label for="pyxis_learn_term"><strong>Glossary term</strong></label><br>
		<input class="widefat" id="pyxis_learn_term" name="pyxis_learn_term" value="<?php echo esc_attr( $term ); ?>" placeholder="Molecular docking">
	</p>
	<p>
		<label for="pyxis_learn_summary"><strong>Summary</strong> (shown on cards and in the glossary)</label><br>
		<textarea class="widefat" id="pyxis_learn_summary" name="pyxis_learn_summary" rows="2"><?php echo esc_textarea( $summary ); ?></textarea>
	</p>
	<p>
		<label for="pyxis_learn_objectives"><strong>Learning objectives</strong> (one per line)</label><br>
		<textarea class="widefat" id="pyxis_learn_objectives" name="pyxis_learn_objectives" rows="4"><?php echo esc_textarea( $objectives ); ?></textarea>
	</p>
	<p>
		<label for="pyxis_learn_order"><strong>Order in topic</strong></label>
		<input type="number" id="pyxis_learn_order" name="pyxis_learn_order" value="<?php echo esc_attr( $order ); ?>" style="width:6em">
	</p>
	<p class="description">Link to another article with <code>[pyxis_learn_link slug="what-is-a-macrocycle"]macrocycles[/pyxis_learn_link]</code>.</p>
	<?php
}

function pyxis_learn_save_meta_box( $post_id, $post ) {
	if ( ! isset( $_POST['pyxis_learn_meta_nonce'] )
		|| ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['pyxis_learn_meta_nonce'] ) ), 'pyxis_learn_meta' )
		|| ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE )
		|| ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$fields = array(
		'pyxis_learn_term'       => 'sanitize_text_field',
		'pyxis_learn_summary'    => 'sanitize_textarea_field',
		'pyxis_learn_objectives' => 'sanitize_textarea_field',
		'pyxis_learn_order'      => 'intval',
	);
	foreach ( $fields as $key => $sanitize ) {
		if ( isset( $_POST[ $key ] ) ) {
			update_post_meta( $post_id, $key, call_user_func( $sanitize, wp_unslash( $_POST[ $key ] ) ) );
		}
	}
}

function pyxis_learn_admin_menu() {
	add_submenu_page(
		'edit.php?post_type=' . PYXIS_LEARN_TYPE,
		'Starter content',
		'Starter content',
		'manage_options',
		'pyxis-learn-starter',
		'pyxis_learn_render_starter_page'
	);
}

function pyxis_learn_render_starter_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$report = null;
	if ( isset( $_POST['pyxis_learn_import'] ) && check_admin_referer( 'pyxis_learn_import' ) ) {
		$report = pyxis_learn_import_starter_content();
	}
	?>
	<div class="wrap">
		<h1>Learning Center starter content</h1>
		<p>Creates the bundled topics and articles whose slug does not exist yet. Existing, edited or trashed articles are left alone.</p>
		<p>Public URL: <a href="<?php echo esc_url( pyxis_learn_hub_url() ); ?>"><?php echo esc_html( pyxis_learn_hub_url() ); ?></a></p>
		<?php if ( $report ) : ?>
			<div class="notice notice-success"><p>
				Created <?php echo count( $report['created'] ); ?>,
				skipped <?php echo count( $report['skipped'] ); ?> existing,
				failed <?php echo count( $report['failed'] ); ?>
				<?php echo $report['failed'] ? '(' . esc_html( implode( ', ', $report['failed'] ) ) . ')' : ''; ?>.
			</p></div>
		<?php endif; ?>
		<form method="post">
			<?php wp_nonce_field( 'pyxis_learn_import' ); ?>
			<?php submit_button( 'Import missing starter articles', 'primary', 'pyxis_learn_import' ); ?>
		</form>
	</div>
	<?php
}
