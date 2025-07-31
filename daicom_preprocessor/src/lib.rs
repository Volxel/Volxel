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
use glam::{Mat4, UVec3, Vec3};
use js_sys::Uint8Array;

#[wasm_bindgen]
pub fn init() {
    utils::set_panic_hook();
}

pub struct DicomDataInternal {
    data: Buf3D<u16>,
    histogram: Vec<u32>,
    min: u16,
    max: u16,
    transform: Mat4
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
            histogram: vec![],
            min: 0,
            max: u16::MAX,
            transform: Mat4::IDENTITY
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
    let pixel_sizing_x: f32 = x.trim().parse().expect("Couldn't parse x spacing to float");
    let pixel_sizing_y: f32 = y.trim().parse().expect("Couldn't parse y spacing to float");

    let slice_thickness = result_obj.get(SLICE_THICKNESS).map(|obj| {
        obj.strings()
            .expect("Slice thickness was not a string sequence")
            .get(0)
            .expect("Slice thickness didn't contain anything")
            .trim()
            .parse::<f32>().expect("Couldn't parse slice thickness to float")
    }).unwrap_or(0.1);

    if debug_print {
        log_to_console(&format!("Pixel Spacing: x={}, y={}, z={}", pixel_sizing_x, pixel_sizing_y, slice_thickness));
    }

    let mut data = Buf3D::new(UVec3::new(pixel_data.columns(), pixel_data.rows(), pixel_data.number_of_frames()));
    data.data = collected_data;

    DicomDataInternal {
        data,
        histogram,
        min: min_sample,
        max: max_sample,
        transform: Mat4::from_scale(Vec3::new(pixel_sizing_x, pixel_sizing_y, slice_thickness))
    }
}

fn read_dicoms_internal(all_bytes: Vec<Uint8Array>) -> DicomDataInternal {

    let mut result: Option<Buf3D<u16>> = None;
    let mut transform: Mat4 = Mat4::IDENTITY;
    let mut histogram: Vec<u32> = Vec::new();
    let mut min: u16 = u16::MAX;
    let mut max: u16 = 0;
    for bytes in all_bytes {
        let mut dicom = read_dicom(bytes, false);

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
    DicomDataInternal {
        data: result.expect("No dicom data collected"),
        transform,
        histogram,
        min,
        max
    }
}

#[wasm_bindgen]
pub fn read_dicoms_to_grid(all_bytes: Vec<Uint8Array>) -> BrickGrid {
    let dicom = read_dicoms_internal(all_bytes);
    BrickGrid::construct(&dicom)
}