mod utils;
mod brick;
mod buf3d;
mod dicom;
mod grid;

use dicom_core::Tag;
use wasm_bindgen::prelude::*;

use crate::brick::BrickGrid;
use crate::buf3d::Buf3D;
use crate::utils::{debug_print_tags, log_to_console};
use dicom_pixeldata::{PixelDecoder, PixelRepresentation};
use glam::UVec3;
use js_sys::{Int32Array, Uint16Array, Uint32Array, Uint8Array};

#[wasm_bindgen]
pub fn init() {
    utils::set_panic_hook();
}

pub struct DicomDataInternal {
    data: Buf3D<u16>,
    scaling: [f32; 3],
    histogram: Vec<u32>,
    min: u16,
    max: u16
}

#[wasm_bindgen]
#[allow(dead_code)]
pub struct DicomData {
    data: Uint16Array,
    histogram: Uint32Array,
    gradient: Int32Array,
    pub min: u16,
    pub max: u16,
    pub gradmin: u32,
    pub gradmax: u32,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Into<DicomData> for DicomDataInternal {
    fn into(self) -> DicomData {
        let mut gradient: Vec<i32> = Vec::with_capacity(self.histogram.len());
        let mut last: u32 = 0;
        let mut gradmin: u32 = u32::MAX;
        let mut gradmax: u32 = u32::MIN;
        for histogram_step in &self.histogram {
            let gradient_step: i32 = histogram_step.clone() as i32 - last as i32;
            let abs_step = gradient_step.abs_diff(0);
            if abs_step > gradmax {
                gradmax = abs_step;
            }
            if abs_step < gradmin {
                gradmin = abs_step;
            }
            gradient.push(gradient_step);
            last = histogram_step.clone();
        }

        // smoothes the gradient a bit for nicer display
        let mut smoothed: Vec<i32> = Vec::with_capacity(gradient.len());
        smoothed.push(gradient[0]);
        for i in 1..(gradient.len() - 1) {
            let avg = gradient[i - 1] + gradient[i] + gradient[i + 1];
            smoothed.push(avg / 3);
        }
        smoothed.push(gradient[gradient.len() - 1]);

        DicomData {
            data: Uint16Array::from(self.data.data.as_slice()),
            width: self.data.stride.x,
            height: self.data.stride.y,
            depth: self.data.stride.z,
            x: self.scaling[0],
            y: self.scaling[1],
            z: self.scaling[2],
            min: self.min,
            max: self.max,
            gradmax,
            gradmin,
            histogram: Uint32Array::from(self.histogram.as_slice()),
            gradient: Int32Array::from(smoothed.as_slice())
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
            data: Buf3D::empty(),
            scaling: [1.0, 1.0, 1.0],
            histogram: vec![],
            min: 0,
            max: u16::MAX,
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

    let max_density = 2usize.pow(pixel_data.bits_stored() as u32);

    let mut histogram: Vec<u32> = vec![0; max_density];

    let shorts = bytemuck::cast_slice::<u8, u16>(pixel_data.data());
    let mut min_sample = u16::MAX;
    let mut max_sample = u16::MIN;
    for short in shorts {
        histogram[*short as usize] += 1;
        if *short < min_sample {
            min_sample = *short;
        }
        if *short > max_sample {
            max_sample = *short;
        }
    }
    let collected_data = Vec::from(shorts);

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
    }).unwrap_or(0.1);

    if debug_print {
        log_to_console(&format!("Pixel Spacing: x={}, y={}, z={}", x, y, slice_thickness));
    }

    let mut data = Buf3D::new(UVec3::new(pixel_data.columns(), pixel_data.rows(), pixel_data.number_of_frames()));
    data.data = collected_data;

    DicomDataInternal {
        data,
        scaling: [
            x.trim().parse().expect("Couldn't parse x spacing to float"),
            y.trim().parse().expect("Couldn't parse y spacing to float"),
            slice_thickness
        ],
        histogram,
        min: min_sample,
        max: max_sample
    }
}

fn read_dicoms_internal(all_bytes: Vec<Uint8Array>) -> DicomDataInternal {

    let mut result: Option<Buf3D<u16>> = None;
    let mut scaling: [f32; 3] = [1.0, 1.0, 1.0];
    let mut histogram: Vec<u32> = Vec::new();
    let mut min: u16 = u16::MAX;
    let mut max: u16 = 0;
    for bytes in all_bytes {
        let mut dicom = read_dicom(bytes, false);

        for i in 0..3 {
            if scaling[i] == 1.0 {
                scaling[i] = dicom.scaling[i]
            } else if scaling[i] != dicom.scaling[i] {
                panic!("Different frames had different scaling")
            }
        }

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
    DicomDataInternal {
        data: result.expect("No dicom data collected"),
        scaling,
        histogram,
        min,
        max
    }
}

#[wasm_bindgen]
pub fn read_dicoms(all_bytes: Vec<Uint8Array>) -> DicomData {
    read_dicoms_internal(all_bytes).into()
}

#[wasm_bindgen]
pub fn read_dicoms_to_grid(all_bytes: Vec<Uint8Array>) -> BrickGrid {
    BrickGrid::construct(&read_dicoms_internal(all_bytes))
}

#[wasm_bindgen]
pub fn extract_dicom_histogram(dicom: &DicomData) -> Uint32Array {
    dicom.histogram.clone()
}
#[wasm_bindgen]
pub fn extract_dicom_gradient(dicom: &DicomData) -> Int32Array {
    dicom.gradient.clone()
}

#[wasm_bindgen]
pub fn consume_dicom_to_data(dicom: DicomData) -> Uint16Array {
    dicom.data
}