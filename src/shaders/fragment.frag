#version 300 es

precision highp float;
precision mediump sampler3D;

out vec4 outColor;

in vec2 tex;

uniform sampler3D u_texture;
uniform sampler2D u_transfer;
uniform vec3 u_volume_aabb[2];
uniform ivec2 u_res;

// Camera Info
uniform vec3 camera_pos;
uniform vec3 camera_view;
const vec3 camera_up = vec3(0, 1, 0);

// Shows ray intersection with AABB instead of volume
uniform bool u_debugHits;

// Light
const vec3 light_dir = normalize(vec3(-1.0, -1.0, -1.0));
const vec3 light_col = vec3(20.0, 20.0, 20.0);

#include "utils.glsl"
#include "random.glsl"

struct Ray {
    vec3 origin;
    vec3 direction;
};

Ray setup_world_ray(vec2 ss_position) {
    float aspect = float(u_res.x) / float(u_res.y);

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

// Simple raymarch that accumulates a float value, early break if it reaches 1
const float stepsize = 0.01;

vec4 eval_volume_world(vec3 world_pos) {
    vec3 sample_pos = world_to_aabb(world_pos, u_volume_aabb);
    float density = clamp(texture(u_texture, sample_pos).r, 0.0, 1.0);
    return texture(u_transfer, vec2(density, 0.0));
}

float phase(float g, float cos_theta) {
    float denom = 1.0 + g * g - 2.0 * g * cos_theta;
    return 1.0 / (4.0 * 3.141) * (1.0 - g * g) / (denom * sqrt(denom));
}

const uint ray_samples = 16u;

vec3 raymarch(vec3 from, vec3 to, vec3 background) {
    vec3 diff = to - from;

    // https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/volume-rendering-3D-density-field.html
    float sigma_a = 0.5; // absorption coefficient;
    float sigma_s = 0.5; // scattering coefficient
    float sigma_t = sigma_a + sigma_s; // extinction coefficient
    float g = 0.0; // henyey-greenstein asymmetry factor
    uint d = 2u; // russian roulette "probability"

    float transmission = 1.0; // fully transmissive to start with
    vec3 result_col = vec3(0);

    vec4 samples[ray_samples * 2u];
    uint counted_samples = 0u;
    for (uint i = 0u; i < ray_samples; ++i) {
        float t = halton(int(i), ray_samples);
        vec3 pos = from + t * diff;

        vec4 sampled = eval_volume_world(pos);
        if (sampled.a > 0.0) {
            samples[counted_samples * 2u] = vec4(pos, 1.0);
            samples[counted_samples * 2u + 1u] = sampled;
            counted_samples++;
        }
    }

    float part = 1.0 / float(counted_samples);

    for (uint i = 0u; i < counted_samples; ++i) {
        vec3 pos = samples[i * 2u].xyz;
        vec4 sampled = samples[i * 2u + 1u];

        float density = sampled.a;
        float sample_attenuation = exp(-part * density * sigma_t);
        transmission *= sample_attenuation;

        // In Scattering
        vec3 light_ray_exit;
        vec3 light_ray_entry;
        if (density > 0.0 && intersect_ray(Ray(pos, normalize(-light_dir)), u_volume_aabb, light_ray_entry, light_ray_exit)) {
            vec3 diff_inside = light_ray_exit - light_ray_entry;
            float dt_inside = stepsize / length(diff_inside);
            vec3 step_inside = diff_inside * dt_inside;
            uint numStepsInside = uint(ceil(length(diff_inside) / stepsize));

            float light_attenuation = 0.0; // tau in scratchapixel code
            // another raymarch to accumulate light attenuation
            for (uint j = 0u; j < numStepsInside; ++j) {
                float jitter = sobol2(j, i + 1u);
                vec3 pos_inside = light_ray_entry + (float(j) + jitter) * step_inside;
                light_attenuation += eval_volume_world(pos_inside).a;
            }
            float light_ray_att = exp(-light_attenuation * stepsize * sigma_t);

            result_col += sampled.rgb * light_col *
                light_ray_att *
                phase(g, dot(normalize(diff), normalize(light_dir))) *
                sigma_s *
                transmission *
                part *
                density;
        }

        if (transmission <= 1e-3) {
            // TODO: Random generator
        }
    }

    return background * transmission + result_col;
}

vec3 get_background_color(Ray ray) {
    return vec3(clamp(pow(dot(ray.direction, -light_dir), 30.0), 0.2, 1.0)); //clamp(ray.direction, vec3(0.2), vec3(1.0));
}

void main() {
    vec3 hit_min;
    vec3 hit_max;
    Ray ray = setup_world_ray(tex);
    bool hit;
    if (intersect_ray(ray, u_volume_aabb, hit_min, hit_max)) {
        hit = true;
        if(u_debugHits) {
            outColor = vec4(world_to_aabb(hit_min, u_volume_aabb), 1);
            return;
        }
        outColor = vec4(raymarch(hit_min, hit_max, get_background_color(ray)), 1.0);
    } else {
        outColor = vec4(get_background_color(ray), 1.0);
    }
}