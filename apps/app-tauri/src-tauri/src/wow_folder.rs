use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

pub fn is_retail_folder_path(path: impl AsRef<Path>) -> bool {
    path.as_ref()
        .components()
        .next_back()
        .and_then(|component| component.as_os_str().to_str())
        .is_some_and(|segment| segment.eq_ignore_ascii_case("_retail_"))
}

pub fn get_addon_path(retail_path: impl AsRef<Path>) -> PathBuf {
    retail_path
        .as_ref()
        .join("Interface")
        .join("AddOns")
        .join("wow-dashboard")
}

pub fn get_addon_toc_path(retail_path: impl AsRef<Path>) -> PathBuf {
    get_addon_path(retail_path).join("wow-dashboard.toc")
}

pub fn stored_retail_path(state: &crate::AppState) -> Option<PathBuf> {
    state
        .settings
        .snapshot()
        .retail_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
}

pub fn validated_retail_path(state: &crate::AppState) -> Result<PathBuf, String> {
    let path =
        stored_retail_path(state).ok_or_else(|| "WoW retail path is not configured".to_string())?;
    if !is_retail_folder_path(&path) {
        return Err("Configured WoW folder must point to the _retail_ directory.".to_string());
    }
    Ok(path)
}

#[tauri::command]
pub async fn wow_get_retail_path(
    state: State<'_, crate::AppState>,
) -> Result<Option<String>, String> {
    Ok(state.settings.snapshot().retail_path)
}

#[tauri::command]
pub async fn wow_select_retail_folder(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<Option<String>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select World of Warcraft _retail_ folder")
        .blocking_pick_folder();

    let Some(folder) = selected else {
        return Ok(None);
    };
    let Some(path) = folder.as_path() else {
        return Err("Could not read selected folder path".to_string());
    };
    if !is_retail_folder_path(path) {
        app.dialog()
            .message("Please choose your World of Warcraft _retail_ folder. The selected path must end with _retail_.")
            .title("Invalid WoW folder")
            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
            .blocking_show();
        return Ok(state.settings.snapshot().retail_path);
    }

    let folder = path.to_string_lossy().to_string();
    state
        .settings
        .update(|settings| settings.retail_path = Some(folder.clone()))
        .map_err(|error| error.to_string())?;
    Ok(Some(folder))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_retail_folder_leaf() {
        assert!(is_retail_folder_path("C:/Games/World of Warcraft/_retail_"));
        assert!(is_retail_folder_path(
            "C:/Games/World of Warcraft/_retail_/"
        ));
        assert!(!is_retail_folder_path("C:/Games/World of Warcraft"));
        assert!(!is_retail_folder_path(
            "C:/Games/World of Warcraft/_classic_"
        ));
    }
}
