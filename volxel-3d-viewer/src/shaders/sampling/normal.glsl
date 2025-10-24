#include "common.glsl"

// --------------------------------------------------------------
// null-collision methods

float transmittance_simple(Ray ray, inout rand_seed seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return 1.0F;

    // in index space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1.0));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0.0));
    // ratio tracking
    float t = near_far.x - log(1.0 - rng(seed)) * u_volume_inv_maj, Tr = 1.f;
    while (t < near_far.y) {
        vec4 rgba = lookup_transfer(lookup_density_trilinear(ipos + t * idir) * u_volume_inv_maj);
        float d = u_volume_maj * rgba.a;

        // track ratio of real to null particles
        Tr *= 1.0 - d * u_volume_inv_maj;
        // russian roulette
        if (Tr < .1f) {
            float prob = 1.0 - Tr;
            if (rng(seed) < prob) return 0.f;
            Tr /= 1.0 - prob;
        }
        // advance
        t -= log(1.0 - rng(seed)) * u_volume_inv_maj;
    }
    return Tr;
}

bool sample_volume_simple(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed) {
    vec2 near_far;
    if (!ray_box_intersection(ray, u_volume_aabb, near_far)) return false;

    // to index-space
    vec3 ipos = vec3(u_volume_density_transform_inv * vec4(ray.origin, 1));
    vec3 idir = vec3(u_volume_density_transform_inv * vec4(ray.direction, 0)); // non-normalized!
    // delta tracking
    t = near_far.x - log(1.0 - rng(seed)) * u_volume_inv_maj;
    while (t < near_far.y) {
        vec4 rgba = lookup_transfer(lookup_density_trilinear(ipos + t * idir) * u_volume_inv_maj);
        float d = u_volume_maj * rgba.a;

        float P_real = d * u_volume_inv_maj;
        Le += throughput * (1.0 - u_volume_albedo) * lookup_emission(ipos + t * idir, seed) * P_real;
        // classify as real or null collison
        if (rng(seed) < P_real) {
            throughput *= rgba.rgb * u_volume_albedo;
            return true;
        }
        // advance
        t -= log(1.0 - rng(seed)) * u_volume_inv_maj;
    }
    return false;
}
