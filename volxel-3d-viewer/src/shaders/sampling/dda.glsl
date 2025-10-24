#include "common.glsl"

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