#version 300 es

precision highp float;
precision mediump sampler3D;
precision mediump usampler3D;

out vec4 outColor;

in vec2 tex;

uniform sampler2D u_transfer;
uniform sampler2D u_previous_frame;

// VOLUME INFO --------------

uniform vec3 u_volume_aabb[2];

uniform float u_volume_min;
uniform float u_volume_maj;
uniform float u_volume_inv_maj;

uniform vec3 u_volume_albedo;
uniform float u_volume_phase_g;
uniform float u_volume_density_scale;

// -- Density

uniform mat4 u_volume_density_transform;
uniform mat4 u_volume_density_transform_inv;

uniform usampler3D u_density_indirection;
uniform sampler3D u_density_range;
uniform sampler3D u_density_atlas;

// ----------------------------

uniform vec2 u_sample_range;
uniform uint u_frame_index;
uniform ivec2 u_res;

uniform float u_stepsize;

// Camera Info
uniform vec3 camera_pos;
uniform vec3 camera_view;
const vec3 camera_up = vec3(0, 1, 0);

// Shows ray intersection with AABB instead of volume
uniform bool u_debugHits;
uniform float u_sample_weight;

// Light
uniform vec3 u_light_dir;
const vec3 light_col = vec3(2);
const vec3 light_amb = vec3(0.6);


struct Ray {
    vec3 origin;
    vec3 direction;
};

#include "utils.glsl"
#include "random.glsl"

Ray setup_world_ray(vec2 ss_position, int i) {
    float aspect = float(u_res.x) / float(u_res.y);

    float x_offset = (halton(i, 2u) * 2.0 - 1.0) * (1.0 / float(u_res.x));
    float y_offset = (halton(i, 3u) * 2.0 - 1.0) * (1.0 / float(u_res.y));
    ss_position += vec2(x_offset, y_offset);

    vec3 forward = normalize(camera_view);
    vec3 right = normalize(cross(forward, camera_up));
    vec3 up = normalize(cross(right, forward));

    vec3 dir = normalize(ss_position.x * aspect * right + ss_position.y * up + forward);
    return Ray(camera_pos, dir);
}

bool ray_box_intersection(Ray ray, vec3 aabb[2], out vec2 near_far) {
    vec3 inv_dir = 1.f / ray.direction;
    vec3 lo = (aabb[0] - ray.origin) * inv_dir;
    vec3 hi = (aabb[1] - ray.origin) * inv_dir;
    vec3 tmin = min(lo, hi), tmax = max(lo, hi);
    near_far.x = max(0.f, max(tmin.x, max(tmin.y, tmin.z)));
    near_far.y = min(tmax.x, min(tmax.y, tmax.z));
    return near_far.x <= near_far.y;
}
bool ray_box_intersection_positions(Ray ray, vec3 aabb[2], out vec3 hit_min, out vec3 hit_max) {
    vec2 near_far;
    if (!ray_box_intersection(ray, aabb, near_far)) return false;

    // If ray starts inside the box
    if (near_far.x < 0.0) {
        hit_min = ray.origin;
        hit_max = ray.origin + ray.direction * near_far.y;
    } else {
        hit_min = ray.origin + ray.direction * near_far.x;
        hit_max = ray.origin + ray.direction * near_far.y;
    }

    return true;
}

// Converts from world space positions to interpolated positions inside AABB,
// used to sample 3D volumetric data
vec3 world_to_aabb(vec3 world, vec3 aabb[2]) {
    return (world - aabb[0]) / (aabb[1] - aabb[0]);
}

float map_to_range(float x, vec2 range) {
    if (x < range.x || x > range.y) return -1.0;
    return (x - range.x) / (range.y - range.x);
}

// --------------------------------------------------------------
// stochastic filter helpers

ivec3 stochastic_trilinear_filter(const vec3 ipos, inout uint seed) {
    return ivec3(ipos - 0.5 + rng3(seed));
}

