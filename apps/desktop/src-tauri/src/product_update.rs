use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{RemoteRelease, Update, UpdaterExt};
use time::OffsetDateTime;
use uuid::Uuid;

#[cfg(not(debug_assertions))]
use crate::start_embedded_agentos;
use crate::{shutdown_embedded_agentos, DesktopState};

const UPDATE_TIMEOUT: Duration = Duration::from_secs(5);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PREPARATION_TTL: Duration = Duration::from_secs(5 * 60);
const NATIVE_CHECK_FILE: &str = "native-check.json";
const ACTIVE_RECEIPT_FILE: &str = "active.json";
const OPERATION_DIRECTORY: &str = "operations";
const INSTALL_LOCK_FILE: &str = "native-install.lock";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeCheck {
    schema_version: u8,
    check_id: String,
    launch_id: String,
    current_version: String,
    latest_version: Option<String>,
    update_available: bool,
    release_identity: Option<String>,
    checked_at: String,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateReceipt {
    schema_version: u8,
    operation_id: String,
    request_id: String,
    actor_id: String,
    authentication_method: String,
    owner: String,
    launch_id: String,
    current_version: String,
    target_version: String,
    native_check_id: String,
    release_identity: String,
    state: String,
    phase: Option<String>,
    progress: Option<f64>,
    created_at: String,
    updated_at: String,
    expires_at: String,
    failure: Option<String>,
    new_launch_id: Option<String>,
    native_version: Option<String>,
    server_version: Option<String>,
    verification: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCheckResponse {
    check_id: String,
    status: String,
    latest_version: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    operation_id: String,
    state: String,
    phase: Option<String>,
    progress: Option<f64>,
    message: String,
}

#[derive(Clone)]
struct ReleaseObservation {
    version: Option<String>,
    release_identity: Option<String>,
    eligible: bool,
}

struct InstallAdmission {
    path: PathBuf,
    file: Option<File>,
    retained: bool,
}

impl InstallAdmission {
    fn retain(&mut self) {
        self.retained = true;
    }

    fn release(&mut self) {
        self.retained = false;
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

impl Drop for InstallAdmission {
    fn drop(&mut self) {
        self.file.take();
        if !self.retained {
            let _ = fs::remove_file(&self.path);
        }
    }
}

struct UpdateExecutionAdmission<'a> {
    state: &'a DesktopState,
    retained: bool,
}

impl<'a> UpdateExecutionAdmission<'a> {
    fn new(state: &'a DesktopState) -> Self {
        Self {
            state,
            retained: false,
        }
    }

    fn retain(&mut self) {
        self.retained = true;
    }

    fn release(&mut self) {
        self.retained = false;
        self.state.update_running.store(false, Ordering::SeqCst);
    }
}

impl Drop for UpdateExecutionAdmission<'_> {
    fn drop(&mut self) {
        if !self.retained {
            self.state.update_running.store(false, Ordering::SeqCst);
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn check_agentos_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<NativeCheckResponse, String> {
    validate_update_window(&window, &state)?;
    let check = perform_native_check(&app, &state.launch_id).await;
    persist_native_check(&app_data_dir(&app)?.join("updates"), &check)?;
    Ok(NativeCheckResponse {
        check_id: check.check_id,
        status: check.status,
        latest_version: check.latest_version,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_agentos_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    operation_id: String,
) -> Result<(), String> {
    validate_update_window(&window, &state)?;
    if cfg!(debug_assertions) {
        return Err("AgentOS updates are unavailable in a development shell.".to_string());
    }
    if !matches!(
        desktop_bundle_name(),
        "macos" | "windows-nsis" | "linux-appimage"
    ) {
        return Err("This Desktop bundle is managed outside AgentOS.".to_string());
    }

    let operation_id = Uuid::parse_str(&operation_id)
        .map_err(|_| "The prepared update operation is invalid.".to_string())?
        .to_string();
    let runtime_dir = app_data_dir(&app)?;
    let updates_dir = runtime_dir.join("updates");
    ensure_private_directory(&updates_dir)?;
    let mut install_lock = create_install_lock(&updates_dir)?;

    if state
        .update_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        drop(install_lock);
        return Err("Another AgentOS update is already running.".to_string());
    }
    let mut update_admission = UpdateExecutionAdmission::new(&state);

    let operation_path = updates_dir
        .join(OPERATION_DIRECTORY)
        .join(format!("{operation_id}.json"));
    let mut receipt = match read_receipt(&operation_path) {
        Ok(receipt) => receipt,
        Err(error) => {
            return Err(error);
        }
    };

    if let Err(error) = validate_prepared_receipt(&receipt, &state.launch_id, &operation_id) {
        return Err(error);
    }
    let original_check = match read_native_check(&updates_dir.join(NATIVE_CHECK_FILE)) {
        Ok(check) => check,
        Err(error) => return Err(error),
    };
    if original_check.check_id != receipt.native_check_id
        || original_check.launch_id != state.launch_id
        || original_check.current_version != receipt.current_version
        || original_check.latest_version.as_deref() != Some(receipt.target_version.as_str())
        || original_check.release_identity.as_deref() != Some(receipt.release_identity.as_str())
        || !original_check.update_available
        || original_check.status != "available"
        || !is_fresh_native_check(&original_check)
    {
        return Err("The prepared update no longer matches the native release check.".to_string());
    }
    let active_pointer =
        read_private_json::<serde_json::Value>(&updates_dir.join(ACTIVE_RECEIPT_FILE))?;
    let active_operation_id = active_pointer
        .get("operationId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    if active_operation_id.as_deref() != Some(operation_id.as_str()) {
        return Err("The prepared update is no longer the active operation.".to_string());
    }
    if active_pointer
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err("The active update pointer is invalid.".to_string());
    }
    let request_path = updates_dir
        .join("requests")
        .join(format!("{}.json", receipt.request_id));
    let request_marker = read_private_json::<serde_json::Value>(&request_path)?;
    if request_marker
        .get("operationId")
        .and_then(serde_json::Value::as_str)
        != Some(operation_id.as_str())
    {
        return Err("The prepared update request could not be verified.".to_string());
    }

    receipt.state = "running".to_string();
    receipt.phase = Some("checking".to_string());
    receipt.progress = Some(0.0);
    receipt.updated_at = now_string();
    receipt.failure = None;
    write_receipt(&operation_path, &receipt)?;
    emit_progress(
        &app,
        &receipt,
        "running",
        Some("checking"),
        Some(0.0),
        "Checking the signed Desktop release again.",
    );

    let (update, latest_check) = match perform_native_update_check(&app, &state.launch_id).await {
        Ok(result) => result,
        Err(_) => {
            fail_receipt(
                &app,
                &operation_path,
                &mut receipt,
                "The native Desktop release could not be rechecked.",
            );
            return Err("The native Desktop release could not be rechecked.".to_string());
        }
    };
    if let Err(error) = persist_native_check(&updates_dir, &latest_check) {
        return Err(error);
    }
    if latest_check.status != "available"
        || latest_check.latest_version.as_deref() != Some(receipt.target_version.as_str())
        || latest_check.release_identity.as_deref() != Some(receipt.release_identity.as_str())
    {
        fail_receipt(
            &app,
            &operation_path,
            &mut receipt,
            "The signed release changed after update preparation.",
        );
        return Err("The signed release changed after update preparation.".to_string());
    }
    let Some(update) = update else {
        fail_receipt(
            &app,
            &operation_path,
            &mut receipt,
            "The native updater did not return the checked release.",
        );
        return Err("The native updater did not return the checked release.".to_string());
    };

    receipt.phase = Some("download".to_string());
    receipt.progress = Some(0.0);
    receipt.updated_at = now_string();
    write_receipt(&operation_path, &receipt)?;
    emit_progress(
        &app,
        &receipt,
        "running",
        Some("download"),
        Some(0.0),
        "Downloading and verifying the signed Desktop artifact.",
    );

    let downloaded = Arc::new(Mutex::new(0_u64));
    let callback_app = app.clone();
    let callback_operation_path = operation_path.clone();
    let mut callback_receipt = receipt.clone();
    let callback_downloaded = downloaded.clone();
    let mut last_progress_persisted = Instant::now();
    let download = tokio::time::timeout(
        DOWNLOAD_TIMEOUT,
        update.download(
            move |chunk_size, content_length| {
                if let Ok(mut count) = callback_downloaded.lock() {
                    *count = count.saturating_add(chunk_size as u64);
                    let progress = content_length
                        .filter(|length| *length > 0)
                        .map(|length| ((*count as f64 / length as f64) * 100.0).clamp(0.0, 99.0));
                    if last_progress_persisted.elapsed() >= Duration::from_secs(1) {
                        callback_receipt.progress = progress;
                        callback_receipt.updated_at = now_string();
                        let _ = write_receipt(&callback_operation_path, &callback_receipt);
                        last_progress_persisted = Instant::now();
                    }
                    emit_progress(
                        &callback_app,
                        &callback_receipt,
                        "running",
                        Some("download"),
                        progress,
                        "Downloading the signed Desktop artifact.",
                    );
                }
            },
            || {},
        ),
    )
    .await;

    let bytes = match download {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(_)) => {
            fail_receipt(
                &app,
                &operation_path,
                &mut receipt,
                "The Desktop artifact failed download or signature verification.",
            );
            emit_progress(
                &app,
                &receipt,
                "failed",
                None,
                None,
                "The Desktop artifact failed download or signature verification.",
            );
            return Err(
                "The Desktop artifact failed download or signature verification.".to_string(),
            );
        }
        Err(_) => {
            fail_receipt(
                &app,
                &operation_path,
                &mut receipt,
                "The Desktop artifact download exceeded its time limit.",
            );
            emit_progress(
                &app,
                &receipt,
                "failed",
                None,
                None,
                "The Desktop artifact download exceeded its time limit.",
            );
            return Err("The Desktop artifact download exceeded its time limit.".to_string());
        }
    };

    receipt.state = "restart-required".to_string();
    receipt.phase = Some("install".to_string());
    receipt.progress = Some(100.0);
    receipt.updated_at = now_string();
    write_receipt(&operation_path, &receipt)?;
    emit_progress(
        &app,
        &receipt,
        "restart-required",
        Some("install"),
        Some(100.0),
        "Installing the verified update. AgentOS will restart.",
    );

    #[cfg(windows)]
    let update = update.on_before_exit({
        let app = app.clone();
        let operation_path = operation_path.clone();
        let mut receipt = receipt.clone();
        move || {
            receipt.state = "restart-required".to_string();
            receipt.phase = Some("relaunch".to_string());
            receipt.updated_at = now_string();
            let _ = write_receipt(&operation_path, &receipt);
            app.state::<DesktopState>()
                .quitting
                .store(true, Ordering::SeqCst);
            shutdown_embedded_agentos(&app);
        }
    });

    #[cfg(not(windows))]
    {
        receipt.phase = Some("relaunch".to_string());
        receipt.updated_at = now_string();
        if let Err(error) = write_receipt(&operation_path, &receipt) {
            return Err(error);
        }
        state.quitting.store(true, Ordering::SeqCst);
        shutdown_embedded_agentos(&app);
    }

    install_lock.retain();
    update_admission.retain();
    if update.install(bytes).is_err() {
        receipt.state = "failed".to_string();
        receipt.phase = Some("verify".to_string());
        receipt.progress = None;
        receipt.failure = Some("The verified Desktop update could not be installed.".to_string());
        receipt.updated_at = now_string();
        let _ = write_receipt(&operation_path, &receipt);
        state.quitting.store(false, Ordering::SeqCst);
        install_lock.release();
        update_admission.release();
        #[cfg(not(debug_assertions))]
        if let Some(window) = app.get_webview_window("main") {
            start_embedded_agentos(app.clone(), window);
        }
        emit_progress(
            &app,
            &receipt,
            "failed",
            Some("verify"),
            None,
            "The update could not be installed. AgentOS attempted to restart its existing server.",
        );
        return Err("The verified Desktop update could not be installed.".to_string());
    }

    #[cfg(windows)]
    return Ok(());

    #[cfg(not(windows))]
    app.restart();
}

async fn perform_native_check(app: &AppHandle, launch_id: &str) -> NativeCheck {
    match perform_native_update_check(app, launch_id).await {
        Ok((update, mut check)) => {
            check.update_available = update.is_some();
            check
        }
        Err(_) => NativeCheck {
            schema_version: 1,
            check_id: Uuid::new_v4().to_string(),
            launch_id: launch_id.to_string(),
            current_version: app.package_info().version.to_string(),
            latest_version: None,
            update_available: false,
            release_identity: None,
            checked_at: now_string(),
            status: "unavailable".to_string(),
            error: Some("The native Desktop release feed could not be checked.".to_string()),
        },
    }
}

async fn perform_native_update_check(
    app: &AppHandle,
    launch_id: &str,
) -> Result<(Option<Update>, NativeCheck), String> {
    let current_text = app.package_info().version.to_string();
    let current = semver::Version::parse(&current_text)
        .map_err(|_| "The Desktop application version is invalid.".to_string())?;
    if !is_stable(&current) {
        return Err("The Desktop application version is not a stable release.".to_string());
    }
    let target = updater_target().ok_or_else(|| {
        "This Desktop architecture is not supported for in-product updates.".to_string()
    })?;
    let observation = Arc::new(Mutex::new(ReleaseObservation {
        version: None,
        release_identity: None,
        eligible: false,
    }));
    let comparator_observation = observation.clone();
    let update = app
        .updater_builder()
        .timeout(UPDATE_TIMEOUT)
        .version_comparator(move |current_version, remote: RemoteRelease| {
            let version_text = remote.version.to_string();
            let identity = remote
                .download_url(target)
                .and_then(|url| {
                    remote.signature(target).map(|signature| {
                        release_identity(&version_text, target, url.as_str(), signature)
                    })
                })
                .ok();
            let eligible = is_stable(&remote.version)
                && remote.version > current_version
                && identity.is_some();
            if let Ok(mut seen) = comparator_observation.lock() {
                seen.version = is_stable(&remote.version).then_some(version_text);
                seen.release_identity = identity;
                seen.eligible = eligible;
            }
            eligible
        })
        .build()
        .map_err(|_| "The native Desktop updater is not configured.".to_string())?
        .check()
        .await
        .map_err(|_| "The native Desktop release feed could not be checked.".to_string())?;

    let observed = observation
        .lock()
        .map_err(|_| "The native Desktop update check could not be recorded.".to_string())?
        .clone();
    let update_identity = update.as_ref().map(|candidate| {
        release_identity(
            &candidate.version,
            target,
            candidate.download_url.as_str(),
            &candidate.signature,
        )
    });
    let current_version = current.to_string();
    let update_available = update.is_some();
    let status = if observed.version.is_none() && !observed.eligible {
        "unavailable"
    } else if update_available {
        "available"
    } else {
        "up-to-date"
    };
    let latest_version = observed.version;
    if update_available
        && (latest_version.as_deref()
            != update.as_ref().map(|candidate| candidate.version.as_str())
            || observed.release_identity != update_identity)
    {
        return Err("The native Desktop update response was inconsistent.".to_string());
    }
    let check = NativeCheck {
        schema_version: 1,
        check_id: Uuid::new_v4().to_string(),
        launch_id: launch_id.to_string(),
        current_version,
        latest_version,
        update_available,
        release_identity: observed.release_identity,
        checked_at: now_string(),
        status: status.to_string(),
        error: (status == "unavailable")
            .then(|| "The native Desktop release metadata is unsupported.".to_string()),
    };
    Ok((update, check))
}

fn validate_prepared_receipt(
    receipt: &UpdateReceipt,
    launch_id: &str,
    operation_id: &str,
) -> Result<(), String> {
    let target = semver::Version::parse(&receipt.target_version)
        .map_err(|_| "The prepared update target is invalid.".to_string())?;
    let current = semver::Version::parse(&receipt.current_version)
        .map_err(|_| "The prepared current version is invalid.".to_string())?;
    let expires = OffsetDateTime::parse(
        &receipt.expires_at,
        &time::format_description::well_known::Rfc3339,
    )
    .map_err(|_| "The prepared update has an invalid expiry.".to_string())?;
    let created = OffsetDateTime::parse(
        &receipt.created_at,
        &time::format_description::well_known::Rfc3339,
    )
    .map_err(|_| "The prepared update has an invalid creation time.".to_string())?;
    if receipt.schema_version != 1
        || receipt.operation_id != operation_id
        || receipt.owner != "desktop"
        || receipt.launch_id != launch_id
        || receipt.state != "requested"
        || receipt.phase.as_deref() != Some("checking")
        || !is_uuid(&receipt.request_id)
        || !is_uuid(&receipt.native_check_id)
        || receipt.actor_id.trim().is_empty()
        || receipt.actor_id.len() > 200
        || !matches!(
            receipt.authentication_method.as_str(),
            "instance-session"
                | "desktop-token"
                | "api-token"
                | "internal-service"
                | "unprotected-local"
        )
        || !is_stable(&target)
        || !is_stable(&current)
        || target <= current
        || expires <= OffsetDateTime::now_utc()
        || created > OffsetDateTime::now_utc()
        || expires - created > time::Duration::seconds(PREPARATION_TTL.as_secs() as i64 + 30)
        || receipt.release_identity.len() != 64
        || !receipt
            .release_identity
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("The prepared update is expired, invalid, or already consumed.".to_string());
    }
    Ok(())
}

fn is_fresh_native_check(check: &NativeCheck) -> bool {
    let Ok(checked_at) = OffsetDateTime::parse(
        &check.checked_at,
        &time::format_description::well_known::Rfc3339,
    ) else {
        return false;
    };
    let age = OffsetDateTime::now_utc() - checked_at;
    age >= time::Duration::ZERO && age <= time::Duration::seconds(PREPARATION_TTL.as_secs() as i64)
}

fn validate_update_window(window: &WebviewWindow, state: &DesktopState) -> Result<(), String> {
    if window.label() != "main" {
        return Err("AgentOS updates are available only from the main window.".to_string());
    }
    let expected_port = state
        .allowed_port
        .lock()
        .map_err(|_| "The Desktop update boundary is unavailable.".to_string())?
        .ok_or_else(|| "The Desktop update boundary is not ready.".to_string())?;
    let url = window
        .url()
        .map_err(|_| "The Desktop update origin could not be verified.".to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(expected_port)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("The Desktop update origin is not authorized.".to_string());
    }
    Ok(())
}

fn updater_target() -> Option<&'static str> {
    use tauri::utils::{config::BundleType, platform::bundle_type};

    let target = match bundle_type()? {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        BundleType::App => "darwin-aarch64-app",
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        BundleType::Nsis => "windows-x86_64-nsis",
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        BundleType::Msi => "windows-x86_64-msi",
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        BundleType::AppImage => "linux-x86_64-appimage",
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        BundleType::Deb => "linux-x86_64-deb",
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        BundleType::Rpm => "linux-x86_64-rpm",
        _ => return None,
    };
    Some(target)
}

pub fn desktop_bundle_name() -> &'static str {
    use tauri::utils::{config::BundleType, platform::bundle_type};

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        if matches!(bundle_type(), Some(BundleType::App)) {
            "macos"
        } else {
            "unknown"
        }
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        if matches!(bundle_type(), Some(BundleType::Nsis)) {
            "windows-nsis"
        } else {
            "unknown"
        }
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        match bundle_type() {
            Some(BundleType::AppImage) => "linux-appimage",
            Some(BundleType::Deb | BundleType::Rpm) => "linux-package",
            _ => "unknown",
        }
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64")
    )))]
    {
        "unknown"
    }
}

