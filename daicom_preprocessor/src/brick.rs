use crate::buf3d::Buf3D;
use crate::grid::Grid;
use glam::{IVec3, UVec3, Vec2, Vec3};
use half::f16;
use js_sys::{Int32Array, Uint32Array, Uint8Array};
use wasm_bindgen::prelude::wasm_bindgen;
// constants

const BRICK_SIZE: u32 = 8;
const BITS_PER_AXIS: u32 = 10;
const MAX_BRICKS: u32 = 1 << BITS_PER_AXIS;
const VOXELS_PER_BRICK: u32 = BRICK_SIZE * BRICK_SIZE * BRICK_SIZE;
const NUM_MIPMAPS: u32 = 3;

// ---

// encoding

fn encode_range(x: f32, y: f32) -> u32 {
    // TODO: This uses the half crate's f16 type, because the f16 isn't in stable Rust yet
    let x = f16::from_f32(x);
    let y = f16::from_f32(y);
    // TODO: Check whether this is the correct endianess
    let x = x.to_le_bytes();
    let y = y.to_le_bytes();
    let x = u16::from_le_bytes(x);
    let y = u16::from_le_bytes(y);
    (x as u32) & ((y as u32) << 16)
}
fn decode_range(data: u32) -> Vec2 {
    let x = (data & (0b1111_1111_1111_1111)) as u16;
    let y = (data >> 16) as u16;
    let x = f16::from_le_bytes(x.to_le_bytes());
    let y = f16::from_le_bytes(y.to_le_bytes());
    Vec2::new(x.to_f32(), y.to_f32())
}

fn encode_ptr(ptr: &UVec3) -> u32 {
    assert!(ptr.x < MAX_BRICKS && ptr.y < MAX_BRICKS && ptr.z < MAX_BRICKS);
    ptr.x.clamp(0, MAX_BRICKS - 1) << (2 + 2 * BITS_PER_AXIS) |
        ptr.y.clamp(0, MAX_BRICKS - 1) << (2 + 1 * BITS_PER_AXIS) |
        ptr.z.clamp(0, MAX_BRICKS - 1) << (2 + 0 * BITS_PER_AXIS)
}

fn decode_ptr(data: u32) -> UVec3 {
    UVec3::new(
        data >> (2 + 2 * BITS_PER_AXIS) & (MAX_BRICKS - 1),
        data >> (2 + 1 * BITS_PER_AXIS) & (MAX_BRICKS - 1),
        data >> (2 + 0 * BITS_PER_AXIS) & (MAX_BRICKS - 1)
    )
}

fn encode_voxel(value: f32, range: &Vec2) -> u8 {
    let normalized = ((value - range.x) / (range.y - range.x)).clamp(0.0, 1.0);
    (255f32 * normalized).round() as u8 // TODO: Check whether this does the conversion correctly
}

fn decode_voxel(data: u8, range: &Vec2) -> f32 {
    range.x + data as f32 * (1.0 / 255.0) * (range.y - range.x)
}

fn div_round_up(num: UVec3, denom: UVec3) -> UVec3 {
    let div = (Vec3::new(num.x as f32, num.y as f32, num.z as f32) / Vec3::new(denom.x as f32, denom.y as f32, denom.z as f32)).ceil();
    UVec3::new(div.x as u32, div.y as u32, div.z as u32)
}

// ---

#[wasm_bindgen]
pub struct BrickGrid {
    brick_count: UVec3,
    min_maj: (f32, f32),
    brick_counter: usize, // TODO: This was somehow used for multithreading
    indirection: Buf3D<u32>,
    range: Buf3D<u32>,
    atlas: Buf3D<u8>,
    range_mipmaps: Vec<Buf3D<u32>>,
    scaling: Vec3,
    histogram: Vec<u32>,
    histogram_gradient: (Vec<i32>, u32, u32),
}

