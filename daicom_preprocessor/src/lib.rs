mod utils;

use dicom_core::Tag;
use dicom_core::value::DicomValueType;
use dicom_object::InMemDicomObject;
use wasm_bindgen::prelude::*;

use crate::utils::log_to_console;
use dicom_pixeldata::PixelDecoder;
use js_sys::Math::{max, pow, sin};
use js_sys::{ArrayBuffer, Uint8Array};
use wasm_bindgen_futures::JsFuture;
use web_sys::{Response, window};

#[wasm_bindgen]
pub fn init() {
    utils::set_panic_hook();
}

#[wasm_bindgen]
pub enum GeneratedDataType {
    Sphere,
    Sinusoid,
    Pillars,
}

fn sphere([x, y, z]: [f64; 3], [width, height, depth]: [f64; 3]) -> f64 {
    1f64 - (pow(x - width / 2f64, 2f64)
        + pow(y - height / 2f64, 2f64)
        + pow(z - depth / 2f64, 2f64))
        / pow(max(max(width, height), depth) * 0.9 / 2.0, 2.0)
}
fn sinusoid([x, y, z]: [f64; 3], [_, _, _]: [f64; 3]) -> f64 {
    1f64 - (y - 20.0 - 10.0 * sin(0.2 * x / (z * 0.05)) * sin(0.1 * z))
}
fn pillars([x, y, z]: [f64; 3], [width, height, depth]: [f64; 3]) -> f64 {
    let result = (((sin(x / width * 16.0) * 0.5 + 0.7)
        * (sin(z / depth * 16.0) * 0.5 + 0.7)
        * 0.5
        * height)
        - y)
        / height;
    result.clamp(0.0, 1.0)
}

#[wasm_bindgen]
pub fn generate_data(width: u32, height: u32, depth: u32, how: GeneratedDataType) -> Uint8Array {
    let generator = match how {
        GeneratedDataType::Sphere => sphere,
        GeneratedDataType::Sinusoid => sinusoid,
        GeneratedDataType::Pillars => pillars,
    };
    let dimensions = [width as f64, height as f64, depth as f64];
    let mut data: Vec<u8> = Vec::with_capacity(width as usize * height as usize * depth as usize);
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                // density
                let density = generator([x as f64, y as f64, z as f64], dimensions);
                data.push((density * u8::MAX as f64) as u8);
            }
        }
    }
    Uint8Array::from(data.as_slice())
}

struct DicomDataInternal {
    data: Uint8Array,
    dimensions: [u32; 3],
    scaling: [f32; 3],
}

