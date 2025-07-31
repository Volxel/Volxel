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
uniform float u_density_multiplier;
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
const vec3 light_dir = normalize(vec3(-1.0, -1.0, -1.0));
const vec3 light_col = vec3(50.0, 50.0, 50.0);

#include "utils.glsl"
#include "random.glsl"

struct Ray {
    vec3 origin;
    vec3 direction;
};

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

float lookup_density_brick(const vec3 index_pos) {
    ivec3 iipos = ivec3(floor(index_pos));
    ivec3 brick = iipos >> 3;
    vec2 range = texelFetch(u_density_range, brick, 0).yx;
    uvec3 ptr = texelFetch(u_density_indirection, brick, 0).xyz;
    float value_unorm = texelFetch(u_density_atlas, ivec3(ptr << 3) + (iipos & 7), 0).x;

    return u_volume_density_scale * (range.x + value_unorm * (range.y - range.x));
}

vec4 lookup_transfer(float density) {
    return texture(u_transfer, vec2(density, 0.0));
}

vec4 lookup_volume(vec3 aabb_pos) {
    float data_density = lookup_density_brick(aabb_pos);

    // TODO this check could be done in the lookup_density_brick
    if (data_density < u_sample_range.x || data_density > u_sample_range.y) {
        return vec4(0);
    }

    vec4 transfer_result = lookup_transfer(data_density);
    return vec4(transfer_result.xyz, transfer_result.w * u_density_multiplier);
}

// Delta/Ratio tracking without range mipmaps


float transmittance_ratio_track(Ray ray, inout uint seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return 1.0F;

    // in index space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1.0));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0.0));

    // calculate transmittance via ratio tracking
    float step_pos = near_far.x - log(1.0 - rng(seed)) * u_volume_inv_maj;
    float transmittance = 1.0F;

    while (step_pos < near_far.y) {
        float density = lookup_density_brick(ipos + step_pos * idir);
        density *= u_volume_inv_maj;
        vec4 transfer_result = lookup_transfer(density);
        density = u_volume_maj * transfer_result.a;

        // ratio tracking works via null particles. The amount of null particles is everything leftover
        // not filled by normal particles, so 1 minus the density
        transmittance *= 1.0 - density * u_volume_inv_maj;

        // russian roulette early exit for rays that probably won't hit anything anymore
        if (transmittance < .1F) {
            if (rng(seed) > transmittance) return 0.0F;
            transmittance /= 1.0 - transmittance;
        }

        // advance by the new delta_t
        step_pos -= log(1.0 - rng(seed)) * u_volume_inv_maj;
    }

    return clamp(transmittance, 0.0, 1.0);
}

// SIMPLE RAYMARCH ------------------

float phase(float g, float cos_theta) {
    float denom = 1.0 + g * g - 2.0 * g * cos_theta;
    return 1.0 / (4.0 * 3.141) * (1.0 - g * g) / (denom * sqrt(denom));
}

#define RAYMARCH_STEPS 64

float raymarch_transmittance(Ray ray, inout uint seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return -1.0F;

    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0));

    float dt = (near_far.y - near_far.x) / float(RAYMARCH_STEPS);
    near_far.x += rng(seed) * dt;
    float tau = 0.0F;

    for (int i = 0; i < RAYMARCH_STEPS; ++i) {
        tau += lookup_transfer(lookup_density_brick(ipos + min(near_far.x + float(i) * dt, near_far.y) * idir) * u_volume_inv_maj).a * u_volume_maj * dt;
    }

    return clamp(exp(-tau), 0.0, 1.0);
}

// ------------

vec3 get_background_color(Ray ray) {
    float angleHorizontal = dot(vec3(0, 0, 1), normalize(vec3(ray.direction.x, 0, ray.direction.z))) * 0.5 + 0.5;
    angleHorizontal = int(round(angleHorizontal * 8.0)) % 2 == 0 ? 1.0 : 0.0;
    float angleVertical = dot(normalize(ray.direction), normalize(vec3(ray.direction.x, 0, ray.direction.z)));
    angleVertical = int(round(angleVertical * 8.0)) % 2 == 0 ? 0.0 : 1.0;
    return vec3(abs(angleHorizontal - angleVertical) * 0.05); // vec3(clamp(pow(dot(ray.direction, -light_dir), 30.0), 0.0, 1.0)); //clamp(ray.direction, vec3(0.2), vec3(1.0));
}

const uint ray_count = 1u;

void main() {
    vec3 hit_min;
    vec3 hit_max;

    vec4 previous_frame = texture(u_previous_frame, tex * 0.5 + 0.5);

    vec3 aabb[2] = u_volume_aabb;

    outColor = vec4(0.0);

    vec4 result = vec4(0);
    uint seed = uint((tex.x * 0.5 + 0.5) * float(u_res.x) * float(u_res.y) + (tex.y * 0.5 + 0.5) * float(u_res.y)) + u_frame_index * 12356789u;
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

        float transmittance = transmittance_ratio_track(ray, seed);
        if (transmittance >= 0.0) result = vec4(vec3(1.0 - transmittance) + background, 1);
        else result = vec4(background, 1);
    }
    result = result / float(ray_count);

    if (outColor.a == 0.0) outColor = u_sample_weight * previous_frame + (1.0 - u_sample_weight) * result;
}