fn is_stable(version: &semver::Version) -> bool {
    version.pre.is_empty() && version.build.is_empty()
}

fn release_identity(version: &str, target: &str, url: &str, signature: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(version.as_bytes());
    digest.update([0]);
    digest.update(target.as_bytes());
    digest.update([0]);
    digest.update(url.as_bytes());
    digest.update([0]);
    digest.update(signature.as_bytes());
    format!("{:x}", digest.finalize())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "AgentOS persistent data directory is unavailable.".to_string())
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "AgentOS update storage is unavailable.".to_string())?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "AgentOS update storage is unavailable.".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("AgentOS update storage is not safe to use.".to_string());
    }
    set_private_permissions(path)?;
    Ok(())
}

fn create_install_lock(updates_dir: &Path) -> Result<InstallAdmission, String> {
    let lock_path = updates_dir.join(INSTALL_LOCK_FILE);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut lock = options
        .open(&lock_path)
        .map_err(|_| "Another Desktop update is active or needs recovery.".to_string())?;
    if lock
        .write_all(format!("{}\n", std::process::id()).as_bytes())
        .and_then(|_| lock.sync_all())
        .is_err()
    {
        drop(lock);
        let _ = fs::remove_file(&lock_path);
        return Err("Desktop update admission could not be persisted.".to_string());
    }
    Ok(InstallAdmission {
        path: lock_path,
        file: Some(lock),
        retained: false,
    })
}

