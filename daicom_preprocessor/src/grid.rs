use glam::UVec3;

pub trait Grid {
    /// index-space grid lookup
    fn lookup(&self, ipos: UVec3) -> f32;
    /// global minorant and majorant
    fn minorant_majorant(&self) -> (f32, f32);
    /// max of index space voxel AABB, origin always (0, 0, 0)
    fn index_extent(&self) -> &UVec3;
    /// number of (active) voxels in this grid
    fn num_voxels(&self) -> usize;
    /// required bytes to store this grid
    fn size_bytes(&self) -> usize;
}
