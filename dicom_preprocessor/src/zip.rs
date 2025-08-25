use crate::utils::log_to_console;
use js_sys::Uint8Array;
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::PathBuf;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone)]
pub enum ZipReadErrorType {
    ExtractFailed,
    MoreThanOneFolder,
    NoFiles,
}

#[wasm_bindgen]
pub struct ZipReadError(ZipReadErrorType, Option<String>);

#[wasm_bindgen]
impl ZipReadError {
    pub fn error_type(&self) -> ZipReadErrorType {
        self.0.clone()
    }
    pub fn message(self) -> Option<String> {
        self.1
    }
}

#[wasm_bindgen]
pub struct ZipReadResult {
    bytes: Vec<Uint8Array>
}

#[wasm_bindgen]
impl ZipReadResult {
    pub fn bytes(self) -> Vec<Uint8Array> {
        self.bytes
    }
}

#[wasm_bindgen]
pub fn read_zip_to_bytes(zip: Uint8Array) -> Result<ZipReadResult, ZipReadError> {
    let buffer = Cursor::new(zip.to_vec());
    let mut archive = zip::ZipArchive::new(buffer)
        .map_err(|x| ZipReadError(ZipReadErrorType::ExtractFailed, Some(x.to_string())))?;

    if archive.len() < 1 {
        return Err(ZipReadError(ZipReadErrorType::NoFiles, None))
    }

    let mut bytes: Vec<Uint8Array> = Vec::with_capacity(archive.len());
    let mut directory: Option<PathBuf> = None;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|x| ZipReadError(ZipReadErrorType::ExtractFailed, Some(x.to_string())))?;
        let path = f.enclosed_name().map_or_else(|| Err(ZipReadError(ZipReadErrorType::ExtractFailed, Some("No enclosed name was able to be found".into()))), |x| Ok(x))?;
        if f.is_dir() {
            if let Some(_) = &directory {
                return Err(ZipReadError(ZipReadErrorType::MoreThanOneFolder, None))
            }
            directory = Some(path);
            continue;
        }
        if let Some(dir) = &directory {
            if let Some(parent) = path.parent() {
                if dir != parent {
                    return Err(ZipReadError(ZipReadErrorType::MoreThanOneFolder, None))
                }
            }
        }
        let mut file_bytes: Vec<u8> = Vec::new();
        f.read_to_end(&mut file_bytes).unwrap();
        bytes.push(Uint8Array::from(file_bytes.as_slice()));
    }
    Ok(ZipReadResult {
        bytes
    })
}
