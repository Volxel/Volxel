mod utils;

use wasm_bindgen::prelude::*;

use dicom_object::DefaultDicomObject;
use dicom_pixeldata::PixelDecoder;
use js_sys::Math::{max, pow, sin};
use js_sys::{Float32Array, Uint8Array};

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn init() {
    utils::set_panic_hook();
}

#[wasm_bindgen]
pub fn test_wasm() {
    alert(format!("Hello, daicom_preprocessor I am writing Rust! {}", size_of::<DefaultDicomObject>()).as_str());
}

#[wasm_bindgen]
pub fn greet() {
    alert("test")
}

#[wasm_bindgen]
pub enum GeneratedDataType {
    Sphere,
    Sinusoid,
    Pillars
}

fn sphere([x, y, z]: [f64; 3], [width, height, depth]: [f64; 3]) -> f64 {
    1f64 - (pow(x - width / 2f64, 2f64) + pow(y - height / 2f64, 2f64) + pow(z - depth / 2f64, 2f64)) /
        pow(max(max(width, height), depth) * 0.9 / 2.0, 2.0)
}
fn sinusoid([x, y, z]: [f64; 3], [_, _, _]: [f64; 3]) -> f64 {
    1f64 - (y - 20.0 - 10.0 * sin(0.2 * x / (z * 0.05)) * sin(0.1 * z))
}
fn pillars([x, y, z]: [f64; 3], [width, height, depth]: [f64; 3]) -> f64 {
    if y < (sin(x / width * 16.0) * 0.5 + 0.7) * (sin(z / depth * 16.0) * 0.5 + 0.7) * 0.5 * height {
        return 1.0
    }
    0.0
}

#[wasm_bindgen]
pub fn generate_data(width: u32, height: u32, depth: u32, how: GeneratedDataType) -> Float32Array {
    let generator = match how {
        GeneratedDataType::Sphere => sphere,
        GeneratedDataType::Sinusoid => sinusoid,
        GeneratedDataType::Pillars => pillars,
    };
    let dimensions = [width as f64, height as f64, depth as f64];
    let mut data: Vec<f32> = Vec::with_capacity(width as usize * height as usize * depth as usize);
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                // useless data, for now only the alpha is used as density
                data.push(x as f32 / width as f32);
                data.push(y as f32 / height as f32);
                data.push(z as f32 / depth as f32);
                // density
                let density = generator([x as f64, y as f64, z as f64], dimensions);
                data.push(density as f32);
            }
        }
    }
    Float32Array::from(data.as_slice())
}

#[wasm_bindgen]
#[allow(dead_code)]
pub struct DicomData {
    data: Uint8Array,
    pub width: u32,
    pub height: u32,
    pub depth: u32
}

pub fn read_dicom(bytes: Uint8Array) -> DicomData {
    let result_obj = dicom_object::from_reader(bytes.to_vec().as_slice()).unwrap();
    let pixel_data = result_obj.decode_pixel_data().unwrap();
    let data = Uint8Array::from(pixel_data.data());
    DicomData {
        data,
        width: pixel_data.columns(),
        height: pixel_data.rows(),
        depth: pixel_data.number_of_frames()
    }
}

#[wasm_bindgen]
pub fn read_dicoms(all_bytes: Vec<Uint8Array>) -> DicomData {
    let mut data = Vec::<u8>::new();
    let mut width: u32 = 0;
    let mut height: u32 = 0;
    let mut depth: u32 = 0;
    for bytes in all_bytes {
        let dicom = read_dicom(bytes);
        if width == 0 { width = dicom.width; }
        else if width != dicom.width { panic!("Different frames had different widths")}
        if height == 0 { height = dicom.height; }
        else if height != dicom.height { panic!("Different frames had different heights")}
        depth += dicom.depth;
        // TODO: Just appending the bytes probably isn't right
        data.append(&mut dicom.data.to_vec())
    }
    DicomData {
        data: Uint8Array::from(data.as_slice()),
        width,
        height,
        depth
    }
}

#[wasm_bindgen]
pub fn read_dicom_bytes(dicom: DicomData) -> Uint8Array {
    dicom.data
}