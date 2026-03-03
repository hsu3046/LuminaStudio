mod commands;

use commands::{
    scan_directory, get_thumbnail, get_image_base64,
    get_home_directory, get_pictures_directory,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            get_thumbnail,
            get_image_base64,
            get_home_directory,
            get_pictures_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
