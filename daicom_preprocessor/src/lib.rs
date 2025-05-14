mod utils;

use wasm_bindgen::prelude::*;

use dicom_object::DefaultDicomObject;
use js_sys::Math::{max, pow, sin};
use js_sys::Float32Array;

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
                data.push(0.0);
                data.push(0.0);
                data.push(0.0);
                // density
                let density = generator([x as f64, y as f64, z as f64], dimensions);
                data.push(density as f32);
            }
        }
    }
    Float32Array::from(data.as_slice())
}