impl BrickGrid {
    pub fn construct(from: &dyn Grid) -> Self {
        let brick_count = div_round_up(div_round_up(from.index_extent(), UVec3::splat(BRICK_SIZE)), UVec3::splat(1 << NUM_MIPMAPS)) * (1 << NUM_MIPMAPS);

        if brick_count.x >= MAX_BRICKS || brick_count.y >= MAX_BRICKS || brick_count.z >= MAX_BRICKS {
            panic!("Exceeded max brick count")
        }

        let mut indirection = Buf3D::new(brick_count);
        let mut range = Buf3D::new(brick_count);
        let mut atlas = Buf3D::new(brick_count * BRICK_SIZE);

        let mut brick_counter = 0;

        // Fill range, indirection and atlas buffers
        for brick_z in 0..brick_count.z { // TODO: This was multithreaded in the original voldata
            for brick_y in 0..brick_count.y {
                for brick_x in 0..brick_count.x {
                    let brick_coord = UVec3::new(brick_x, brick_y, brick_z);
                    // store an empty brick first
                    let indirection_brick_index = indirection.calculate_index(brick_coord);
                    indirection.data[indirection_brick_index] = 0;

                    // compute local range over dilated (TODO: ?) Brick
                    let mut local_min = f32::MAX;
                    let mut local_max = f32::MIN;
                    for local_z in -2..(BRICK_SIZE as i32) + 2 {
                        for local_y in -2..(BRICK_SIZE as i32) + 2 {
                            for local_x in -2..(BRICK_SIZE as i32) + 2 {
                                // TODO: This whole uvec -> ivec stuff seems weird, ask about this
                                let i_pos = brick_coord * BRICK_SIZE;
                                let i_pos = IVec3::new(i_pos.x as i32, i_pos.y as i32, i_pos.z as i32) + IVec3::new(local_x, local_y, local_z);
                                let looked_up = from.lookup(UVec3::new(i_pos.x as u32, i_pos.y as u32, i_pos.z as u32));
                                local_min = local_min.min(looked_up);
                                local_max = local_max.max(looked_up);
                            }
                        }
                    }

                    // now we know the min and max of the block we're considering.
                    // We can skip storing things in the atlas and indirection buffers
                    // if we know these are equal. But we still need to know what density the entire
                    // block has, so we need to store the information in the range buffer
                    let range_brick_index = range.calculate_index(brick_coord);
                    range.data[range_brick_index] = encode_range(local_min, local_max);
                    if local_min == local_max { continue; }

                    // If we reach this point, min and max are different, so we need to store an entry
                    // in the atlas and point to it in the indirection buffer

                    // TODO: In the multithreaded version, this was done via atomics
                    // This essentially "allocates" a new brick in the indirection and atlas
                    let brick_index = brick_counter;
                    brick_counter += 1;
                    let indirection_pointer = indirection.calculate_coord(brick_index);

                    // stores the pointer to the brick in the indirection buffer
                    indirection.data[indirection_brick_index] = encode_ptr(&indirection_pointer);

                    // stores the actual data in the atlas
                    // we decode the range again here because the intermittent conversion to f16 may have changed the values a bit TODO: CHeck whether that's right
                    let local_range = decode_range(range.data[range_brick_index]);
                    for local_z in 0..BRICK_SIZE {
                        for local_y in 0..BRICK_SIZE {
                            for local_x in 0..BRICK_SIZE {
                                let atlas_pos = indirection_pointer * BRICK_SIZE + UVec3::new(local_x, local_y, local_z);
                                let atlas_index = atlas.calculate_index(atlas_pos);
                                atlas.data[atlas_index] = encode_voxel(from.lookup(brick_coord * BRICK_SIZE + UVec3::new(local_x, local_y, local_z)), &local_range);
                            }
                        }
                    }
                }
            }
        }

        // Since some bricks are empty/constant it may be that we didn't fill up the entire atlas, so we can prune it
        atlas.prune((BRICK_SIZE as f32 * (brick_counter as f32 / (brick_count.x * brick_count.y) as f32).ceil().round()) as usize);

        // To speed up lookups (and possibly for delta tracking), we can create mipmaps for the range buffer
        let mut range_mipmaps = Vec::new();
        for mipmap_level in 0..NUM_MIPMAPS as usize {
            let mip_size = brick_count / (1 << (mipmap_level + 1));
            let mut buf = Buf3D::new(mip_size);

            let source = if mipmap_level == 0 {
                &range
            } else {
                &range_mipmaps[mipmap_level - 1]
            };

            // TODO: This was multithreaded
            for brick_z in 0..mip_size.z {
                for brick_y in 0..mip_size.y {
                    for brick_x in 0..mip_size.x {
                        let brick = UVec3::new(brick_x, brick_y, brick_z);
                        let mut local_min = f32::MAX;
                        let mut local_max = f32::MIN;
                        for z in 0..2 {
                            for y in 0..2 {
                                for x in 0..2 {
                                    let source_at = brick * 2 + UVec3::new(x, y, z);
                                    let source_index = source.calculate_index(source_at);
                                    let current_range = decode_range(source.data[source_index]);
                                    local_min = local_min.min(current_range.x);
                                    local_max = local_max.max(current_range.y);
                                }
                            }
                        }
                        let buffer_index = buf.calculate_index(brick);
                        buf.data[buffer_index] = encode_range(local_min, local_max);
                    }
                }
            }

            range_mipmaps.push(buf);
        }

        Self {
            brick_count,
            min_maj: from.minorant_majorant(),
            range,
            indirection,
            atlas,
            brick_counter,
            range_mipmaps,
            scaling: from.scaling(),
            histogram: from.histogram(),
            histogram_gradient: from.histogram_gradient()
        }
    }
}

