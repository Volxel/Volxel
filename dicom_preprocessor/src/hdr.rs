use std::io::Cursor;
use exr::prelude::{ReadChannels, ReadLayers};
use js_sys::{Float32Array, Uint8Array};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct ExrImage {
    data: Vec<f32>,
    width: usize,
    height: usize
}

#[wasm_bindgen]
impl ExrImage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> usize { self.width }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> usize { self.height }

    pub fn data(&self) -> Float32Array {
        unsafe {
            Float32Array::view(&self.data)
        }
    }

    pub fn decode_from_bytes(bytes: &Uint8Array) -> Result<ExrImage, JsValue> {
        let vec = bytes.to_vec();
        let cursor = Cursor::new(vec);

        let image_result = exr::prelude::read()
            .no_deep_data()
            .largest_resolution_level()
            .rgba_channels(
                |resolution, _channels| {
                    // TODO: Possibly handle channels
                    ExrImage {
                        data: vec![0.0f32; resolution.0 * resolution.1 * 4],
                        width: resolution.0,
                        height: resolution.1
                    }
                },
                |img: &mut ExrImage, pos, (r, g, b, a): (f32, f32, f32, f32)| {
                    let idx = (pos.1 * img.width + pos.0) * 4;
                    img.data[idx] = r;
                    img.data[idx + 1] = g;
                    img.data[idx + 2] = b;
                    img.data[idx + 3] = a;
                }
            )
            .first_valid_layer()
            .all_attributes()
            .from_buffered(cursor)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(image_result.layer_data.channel_data.pixels)
    }
}