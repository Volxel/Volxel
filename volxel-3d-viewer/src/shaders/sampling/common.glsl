
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