ivec3 stochastic_tricubic_filter(const vec3 ipos, inout uint seed) {
    // from "Stochastic Texture Filtering": https://arxiv.org/pdf/2305.05810.pdf
    ivec3 iipos = ivec3(floor(ipos - 0.5));
    vec3 t = (ipos - 0.5) - vec3(iipos);
    vec3 t2 = t * t;
    // weighted reservoir sampling, first tap always accepted
    vec3 w = (1.f / 6.f) * (-t * t2 + 3.0 * t2 - 3.0 * t + 1.0);
    vec3 sumWt = w;
    ivec3 idx = ivec3(0);
    // sample second tap
    w = (1.f / 6.f) * (3.0 * t * t2 - 6.0 * t2 + 4.0);
    sumWt = w + sumWt;
    idx = ivec3(mix(vec3(idx), vec3(1), lessThan(rng3(seed), w / max(vec3(1e-3), sumWt))));
    // sample third tap
    w = (1.f / 6.f) * (-3.0 * t * t2 + 3.0 * t2 + 3.0 * t + 1.0);
    sumWt = w + sumWt;
    idx = ivec3(mix(vec3(idx), vec3(2), lessThan(rng3(seed), w / max(vec3(1e-3), sumWt))));
    // sample fourth tap
    w = (1.f / 6.f) * t * t2;
    sumWt = w + sumWt;
    idx = ivec3(mix(vec3(idx), vec3(3), lessThan(rng3(seed), w / max(vec3(1e-3), sumWt))));
    // return tap location
    return iipos + idx - 1;
}

// density lookup
float lookup_density_brick(const vec3 index_pos) {
    ivec3 iipos = ivec3(floor(index_pos));
    ivec3 brick = iipos >> 3;
    vec2 range = texelFetch(u_density_range, brick, 0).yx;
    uvec3 ptr = texelFetch(u_density_indirection, brick, 0).xyz;
    float value_unorm = texelFetch(u_density_atlas, ivec3(ptr << 3) + (iipos & 7), 0).x;

    return range.x + value_unorm * (range.y - range.x);
}
// this is a webgl thing because the trilinear thingy below uses ivec3 and volren/desktop opengl is just ok with that
float lookup_density_brick(ivec3 index_pos) {
    return lookup_density_brick(vec3(index_pos));
}

// brick majorant lookup (nearest neighbor)
float lookup_majorant(vec3 ipos, int mip) {
    ivec3 brick = ivec3(floor(ipos)) >> (3 + mip);
    return u_volume_density_scale * texelFetch(u_density_range, brick, mip).x;
}

// density lookup (nearest neighbor)
float lookup_density(const vec3 ipos) {
    return u_volume_density_scale * lookup_density_brick(ipos);
}

// density lookup (trilinear filter)
float lookup_density_trilinear(const vec3 ipos) {
    vec3 f = fract(ipos - 0.5);
    ivec3 iipos = ivec3(floor(ipos - 0.5));
    float lx0 = mix(lookup_density_brick(iipos + ivec3(0, 0, 0)), lookup_density_brick(iipos + ivec3(1, 0, 0)), f.x);
    float lx1 = mix(lookup_density_brick(iipos + ivec3(0, 1, 0)), lookup_density_brick(iipos + ivec3(1, 1, 0)), f.x);
    float hx0 = mix(lookup_density_brick(iipos + ivec3(0, 0, 1)), lookup_density_brick(iipos + ivec3(1, 0, 1)), f.x);
    float hx1 = mix(lookup_density_brick(iipos + ivec3(0, 1, 1)), lookup_density_brick(iipos + ivec3(1, 1, 1)), f.x);
    return u_volume_density_scale * mix(mix(lx0, lx1, f.y), mix(hx0, hx1, f.y), f.z);
}

// density lookup (stochastic tricubic filter)
float lookup_density_stochastic(const vec3 ipos, inout uint seed) {
    // return lookup_density(ivec3(ipos));
    // return lookup_density(stochastic_trilinear_filter(ipos, seed));
    return lookup_density(vec3(stochastic_tricubic_filter(ipos, seed)));
}

vec4 lookup_transfer(float density) {
    if (density < u_sample_range.x || density > u_sample_range.y) {
        return vec4(0);
    }
    return texture(u_transfer, vec2(density, 0.0));
}

// --------------------------------------------------------------
// DDA-based null-collision methods

#define MIP_START 3.0
#define MIP_SPEED_UP 0.25
#define MIP_SPEED_DOWN 2.0

// perform DDA step on given mip level
float stepDDA(vec3 pos, vec3 inv_dir, int mip) {
    float dim = float(8 << mip);
    vec3 offs = mix(vec3(-0.5f), vec3(dim + 0.5f), greaterThanEqual(inv_dir, vec3(0)));
    vec3 tmax = (floor(pos * (1.f / dim)) * dim + offs - pos) * inv_dir;
    return min(tmax.x, min(tmax.y, tmax.z));
}

