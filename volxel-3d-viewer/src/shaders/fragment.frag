#version 300 es

// DEFINES

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

#include "sampling.glsl"

// ------------

uniform int show_environment;
uniform int bounces;

vec4 trace_path(Ray ray, inout rand_seed seed) {
    // trace path
    vec3 L = vec3(0);
    vec3 throughput = vec3(1);
    bool free_path = true;
    uint n_paths = 0u;
    float t, f_p; // t: end of ray segment (i.e. sampled position or out of volume), f_p: last phase function sample for MIS
    while (sample_volume(ray, t, throughput, L, seed)) {
        // advance ray
        ray.origin = ray.origin + t * ray.direction;

        // sample light source (environment)
        vec3 w_i;
        vec4 Le_pdf = sample_environment(rng2(seed), w_i);
        if (Le_pdf.w > 0.0) {
            f_p = phase_henyey_greenstein(dot(-ray.direction, w_i), u_volume_phase_g);
            float mis_weight = show_environment > 0 ? power_heuristic(Le_pdf.w, f_p) : 1.f;
            float Tr = transmittance(Ray(ray.origin, w_i), seed);
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
        result = sanitize(trace_path(ray, rand_state));
    }

    if (outColor.a == 0.0) outColor = vec4((u_sample_weight * previous_frame + (1.0 - u_sample_weight) * result).rgb, 1);

//    int level = env_imp_base_mip;
//    outColor = vec4(texelFetch(u_impmap, pixel / int(pow(2.0, float(level))), level).r, 0, 0, 1);
//    if (isnan(outColor.r) || isnan(outColor.g) || isnan(outColor.b)) outColor = vec4(1, 0, 0, 1);
//    else outColor = vec4(0, 1, 0, 1);
}