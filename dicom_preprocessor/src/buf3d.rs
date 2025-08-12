use glam::UVec3;

pub struct Buf3D<T : Default> {
    pub stride: UVec3,
    pub data: Vec<T>
}

impl<T : Default + Clone> Buf3D<T> {
    pub fn new(stride: UVec3) -> Self {
        Self { stride, data: vec![T::default(); (stride.x * stride.y * stride.z) as usize]}
    }
    pub fn empty() -> Self {
        Self::new(UVec3::new(0, 0, 0))
    }

    pub fn prune(&mut self, slices: usize) {
        self.stride.z = slices as u32;
        self.data.resize_with((self.stride.x * self.stride.y * self.stride.z) as usize, Default::default);
    }

    pub fn resize(&mut self, stride: &UVec3) {
        self.stride = stride.clone();
        self.data.resize_with((self.stride.x * self.stride.y * self.stride.z) as usize, Default::default);
    }

    pub fn calculate_index(&self, coord: UVec3) -> usize {
        (coord.z * self.stride.x * self.stride.y + coord.y * self.stride.x + coord.x) as usize
    }
    pub fn calculate_coord(&self, index: usize) -> UVec3 {
        let index = index as u32;
        UVec3::new(index % self.stride.x, (index / self.stride.x) % self.stride.y, index / (self.stride.x * self.stride.y))
    }

    pub fn append_depth_slice(&mut self, other: &mut Self) {
        assert_eq!(self.stride.x, other.stride.x);
        assert_eq!(self.stride.y, other.stride.y);
        self.data.append(&mut other.data);
        let new_size = self.stride + UVec3::new(0, 0, other.stride.z);
        self.resize(&new_size);
    }
}