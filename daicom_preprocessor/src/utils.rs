use dicom_core::value::ValueType::{DataSetSequence, Str, Strs};
use dicom_object::InMemDicomObject;
use wasm_bindgen::prelude::*;
use crate::{DOUBLE_FLOAT_PIXEL_DATA, FLOAT_PIXEL_DATA, PIXEL_DATA};

pub fn set_panic_hook() {
    // When the `console_error_panic_hook` feature is enabled, we can call the
    // `set_panic_hook` function at least once during initialization, and then
    // we will get better error messages if our code ever panics.
    //
    // For more details see
    // https://github.com/rustwasm/console_error_panic_hook#readme
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    pub fn log_to_console(s: &str);
}

pub fn debug_print_tags(obj: &InMemDicomObject, inset: usize) -> String {
    let mut result: String = "".to_string();
    for tag in obj.tags() {
        let data = obj.get(tag).unwrap();
        let data_type = data.value().value_type();
        result += &format!(
            "{:inset$}- {}: {} ({:?})\n",
            "",
            tag,
            data.vr(),
            data_type,
            inset = inset
        );
        if tag == FLOAT_PIXEL_DATA || tag == DOUBLE_FLOAT_PIXEL_DATA || tag == PIXEL_DATA {
            result += &format!("{:inset$} | Pixel Data", "", inset = inset);
            continue;
        }

        use dicom_core::value::ValueType::*;

        match data_type {
            Strs => {
                let strings = data.strings().expect("data_type and data mismatched");
                for string in strings {
                    result += &format!("{:inset$} | {}\n", "", string);
                }
            }
            Str => {
                let string = data.string().expect("data_type and data mismatched");
                result += &format!("{:inset$} | {}\n", "", string);
            }
            DataSetSequence => {
                let items = data.items().expect("data_type and data mismatched");
                for item in items {
                    result += &format!("{:inset$} item\n", "");
                    result += debug_print_tags(item, inset + 2).as_str();
                }
            }
            _ => result += &format!("{:inset$} Debug: {:?}\n", "", data.value()),
        }
    }
    result
}