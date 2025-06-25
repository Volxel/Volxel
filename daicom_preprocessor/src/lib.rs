mod utils;

use dicom_core::Tag;
use wasm_bindgen::prelude::*;

use crate::utils::{debug_print_tags, log_to_console};
use dicom_pixeldata::{PixelDecoder, PixelRepresentation};
use js_sys::{Uint16Array, Uint8Array};

#[wasm_bindgen]
pub fn init() {
    utils::set_panic_hook();
}

struct DicomDataInternal {
    data: Uint16Array,
    dimensions: [u32; 3],
    scaling: [f32; 3],
    min_sample: u16,
    max_sample: u16,
}

#[wasm_bindgen]
#[allow(dead_code)]
pub struct DicomData {
    data: Uint16Array,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub min_sample: u16,
    pub max_sample: u16,
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
            max_sample: self.max_sample,
            min_sample: self.min_sample,
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
            data: Uint16Array::from(&[] as &[u16]),
            dimensions: [0, 0, 0],
            scaling: [1.0, 1.0, 1.0],
            max_sample: u16::MAX,
            min_sample: 0
        };
    }

    // the result object does not contain an image sequence, so we assume it is an image
    let pixel_data = result_obj.decode_pixel_data().unwrap();

    if pixel_data.samples_per_pixel() != 1 {
        panic!("More than one sample per pixel not currently supported")
    }
    if pixel_data.bits_allocated() != 16 {
        panic!("Currently only 16bit samples are supported")
    }
    if pixel_data.pixel_representation() != PixelRepresentation::Unsigned {
        panic!("Currently only unsigned samples are supported")
    }

    let shorts = bytemuck::cast_slice::<u8, u16>(pixel_data.data());
    let mut min_sample = u16::MAX;
    let mut max_sample = u16::MIN;
    for short in shorts {
        if *short < min_sample {
            min_sample = *short;
        }
        if *short > max_sample {
            max_sample = *short;
        }
    }
    let data = Uint16Array::from(shorts);

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
        max_sample,
        min_sample
    }
}

#[wasm_bindgen]
pub fn read_dicoms(all_bytes: Vec<Uint8Array>) -> DicomData {
    let mut data = Vec::<u16>::new();
    let mut dimensions: [u32; 3] = [0, 0, 0];
    let mut scaling: [f32; 3] = [1.0, 1.0, 1.0];
    let mut min_sample = u16::MAX;
    let mut max_sample = u16::MIN;
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
        // We can just append here, as the data is in exactly the order GL expects it to be in
        data.append(&mut dicom.data.to_vec());

        if dicom.min_sample < min_sample {
            min_sample = dicom.min_sample;
        }
        if dicom.max_sample > max_sample {
            max_sample = dicom.max_sample;
        }
    }
    DicomDataInternal {
        data: Uint16Array::from(data.as_slice()),
        dimensions,
        scaling,
        max_sample,
        min_sample
    }
    .into()
}

#[wasm_bindgen]
pub fn read_dicom_bytes(dicom: DicomData) -> Uint16Array {
    dicom.data
}
