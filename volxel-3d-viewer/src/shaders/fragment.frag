#version 300 es

precision highp float;
precision highp sampler3D;
precision highp usampler3D;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;

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

// Shows ray intersection with AABB instead of volume
uniform bool u_debugHits;
uniform float u_sample_weight;

// Light
uniform vec3 u_light_dir;
const vec3 light_amb = vec3(0);

#include "random.glsl"
#include "utils.glsl"
#include "environment.glsl"

Ray setup_world_ray(vec2 ss_position, vec2 rng) {
    float aspect = float(u_res.x) / float(u_res.y);

    float x_offset = (rng.x * 2.0 - 1.0) * (1.0 / float(u_res.x));
    float y_offset = (rng.y * 2.0 - 1.0) * (1.0 / float(u_res.y));
    ss_position += vec2(x_offset, y_offset);

    return Ray(cameraWorldPos(), cameraWorldDir(ss_position));
}

float map_to_range(float x, vec2 range) {
    if (x < range.x || x > range.y) return -1.0;
    return (x - range.x) / (range.y - range.x);
}

// --------------------------------------------------------------
// stochastic filter helpers

ivec3 stochastic_trilinear_filter(const vec3 ipos, inout rand_seed seed) {
    return ivec3(ipos - 0.5 + rng3(seed));
}

ivec3 stochastic_tricubic_filter(const vec3 ipos, inout rand_seed seed) {
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
float lookup_density_stochastic(const vec3 ipos, inout rand_seed seed) {
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

// emission lookup stub

vec3 lookup_emission(vec3 ipos, inout rand_seed seed) {
    return vec3(0);
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

const uint max_steps = 100u;

// DDA-based transmittance
float transmittanceDDA(Ray ray, inout rand_seed seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return 1.0F;

    // in index space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1.0));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0.0));

    vec3 ri = 1.f / idir;
    // march brick grid
    float t = near_far.x + 1e-6f, Tr = 1.f, tau = -log(1.f - rng(seed)), mip = MIP_START;
    uint step = 0u;
    while (t < near_far.y && (step++ < max_steps)) {
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
bool sample_volumeDDA(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return false;

    // to index-space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0)); // non-normalized!
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
        Le += throughput * (1.f - u_volume_albedo) * lookup_emission(ipos + t * idir, seed) * d * u_volume_inv_maj;
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

uniform int show_environment;
uniform int bounces;

vec4 direct_render(Ray ray, inout rand_seed seed) {
    vec3 background = get_background_color(ray);
    float t = 0.0;
    vec3 throughput = vec3(1);
    vec3 Le = vec3(0);
    if (!sample_volumeDDA(ray, t, throughput, Le, seed)) {
        return vec4(background, 1);
    }

    // this is a simple direct rendering approach, no multiple paths traced
    vec3 sample_pos = ray.origin + t * ray.direction;
    vec3 light_dir;
    vec4 Le_pdf = sample_environment((rng2(seed) + rng2(seed)) / 2.0, light_dir);

    // check light intensity
    float light_att = transmittanceDDA(Ray(sample_pos, light_dir), seed);

    float f_p = phase_henyey_greenstein(dot(-ray.direction, light_dir), u_volume_phase_g);
    return vec4(throughput * (light_att * f_p * Le_pdf.rgb / Le_pdf.w + light_amb), 1);
}

vec4 trace_path(Ray ray, inout rand_seed seed) {
    // trace path
    vec3 L = vec3(0);
    vec3 throughput = vec3(1);
    bool free_path = true;
    uint n_paths = 0u;
    float t, f_p; // t: end of ray segment (i.e. sampled position or out of volume), f_p: last phase function sample for MIS
    while (sample_volumeDDA(ray, t, throughput, L, seed)) {
        // advance ray
        ray.origin = ray.origin + t * ray.direction;

        // sample light source (environment)
        vec3 w_i;
        vec4 Le_pdf = sample_environment(rng2(seed), w_i);
        if (Le_pdf.w > 0.0) {
            f_p = phase_henyey_greenstein(dot(-ray.direction, w_i), u_volume_phase_g);
            float mis_weight = show_environment > 0 ? power_heuristic(Le_pdf.w, f_p) : 1.f;
            float Tr = transmittanceDDA(Ray(ray.origin, w_i), seed);
            L += throughput * mis_weight * f_p * Tr * Le_pdf.rgb / Le_pdf.w;
        }

        // early out?
        if (++n_paths >= uint(bounces)) { free_path = false; break; }
        // russian roulette
        float rr_val = luma(throughput);
        if (rr_val < .1f) {
            float prob = 1.0 - rr_val;
            if (rng(seed) < prob) { free_path = false; break; }
            throughput /= 1.0 - prob;
        }

        // scatter ray
        vec3 scatter_dir = sample_phase_henyey_greenstein(ray.direction, u_volume_phase_g, rng2(seed));
        f_p = phase_henyey_greenstein(dot(-ray.direction, scatter_dir), u_volume_phase_g);
        ray.direction = scatter_dir;
    }

    // free path? -> add envmap contribution
    if (free_path && show_environment > 0) {
        vec3 Le = lookup_environment(ray.direction);
        float mis_weight = n_paths > 0u ? power_heuristic(f_p, pdf_environment(ray.direction)) : 1.f;
        L += throughput * mis_weight * Le;
    }

    return vec4(L, clamp(float(n_paths), 0.0, 1.0));
}

uniform int u_trace_path;

void main() {
    vec3 hit_min;
    vec3 hit_max;

    vec4 previous_frame = texture(u_previous_frame, tex);

    vec3 aabb[2] = u_volume_aabb;

    outColor = vec4(0.0);

    int env_mip_level = 5;

    ivec2 pixel = ivec2(tex * vec2(u_res));

    vec4 result = vec4(0);
    uint seed = tea(42u * uint(pixel.y * u_res.x + pixel.x), u_frame_index, 32u);
    rand_seed rand_state = seedXoshiro(seed);

    Ray ray = setup_world_ray(tex, (rng2(rand_state) + rng2(rand_state)) / 2.0);
    if (u_debugHits) {
        if (ray_box_intersection_positions(ray, aabb, hit_min, hit_max)) {
            result = vec4(world_to_aabb(hit_min, aabb), 1);
        } else {
            vec3 background = get_background_color(ray);
            result = vec4(background, 1);
        }
    } else {
        if (u_trace_path > 0) {
            result = sanitize(trace_path(ray, rand_state));
        } else {
            result = sanitize(direct_render(ray, rand_state));
        }
    }

    if (outColor.a == 0.0) outColor = vec4((u_sample_weight * previous_frame + (1.0 - u_sample_weight) * result).rgb, 1);
}