fn read_native_check(path: &Path) -> Result<NativeCheck, String> {
    let value: NativeCheck = read_private_json(path)?;
    if value.schema_version != 1
        || !is_uuid(&value.check_id)
        || !is_uuid(&value.launch_id)
        || !matches!(
            value.status.as_str(),
            "available" | "up-to-date" | "unavailable"
        )
        || (value.release_identity.is_some()
            && !is_sha256(value.release_identity.as_deref().unwrap_or_default()))
    {
        return Err("The native Desktop update evidence is invalid.".to_string());
    }
    Ok(value)
}

fn read_receipt(path: &Path) -> Result<UpdateReceipt, String> {
    let receipt: UpdateReceipt = read_private_json(path)?;
    if !is_uuid(&receipt.operation_id) || !is_uuid(&receipt.launch_id) {
        return Err("The prepared update operation is invalid.".to_string());
    }
    Ok(receipt)
}

fn read_private_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    if let Some(parent) = path.parent() {
        ensure_private_directory(parent)?;
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "The prepared update evidence is missing or unavailable.".to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 * 1024 {
        return Err("The prepared update evidence is not safe to use.".to_string());
    }
    let bytes =
        fs::read(path).map_err(|_| "The prepared update evidence is unavailable.".to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "The prepared update evidence is invalid.".to_string())
}

