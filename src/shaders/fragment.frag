#version 300 es

precision highp float;
precision mediump sampler3D;
precision mediump usampler3D;

out vec4 outColor;

in vec2 tex;

uniform sampler2D u_transfer;
uniform sampler2D u_previous_frame;

uniform usampler3D u_density_indirection;
uniform sampler3D u_density_range;
uniform sampler3D u_density_atlas;

uniform uvec3 u_volume_dimensions;

uniform vec2 u_sample_range;
uniform float u_density_multiplier;
uniform uint u_frame_index;
uniform vec3 u_volume_aabb[2];
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

bool intersect_ray(Ray ray, vec3 aabb[2], out vec3 hit_min, out vec3 hit_max) {
    vec3 inv_dir = 1.0 / ray.direction;

    vec3 t0s = (aabb[0] - ray.origin) * inv_dir;
    vec3 t1s = (aabb[1] - ray.origin) * inv_dir;

    vec3 tmin = min(t0s, t1s);
    vec3 tmax = max(t0s, t1s);

    float t_near = max(max(tmin.x, tmin.y), tmin.z);
    float t_far = min(min(tmax.x, tmax.y), tmax.z);

    // No intersection
    if (t_near > t_far || t_far < 0.0) {
        return false;
    }

    // If ray starts inside the box
    if (t_near < 0.0) {
        hit_min = ray.origin;
        hit_max = ray.origin + ray.direction * t_far;
    } else {
        hit_min = ray.origin + ray.direction * t_near;
        hit_max = ray.origin + ray.direction * t_far;
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

float lookup_density_brick(const vec3 ipos) {
    ivec3 iipos = ivec3(ipos * vec3(u_volume_dimensions));
    ivec3 brick = iipos >> 3;
    vec2 range = texelFetch(u_density_range, brick, 0).yx;
    if (range.x == range.y) return range.x;

    uvec3 ptr = texelFetch(u_density_indirection, brick, 0).xyz;
    float value_unorm = texelFetch(u_density_atlas, ivec3(ptr << 3) + (iipos & 7), 0).x;

    return (range.x + value_unorm * (range.y - range.x));
}

vec4 eval_volume_world(vec3 world_pos) {
    vec3 sample_pos = world_to_aabb(world_pos, u_volume_aabb);
    float data_density = lookup_density_brick(sample_pos);

    // TODO this check could be done in the lookup_density_brick
    if (data_density < u_sample_range.x || data_density > u_sample_range.y) {
        return vec4(0);
    }

    vec4 transfer_result = texture(u_transfer, vec2(data_density, 0.0));
    return vec4(transfer_result.xyz, transfer_result.w * u_density_multiplier);
}

float phase(float g, float cos_theta) {
    float denom = 1.0 + g * g - 2.0 * g * cos_theta;
    return 1.0 / (4.0 * 3.141) * (1.0 - g * g) / (denom * sqrt(denom));
}

vec3 raymarch(vec3 from, vec3 to, vec3 background, inout uint seed) {
    float stepsize = u_stepsize;
    vec3 diff = to - from;
    uint numSteps = uint(ceil(length(diff) / stepsize));
    float dt = stepsize / length(diff);
    vec3 step = diff * dt;

    // https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/volume-rendering-3D-density-field.html
    float sigma_a = 0.5; // absorption coefficient;
    float sigma_s = 0.5; // scattering coefficient
    float sigma_t = sigma_a + sigma_s; // extinction coefficient
    float g = 0.0; // henyey-greenstein asymmetry factor
    uint d = 2u; // russian roulette "probability"

    float transmission = 1.0; // fully transmissive to start with
    vec3 result_col = vec3(0);

    for (uint i = 0u; i < numSteps; ++i) {
        vec3 pos = from + (float(i) + rng(seed)) * step;

        vec4 sampled = eval_volume_world(pos);
        float density = sampled.a;

        if (density <= 0.0) continue;

        float sample_attenuation = exp(-stepsize * density * sigma_t);
        transmission *= sample_attenuation;

        // In Scattering
        vec3 light_ray_exit;
        vec3 light_ray_entry;
        if (intersect_ray(Ray(pos, normalize(-light_dir)), u_volume_aabb, light_ray_entry, light_ray_exit)) {
            vec3 diff_inside = light_ray_exit - light_ray_entry;
            float dt_inside = stepsize / length(diff_inside);
            vec3 step_inside = diff_inside * dt_inside;
            uint numStepsInside = uint(ceil(length(diff_inside) / stepsize));

            float light_attenuation = 0.0; // tau in scratchapixel code
            // another raymarch to accumulate light attenuation
            for (uint j = 0u; j < numStepsInside; ++j) {
                vec3 pos_inside = light_ray_entry + (float(j) + rng(seed)) * step_inside;
                light_attenuation += eval_volume_world(pos_inside).a;
            }
            float light_ray_att = exp(-light_attenuation * stepsize * sigma_t);

            result_col += sampled.rgb * light_col *
                light_ray_att *
                phase(g, dot(normalize(diff), normalize(light_dir))) *
                sigma_s *
                transmission *
                stepsize *
                density;
        }

        if (transmission <= 1e-3) {
            if (rng(seed) > 1.0 / float(d)) break;
            else transmission *= float(d);
        }
    }

    return background * transmission + result_col;
}

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

    vec4 result;
    uint seed = uint((tex.x * 0.5 + 0.5) * float(u_res.x) * float(u_res.y) + (tex.y * 0.5 + 0.5) * float(u_res.y)) + u_frame_index * 12356789u;
    for (uint i = 0u; i < ray_count; ++i) {
        seed += i;
        Ray ray = setup_world_ray(tex, int(u_frame_index * ray_count + i));
        if (intersect_ray(ray, u_volume_aabb, hit_min, hit_max)) {
            if(u_debugHits) {
                result += vec4(world_to_aabb(hit_min, u_volume_aabb), 1);
            } else {
                result += vec4(raymarch(hit_min, hit_max, get_background_color(ray), seed), 1.0);
            }
        } else {
            result += vec4(get_background_color(ray), 1.0);
        }
    }
    result = result / float(ray_count);

    outColor = u_sample_weight * previous_frame + (1.0 - u_sample_weight) * result;
}