#[wasm_bindgen]
#[allow(dead_code)]
pub struct DicomData {
    data: Uint8Array,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Into<DicomData> for DicomDataInternal {
    fn into(self) -> DicomData {
        DicomData {
            data: self.data,
            width: self.dimensions[0],
            height: self.dimensions[1],
            depth: self.dimensions[2],
            x: self.scaling[0],
            y: self.scaling[1],
            z: self.scaling[2],
        }
    }
}

// relevant tags
// -- from official registry https://dicom.nema.org/medical/Dicom/2017e/output/chtml/part06/chapter_6.html
// const REFERENCED_IMAGE_SEQUENCE: Tag = Tag(0x0008, 0x1140);
const PIXEL_SPACING: Tag = Tag(0x0028, 0x0030);
const SLICE_THICKNESS: Tag = Tag(0x0018, 0x0050);

const FLOAT_PIXEL_DATA: Tag = Tag(0x7fe0, 0x0008);
const DOUBLE_FLOAT_PIXEL_DATA: Tag = Tag(0x7fe0, 0x0009);
const PIXEL_DATA: Tag = Tag(0x7fe0, 0x0010);

// -- seemingly custom?
const DICOMDIR_IMAGE_SEQUENCE: Tag = Tag(0x0004, 0x1220);
const DICOMDIR_IMAGE_REFERENCE: Tag = Tag(0x0004, 0x1500);

fn debug_print_tags(obj: &InMemDicomObject, inset: usize) -> String {
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

fn read_dicom(bytes: Uint8Array, debug_print: bool) -> DicomDataInternal {
    let result_obj = dicom_object::from_reader(bytes.to_vec().as_slice()).unwrap();
    let sequence = result_obj.get(DICOMDIR_IMAGE_SEQUENCE);

    if let Some(Some(sequence)) = sequence.map(|seq| seq.items()) {
        for item in sequence {
            let image_reference = item.get(DICOMDIR_IMAGE_REFERENCE);
            if let Some(image_reference) = image_reference {
                let reference = image_reference
                    .strings()
                    .expect("Image Reference should be Strs");
                log_to_console(&format!("Reference: {}", reference.join("/")));
            } else {
                log_to_console("No Image Reference, printing debug");
                log_to_console(debug_print_tags(item, 0).as_str());
            }
        }

        return DicomDataInternal {
            data: Uint8Array::from(&[] as &[u8]),
            dimensions: [0, 0, 0],
            scaling: [1.0, 1.0, 1.0],
        };
    }

    // the result object does not contain an image sequence, so we assume it is an image
    let pixel_data = result_obj.decode_pixel_data().unwrap();
    let data = Uint8Array::from(pixel_data.data());

    let pixel_spacing = result_obj
        .get(PIXEL_SPACING)
        .expect("Image did not contain pixel spacing information");
    let [x, y] = pixel_spacing
        .strings()
        .expect("Pixel Spacing was not a String sequence")
    else {
        panic!("Pixel spacing did not contain two values x and y")
    };
    let slice_thickness = result_obj.get(SLICE_THICKNESS).map(|obj| {
        obj.strings()
            .expect("Slice thickness was not a string sequence")
            .get(0)
            .expect("Slice thickness didn't contain anything")
            .trim()
            .parse::<f32>().expect("Couldn't parse slice thickness to float")
    }).unwrap_or(1.0);

    if debug_print {
        log_to_console(&format!("Pixel Spacing: x={}, y={}, z={}", x, y, slice_thickness));
        log_to_console(debug_print_tags(&result_obj, 0).as_str());
    }

    DicomDataInternal {
        data,
        dimensions: [
            pixel_data.columns(),
            pixel_data.rows(),
            pixel_data.number_of_frames(),
        ],
        scaling: [
            x.trim().parse().expect("Couldn't parse x spacing to float"),
            y.trim().parse().expect("Couldn't parse y spacing to float"),
            slice_thickness
        ],
    }
}

async fn fetch_to_bytes(url: String) -> Uint8Array {
    let res = window()
        .expect("no window present")
        .fetch_with_str(url.as_str());
    let fut = JsFuture::from(res).await.expect("fetch failed");
    let resp: Response = fut.dyn_into().expect("fetch didn't return response");
    let array_buffer: ArrayBuffer = JsFuture::from(
        resp.array_buffer()
            .expect("couldn't get array buffer from response"),
    )
    .await
    .expect("couldn't await array buffer")
    .dyn_into()
    .expect("wasn't array buffer");
    Uint8Array::new(&array_buffer)
}

#[wasm_bindgen]
pub async fn read_dicoms_from_url(
    url: &str,
    from: u32,
    to: u32,
    replace: &str,
    replace_length: usize,
) -> DicomData {
    let mut data = Vec::new();
    for i in from..to {
        data.push(fetch_to_bytes(url.replace(
            replace,
            format!("{:0>width$}", i, width = replace_length).as_str(),
        )))
    }
    let mut awaited = Vec::with_capacity(data.len());
    for resp in data {
        awaited.push(resp.await);
    }
    read_dicoms(awaited)
}

#[wasm_bindgen]
pub fn read_dicoms(all_bytes: Vec<Uint8Array>) -> DicomData {
    let mut data = Vec::<u8>::new();
    let mut dimensions: [u32; 3] = [0, 0, 0];
    let mut scaling: [f32; 3] = [1.0, 1.0, 1.0];
    for bytes in all_bytes {
        let dicom = read_dicom(bytes, dimensions[0] == 0);
        if dimensions[0] == 0 {
            dimensions[0] = dicom.dimensions[0];
        } else if dimensions[0] != dicom.dimensions[0] {
            panic!("Different frames had different widths")
        }
        if dimensions[1] == 0 {
            dimensions[1] = dicom.dimensions[1];
        } else if dimensions[1] != dicom.dimensions[1] {
            panic!("Different frames had different heights")
        }
        for i in 0..3 {
            if scaling[i] == 1.0 {
                scaling[i] = dicom.scaling[i]
            } else if scaling[i] != dicom.scaling[i] {
                panic!("Different frames had different scaling")
            }
        }
        dimensions[2] += dicom.dimensions[2];
        // TODO: Just appending the bytes probably isn't right
        data.append(&mut dicom.data.to_vec())
    }
    DicomDataInternal {
        data: Uint8Array::from(data.as_slice()),
        dimensions,
        scaling,
    }
    .into()
}

#[wasm_bindgen]
pub fn read_dicom_bytes(dicom: DicomData) -> Uint8Array {
    dicom.data
}