// DDA-based transmittance
float transmittanceDDA(Ray ray, inout uint seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return 1.0F;

    // in index space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1.0));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0.0));

    vec3 ri = 1.f / idir;
    // march brick grid
    float t = near_far.x + 1e-6f, Tr = 1.f, tau = -log(1.f - rng(seed)), mip = MIP_START;
    while (t < near_far.y) {
        vec3 curr = ipos + t * idir;

        float majorant = u_volume_maj * lookup_transfer(lookup_majorant(curr, int(round(mip))) * u_volume_inv_maj).a;

        float dt = stepDDA(curr, ri, int(round(mip)));
        t += dt;
        tau -= majorant * dt;
        mip = min(mip + MIP_SPEED_UP, 3.f);
        if (tau > 0.0) continue; // no collision, step ahead
        t += tau / majorant; // step back to point of collision
        if (t >= near_far.y) break;

        vec4 rgba = lookup_transfer(lookup_density_trilinear(ipos + t * idir) * u_volume_inv_maj);
        float d = u_volume_maj * rgba.a;

        if (rng(seed) * majorant < d) { // check if real or null collision
            Tr *= max(0.f, 1.f - u_volume_maj / majorant); // adjust by ratio of global to local majorant
            // russian roulette
            if (Tr < .1f) {
                float prob = 1.0 - Tr;
                if (rng(seed) < prob) return 0.f;
                Tr /= 1.0 - prob;
            }
        }
        tau = -log(1.f - rng(seed));
        mip = max(0.f, mip - MIP_SPEED_DOWN);
    }
    return Tr;
}

// DDA-based volume sampling
bool sample_volumeDDA(Ray ray, out float t, inout vec3 throughput, inout uint seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) false;

    // in index space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1.0));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0.0));
    vec3 ri = 1.f / idir;
    // march brick grid
    t = near_far.x + 1e-6f;
    float tau = -log(1.f - rng(seed)), mip = MIP_START;
    while (t < near_far.y) {
        vec3 curr = ipos + t * idir;
        float majorant = u_volume_maj * lookup_transfer(lookup_majorant(curr, int(round(mip))) * u_volume_inv_maj).a;

        float dt = stepDDA(curr, ri, int(round(mip)));
        t += dt;
        tau -= majorant * dt;
        mip = min(mip + MIP_SPEED_UP, 3.f);
        if (tau > 0.0) continue; // no collision, step ahead
        t += tau / majorant; // step back to point of collision
        if (t >= near_far.y) break;

        vec4 rgba = lookup_transfer(lookup_density_trilinear(ipos + t * idir) * u_volume_inv_maj);
        float d = u_volume_maj * rgba.a;

        if (rng(seed) * majorant < d) { // check if real or null collision
            throughput *= u_volume_albedo;
            throughput *= rgba.rgb;
            return true;
        }
        tau = -log(1.f - rng(seed));
        mip = max(0.f, mip - MIP_SPEED_DOWN);
    }
    return false;
}

// ------------

vec4 direct_render(Ray ray, inout uint seed) {
    vec3 background = get_background_color(ray);
    float t = 0.0;
    vec3 throughput = vec3(1);
    if (!sample_volumeDDA(ray, t, throughput, seed)) {
        return vec4(background, 1);
    }

    // this is a simple direct rendering approach, no multiple paths traced
    vec3 sample_pos = ray.origin + t * ray.direction;
    // check light intensity
    float light_att = transmittanceDDA(Ray(sample_pos, -u_light_dir), seed);

    // TODO: Phase function
    return vec4(throughput * (light_att * light_col + light_amb), 1);
}

const uint ray_count = 1u;

void main() {
    vec3 hit_min;
    vec3 hit_max;

    vec4 previous_frame = texture(u_previous_frame, tex * 0.5 + 0.5);

    vec3 aabb[2] = u_volume_aabb;

    outColor = vec4(0.0);

    ivec2 pixel = ivec2((tex * 0.5 + 0.5) * vec2(u_res));

    vec4 result = vec4(0);
    uint seed = 42u;
    seed = tea(seed * uint(pixel.y * u_res.x + pixel.x), u_frame_index, 32u);
    for (uint i = 0u; i < ray_count; ++i) {
        seed += i;
        Ray ray = setup_world_ray(tex, int(u_frame_index * ray_count + i));
        vec3 background = get_background_color(ray);
        if (u_debugHits) {
            if (ray_box_intersection_positions(ray, aabb, hit_min, hit_max)) {
                result = vec4(world_to_aabb(hit_min, aabb), 1);
            } else {
                result = vec4(background, 1);
            }
            continue;
        }

        result = direct_render(ray, seed);
    }
    result = result / float(ray_count);

    if (outColor.a == 0.0) outColor = u_sample_weight * previous_frame + (1.0 - u_sample_weight) * result;
}