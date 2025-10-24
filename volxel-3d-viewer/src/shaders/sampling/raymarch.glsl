#include "common.glsl"

// --------------------------------------------------------------
// ray-marching

#define RAYMARCH_STEPS 64

float transmittance_raymarch(Ray ray, inout rand_seed seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return 1.0F;

    // in index space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1.0));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0.0));
    // ray marching
    float dt = (near_far.y - near_far.x) / float(RAYMARCH_STEPS);
    near_far.x += rng(seed) * dt; // jitter starting position
    float tau = 0.f;
    for (int i = 0; i < RAYMARCH_STEPS; ++i) {
        tau += lookup_transfer(lookup_density_stochastic(ipos + min(near_far.x + float(i) * dt, near_far.y) * idir, seed) * u_volume_inv_maj).a * u_volume_maj * dt;
    }
    return exp(-tau);
}

bool sample_volume_raymarch(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed) {
    float pdf = 1.f;
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return false;

    // to index-space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0)); // non-normalized!
    // ray marching
    float tau_target = -log(1.f - rng(seed));
    float dt = (near_far.y - near_far.x) / float(RAYMARCH_STEPS);
    near_far.x += rng(seed) * dt; // jitter starting position
    float tau = 0.f;
    for (int i = 0; i < RAYMARCH_STEPS; ++i) {
        t = min(near_far.x + float(i) * dt, near_far.y);

        float d = lookup_density_stochastic(ipos + t * idir, seed);
        vec4 rgba = lookup_transfer(d * u_volume_inv_maj);
        tau += rgba.a * u_volume_maj * dt;

        if (tau >= tau_target) {
            // TODO revert to exact hit pos
            vec3 albedo = rgba.rgb * u_volume_albedo;
            pdf = mean(albedo) * d * exp(-tau_target);
            throughput *= albedo;
            return true;
        }
    }
    pdf = exp(-tau);
    return false;
}