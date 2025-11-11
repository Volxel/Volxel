use js_sys::{Date, Uint8Array};
use std::io::{Cursor, Read};
use std::path::PathBuf;
use glam::Mat4;
use wasm_bindgen::prelude::wasm_bindgen;
use crate::brick::BrickGrid;
use crate::buf3d::Buf3D;
use crate::{read_dicom, DicomDataInternal};
use crate::utils::log_to_console;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub enum ZipReadErrorType {
    ExtractFailed,
    MoreThanOneFolder,
    NoFiles,
}

#[wasm_bindgen]
pub struct ZipReadError(ZipReadErrorType, Option<String>);

#[wasm_bindgen]
impl ZipReadError {
    #[wasm_bindgen(getter)]
    pub fn message(self) -> String {
        format!("{:?}: {}", self.0, self.1.unwrap_or_else(|| "No Message Specified".to_string()))
    }
}

#[wasm_bindgen]
pub struct ZipResult {
    internal: DicomDataInternal
}

#[wasm_bindgen]
pub fn read_zip_to_grid(zip: Uint8Array) -> Result<ZipResult, ZipReadError> {
    log_to_console("Starting ZIP volume load");
    let start = Date::now();
    let mut result: Option<Buf3D<u16>> = None;
    let mut transform: Mat4 = Mat4::IDENTITY;
    let mut histogram: Vec<u32> = Vec::new();
    let mut min: u16 = u16::MAX;
    let mut max: u16 = 0;

    let buffer = Cursor::new(zip.to_vec());
    let mut archive = zip::ZipArchive::new(buffer)
        .map_err(|x| ZipReadError(ZipReadErrorType::ExtractFailed, Some(x.to_string())))?;

    if archive.len() < 1 {
        return Err(ZipReadError(ZipReadErrorType::NoFiles, None))
    }

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
        let mut dicom = read_dicom(Uint8Array::from(file_bytes.as_slice()),false);

        // I just assume every dicom object has the same transform
        transform = dicom.transform;

        if histogram.is_empty() {
            histogram.append(&mut dicom.histogram)
        } else {
            for i in 0..histogram.len() {
                histogram[i] = histogram[i] + dicom.histogram[i];
            }
        }

        if dicom.min < min {
            min = dicom.min
        }
        if dicom.max > max {
            max = dicom.max
        }

        if let Some(result) = &mut result {
            result.append_depth_slice(&mut dicom.data)
        } else {
            result = Some(dicom.data)
        }
    }

    let end = Date::now();
    let elapsed = end - start;
    log_to_console(&format!("Finished loading in {}", elapsed));

    let data = result.expect("No dicom data collected");

    log_to_console(format!("Grid Resolution: {} {} {}", data.stride.x, data.stride.y, data.stride.z).as_str());
    let internal = DicomDataInternal {
        data,
        transform,
        histogram,
        min,
        max
    };
    Ok(ZipResult { internal })
}

#[wasm_bindgen]
pub fn zip_to_dicom(zip: ZipResult) -> BrickGrid {
    log_to_console("Starting brick grid construction");
    let start = Date::now();
    let grid = BrickGrid::construct(&zip.internal);
    let end = Date::now();
    log_to_console(&format!("Brick grid construction took {}", end - start).as_str());
    grid
}