fn persist_native_check(updates_dir: &Path, check: &NativeCheck) -> Result<(), String> {
    ensure_private_directory(updates_dir)?;
    atomic_write_json(&updates_dir.join(NATIVE_CHECK_FILE), check)
}

fn write_receipt(path: &Path, receipt: &UpdateReceipt) -> Result<(), String> {
    atomic_write_json(path, receipt)
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "AgentOS update storage is invalid.".to_string())?;
    ensure_private_directory(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("AgentOS update storage is not safe to use.".to_string());
        }
    }
    let temp_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("update"),
        Uuid::new_v4()
    ));
    let bytes = serde_json::to_vec(value)
        .map_err(|_| "AgentOS update state could not be encoded.".to_string())?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp_path)
        .map_err(|_| "AgentOS update state could not be written.".to_string())?;
    if file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&temp_path);
        return Err("AgentOS update state could not be persisted.".to_string());
    }
    drop(file);
    if fs::rename(&temp_path, path).is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err("AgentOS update state could not be activated.".to_string());
    }
    set_private_permissions(path)?;
    Ok(())
}

fn set_private_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            path,
            fs::Permissions::from_mode(if path.is_dir() { 0o700 } else { 0o600 }),
        )
        .map_err(|_| "AgentOS update storage permissions could not be restricted.".to_string())?;
    }
    Ok(())
}

