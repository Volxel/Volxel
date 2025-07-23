use glam::{UVec3, Vec3};
use crate::DicomDataInternal;
use crate::grid::Grid;
use crate::utils::log_to_console;

impl Grid for DicomDataInternal {
    fn lookup(&self, ipos: UVec3) -> f32 {
        if ipos.z >= self.data.stride.z || ipos.y >= self.data.stride.y || ipos.x >= self.data.stride.x {
            return 0.0;
        }
        // TODO: Ask how to wrap
        let index = self.data.calculate_index(ipos);
        if index >= self.data.data.len() { log_to_console(&format!("index: {}\nipos: {}\nstride: {}", index, ipos, self.data.stride)); }
        let raw = self.data.data[index];
        // TODO: The lib used by voldata has this built in?
        (raw as f32) / (self.max as f32)
    }

    fn minorant_majorant(&self) -> (f32, f32) {
        (0.0, 1.0)
    }

    fn index_extent(&self) -> UVec3 {
        self.data.stride.clone()
    }

    fn num_voxels(&self) -> usize {
        (self.data.stride.x * self.data.stride.y * self.data.stride.z) as usize
    }

    fn size_bytes(&self) -> usize {
        todo!()
    }

    fn scaling(&self) -> Vec3 {
        Vec3::from(self.scaling)
    }

    fn histogram(&self) -> Vec<u32> {
        self.histogram.clone()
    }

    fn histogram_gradient(&self) -> (Vec<i32>, u32, u32) {
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
        (smoothed, gradmin, gradmax)
    }
}