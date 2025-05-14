mod utils;

use wasm_bindgen::prelude::*;

use dicom_object::DefaultDicomObject;

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