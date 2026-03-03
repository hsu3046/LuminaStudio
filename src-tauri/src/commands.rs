use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::imageops::FilterType;

// ─── Types ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: u64,
    pub mime_type: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub files: Vec<FileEntry>,
    pub total_count: usize,
    pub image_count: usize,
    pub folder_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ThumbnailResult {
    pub data: String,
    pub width: u32,
    pub height: u32,
}

// ─── Helpers ───

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "ico", "avif", "heic", "heif",
];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "avi", "mkv", "webm"];

fn is_image_extension(ext: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

fn is_video_extension(ext: &str) -> bool {
    VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

fn get_category(extension: &str, is_dir: bool) -> String {
    if is_dir { return "folder".to_string(); }
    let ext = extension.to_lowercase();
    if is_image_extension(&ext) { "image".to_string() }
    else if is_video_extension(&ext) { "video".to_string() }
    else { "file".to_string() }
}

fn get_mime_type(path: &Path) -> String {
    mime_guess::from_path(path).first_or_octet_stream().to_string()
}

fn get_thumbnail_cache_dir() -> PathBuf {
    let dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("lumina-studio")
        .join("thumbnails");
    fs::create_dir_all(&dir).ok();
    dir
}

fn thumbnail_cache_path(image_path: &str, size: u32) -> PathBuf {
    let hash = format!("{:x}", md5::compute(format!("{}:{}", image_path, size)));
    get_thumbnail_cache_dir().join(format!("{}.jpg", hash))
}

// ─── IPC Commands ───

/// Scan a directory. Returns all files (folders + images/videos only).
#[tauri::command]
pub fn scan_directory(path: String) -> Result<DirectoryListing, String> {
    let dir_path = Path::new(&path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;
    let mut files: Vec<FileEntry> = Vec::new();
    let mut image_count: usize = 0;
    let mut folder_count: usize = 0;

    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') { continue; }

        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let is_directory = file_type.is_dir();
        let file_path = entry.path();
        let extension = file_path.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        let category = get_category(&extension, is_directory);

        // Only keep folders + images + videos
        if !is_directory && !matches!(category.as_str(), "image" | "video") {
            continue;
        }

        if is_directory { folder_count += 1; }
        else if category == "image" { image_count += 1; }

        let (size, modified) = match fs::metadata(&file_path) {
            Ok(m) => {
                let mod_time = m.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                (m.len(), mod_time)
            }
            Err(_) => (0, 0),
        };

        let mime_type = if is_directory { "directory".to_string() } else { get_mime_type(&file_path) };

        files.push(FileEntry {
            name: file_name,
            path: file_path.to_string_lossy().to_string(),
            is_directory,
            size,
            modified,
            mime_type,
            category,
        });
    }

    // Sort: directories first, then by name
    files.sort_by(|a, b| {
        if a.is_directory && !b.is_directory { std::cmp::Ordering::Less }
        else if !a.is_directory && b.is_directory { std::cmp::Ordering::Greater }
        else { a.name.to_lowercase().cmp(&b.name.to_lowercase()) }
    });

    let total_count = files.len();
    let parent_path = dir_path.parent().map(|p| p.to_string_lossy().to_string());

    Ok(DirectoryListing {
        current_path: path,
        parent_path,
        files,
        total_count,
        image_count,
        folder_count,
    })
}

/// Generate thumbnail. Returns base64 JPEG.
#[tauri::command]
pub fn get_thumbnail(path: String, size: u32) -> Result<ThumbnailResult, String> {
    let thumb_size = size.clamp(64, 800);
    let cache_path = thumbnail_cache_path(&path, thumb_size);

    // Cache hit — read file, encode base64, return
    if cache_path.exists() {
        let data = fs::read(&cache_path).map_err(|e| e.to_string())?;
        return Ok(ThumbnailResult {
            data: BASE64.encode(&data),
            width: thumb_size,
            height: thumb_size,
        });
    }

    // Generate
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    let thumbnail = img.resize(thumb_size, thumb_size, FilterType::Lanczos3);

    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);
    thumbnail.write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    fs::write(&cache_path, &buffer).ok();

    Ok(ThumbnailResult {
        data: BASE64.encode(&buffer),
        width: thumbnail.width(),
        height: thumbnail.height(),
    })
}

/// Return base64-encoded full image for lightbox.
#[tauri::command]
pub fn get_image_base64(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("Failed to read image: {}", e))?;
    let mime = get_mime_type(Path::new(&path));
    Ok(format!("data:{};base64,{}", mime, BASE64.encode(&data)))
}

#[tauri::command]
pub fn get_home_directory() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub fn get_pictures_directory() -> Result<String, String> {
    dirs::picture_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine pictures directory".to_string())
}