impl Grid for BrickGrid {
    fn lookup(&self, ipos: UVec3) -> f32 {
        // Note: this forgoes mipmap lookup of ranges

        // basically a division by 8, which cuts of the index into the brick,
        // so all that remains is the index of the brick
        let brick_coord = ipos >> 3;

        // resolve the indirection to find out where in the atlas the brick data is stored
        let indirection_index = self.indirection.calculate_index(brick_coord);
        let indirection_pointer = decode_ptr(self.indirection.data[indirection_index]);

        // resolve the range of the brick
        let range_index = self.range.calculate_index(brick_coord);
        let minmax = decode_range(self.range.data[range_index]);

        // calculate the position of the specific voxel in the atlas by offsetting into the brick
        // in the atlas with the lower bits of the passed position
        let voxel = (indirection_pointer << 3) + UVec3::new(ipos.x & 7, ipos.y & 7, ipos.z & 7);

        // Actually looks up the u8 compressed data in the atlas, then decodes it with the range
        let atlas_index = self.atlas.calculate_index(voxel);
        decode_voxel(self.atlas.data[atlas_index], &minmax)
    }

    fn minorant_majorant(&self) -> (f32, f32) {
        self.min_maj
    }

    fn index_extent(&self) -> UVec3 {
        self.brick_count * BRICK_SIZE
    }

    fn num_voxels(&self) -> usize {
        self.brick_counter * VOXELS_PER_BRICK as usize
    }

    fn size_bytes(&self) -> usize {
        let dense_bricks = (self.brick_count.x * self.brick_count.y * self.brick_count.z) as usize;
        let size_indirection = dense_bricks * size_of::<u32>();
        let size_range = dense_bricks * size_of::<u32>();
        let size_atlas = self.brick_counter * VOXELS_PER_BRICK as usize * size_of::<u8>();

        let mut size_mipmaps: usize = 0;
        for mipmap in &self.range_mipmaps {
            size_mipmaps += size_of::<u32>() * (mipmap.stride.x * mipmap.stride.y * mipmap.stride.z) as usize;
        }

        size_indirection + size_range + size_atlas + size_mipmaps
    }

    fn scaling(&self) -> Vec3 {
        self.scaling.clone()
    }

    fn histogram(&self) -> Vec<u32> {
        self.histogram.clone()
    }

    fn histogram_gradient(&self) -> (Vec<i32>, u32, u32) {
        self.histogram_gradient.clone()
    }
}

// wasm stuff

#[wasm_bindgen]
impl BrickGrid {
    pub fn ind_x(&self) -> u32 {
        self.indirection.stride.x
    }
    pub fn ind_y(&self) -> u32 {
        self.indirection.stride.y
    }
    pub fn ind_z(&self) -> u32 {
        self.indirection.stride.z
    }

    pub fn range_x(&self) -> u32 {
        self.range.stride.x
    }
    pub fn range_y(&self) -> u32 {
        self.range.stride.y
    }
    pub fn range_z(&self) -> u32 {
        self.range.stride.z
    }

    pub fn atlas_x(&self) -> u32 {
        self.atlas.stride.x
    }
    pub fn atlas_y(&self) -> u32 {
        self.atlas.stride.y
    }
    pub fn atlas_z(&self) -> u32 {
        self.atlas.stride.z
    }

    pub fn scale_x(&self) -> f32 {
        self.scaling.x
    }
    pub fn scale_y(&self) -> f32 {
        self.scaling.y
    }
    pub fn scale_z(&self) -> f32 {
        self.scaling.z
    }

    pub fn histogram(&self) -> Uint32Array {
        Uint32Array::from(self.histogram.as_slice())
    }
    pub fn histogram_gradient_min(&self) -> u32 {
        self.histogram_gradient.1
    }
    pub fn histogram_gradient_max(&self) -> u32 {
        self.histogram_gradient.2
    }
    pub fn histogram_gradient(&self) -> Int32Array {
        Int32Array::from(self.histogram_gradient.0.as_slice())
    }

    pub fn indirection_data(&self) -> Uint32Array {
        Uint32Array::from(self.indirection.data.as_slice())
    }
    pub fn range_data(&self) -> Uint32Array {
        Uint32Array::from(self.range.data.as_slice())
    }
    pub fn atlas_data(&self) -> Uint8Array {
        Uint8Array::from(self.atlas.data.as_slice())
    }
}

// ---