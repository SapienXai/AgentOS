fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_external_auth_url",
            "check_agentos_update",
            "install_agentos_update",
        ]),
    ))
    .expect("Tauri ACL generation failed");
}