fn fail_receipt(app: &AppHandle, path: &Path, receipt: &mut UpdateReceipt, reason: &str) {
    receipt.state = "failed".to_string();
    receipt.phase = Some("verify".to_string());
    receipt.progress = None;
    receipt.failure = Some(reason.to_string());
    receipt.updated_at = now_string();
    let _ = write_receipt(path, receipt);
    emit_progress(app, receipt, "failed", Some("verify"), None, reason);
}

fn emit_progress(
    app: &AppHandle,
    receipt: &UpdateReceipt,
    state: &str,
    phase: Option<&str>,
    progress: Option<f64>,
    message: &str,
) {
    let _ = app.emit(
        "agentos-update-progress",
        UpdateProgress {
            operation_id: receipt.operation_id.clone(),
            state: state.to_string(),
            phase: phase.map(str::to_string),
            progress,
            message: message.to_string(),
        },
    );
}

#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn clear_completed_install_lock(runtime_dir: &Path, new_launch_id: &str) {
    let updates_dir = runtime_dir.join("updates");
    if ensure_private_directory(&updates_dir).is_err() {
        return;
    }
    let lock_path = updates_dir.join(INSTALL_LOCK_FILE);
    let active_path = updates_dir.join(ACTIVE_RECEIPT_FILE);
    let Ok(pointer) = read_private_json::<serde_json::Value>(&active_path) else {
        return;
    };
    let Some(operation_id) = pointer
        .get("operationId")
        .and_then(serde_json::Value::as_str)
    else {
        return;
    };
    let Ok(operation_id) = Uuid::parse_str(operation_id) else {
        return;
    };
    let receipt_path = updates_dir
        .join(OPERATION_DIRECTORY)
        .join(format!("{operation_id}.json"));
    let Ok(mut receipt) = read_receipt(&receipt_path) else {
        return;
    };
    if receipt.launch_id == new_launch_id
        || !matches!(receipt.state.as_str(), "restart-required" | "running")
    {
        return;
    }
    let interrupted = receipt.state == "running";
    receipt.state = if interrupted { "unknown" } else { "verifying" }.to_string();
    receipt.phase = Some("verify".to_string());
    receipt.progress = None;
    receipt.failure = interrupted.then(|| {
        "The previous Desktop update was interrupted before a verified restart.".to_string()
    });
    receipt.new_launch_id = Some(new_launch_id.to_string());
    receipt.native_version = None;
    receipt.server_version = None;
    receipt.verification = if interrupted { "unknown" } else { "pending" }.to_string();
    receipt.updated_at = now_string();
    if write_receipt(&receipt_path, &receipt).is_ok() {
        let _ = fs::remove_file(lock_path);
    }
}

