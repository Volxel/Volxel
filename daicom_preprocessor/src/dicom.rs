use glam::UVec3;
use crate::DicomDataInternal;
use crate::grid::Grid;

impl Grid for DicomDataInternal {
    fn lookup(&self, ipos: UVec3) -> f32 {
        // TODO: Ask how to wrap
        let index = self.data.calculate_index(ipos);
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
}