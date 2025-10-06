use js_sys::{Float32Array, Uint8Array};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
pub struct ExrImage {
    data: Vec<f32>,
    width: u32,
    height: u32
}

#[wasm_bindgen]
impl ExrImage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 { self.width }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 { self.height }

    pub fn data(&self) -> Float32Array {
        Float32Array::from(self.data.as_slice())
    }

    pub fn decode_from_bytes(bytes: &Uint8Array) -> Result<ExrImage, JsValue> {
        let vec = bytes.to_vec();

        let image = image::load_from_memory(&vec).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let width = image.width();
        let height = image.height();
        let floats = image.into_rgba32f().into_raw();

        Ok(Self {
            data: floats,
            height,
            width
        })
    }
}