fn now_string() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn is_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::{is_sha256, is_stable, release_identity, updater_target};

    #[test]
    fn release_identity_is_platform_bound_and_deterministic() {
        let first = release_identity(
            "0.8.1",
            "linux-x86_64-appimage",
            "https://example.test/appimage",
            "sig",
        );
        assert_eq!(
            first,
            release_identity(
                "0.8.1",
                "linux-x86_64-appimage",
                "https://example.test/appimage",
                "sig"
            )
        );
        assert_ne!(
            first,
            release_identity(
                "0.8.1",
                "linux-x86_64-appimage",
                "https://example.test/other",
                "sig"
            )
        );
    }

    #[test]
    fn stable_release_validation_rejects_prerelease_and_build_metadata() {
        assert!(is_stable(&semver::Version::parse("0.8.1").unwrap()));
        assert!(!is_stable(&semver::Version::parse("0.8.1-rc.1").unwrap()));
        assert!(!is_stable(
            &semver::Version::parse("0.8.1+build.4").unwrap()
        ));
        assert!(is_sha256(&"a".repeat(64)));
        assert!(!is_sha256(&"A".repeat(64)));
    }

    #[test]
    fn updater_target_matches_the_supported_platform_matrix() {
        assert!(
            matches!(
                updater_target(),
                Some("darwin-aarch64-app")
                    | Some("windows-x86_64-nsis")
                    | Some("linux-x86_64-appimage")
            ) || updater_target().is_none()
        );
    }
}
