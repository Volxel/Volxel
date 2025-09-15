#ifndef RANDOM
#define RANDOM
#define rand_seed uvec4

// Source: Global Illumination Lecture, random.h
/**
 * @brief Halton low discrepancy sequence (radical inverse)
 *
 * @param i i-th number to draw from this sequence
 * @param base Base for radical inverse computation
 *
 * @return i-th sample of this sequence
 */
float halton(int i, uint base) {
    float result = 0.0;
    float f = 1.f / (float(base));
    while (i > 0) {
        result = result + (f * float(i % int(base)));
        i = i / int(base);
        f = f / float(base);
    }
    return result;
}

/**
 * @brief Sobol low discrepancy sequence
 *
 * @param i i-th number to draw from this sequence
 * @param scramble Seed to scramble the distribution
 *
 * @return i-th sample of this sequence
 */
float sobol2(uint i, uint scramble) {
    for (uint v = 1u << 31u; i != 0u; i >>= 1u, v ^= v >> 1u)
    if ((i & uint(0x1)) != 0u)
    scramble ^= v;
    return float((scramble >> 8u) & uint(0xffffff)) / float(1 << 24);
}


uint tea(uint val0, uint val1, uint N) { // tiny encryption algorithm (TEA) to calculate a seed per launch index and iteration
    uint v0 = val0;
    uint v1 = val1;
    uint s0 = 0u;
    for (uint n = 0u; n < N; ++n) {
        s0 += uint(0x9e3779b9);
        v0 += ((v1 << 4) + uint(0xA341316C)) ^ (v1 + s0) ^ ((v1 >> 5) + uint(0xC8013EA4));
        v1 += ((v0 << 4) + uint(0xAD90777D)) ^ (v0 + s0) ^ ((v0 >> 5) + uint(0x7E95761E));
    }
    return v0;
}

// --- helpers --------------------------------------------------------------
uint rotl(uint x, uint k) {
    return (x << k) | (x >> (32u - k));
}

// A small integer hash (Thomas Wang style) for seeding / expanding one uint into many
uint wangHash(uint x) {
    x = (x ^ 61u) ^ (x >> 16u);
    x *= 9u;
    x = x ^ (x >> 4u);
    x *= 0x27d4eb2du;
    x = x ^ (x >> 15u);
    return x;
}

// Create a 128-bit state (uvec4) from a single 32-bit seed
rand_seed seedXoshiro(uint seed) {
    return uvec4(
    wangHash(seed + 0u),
    wangHash(seed + 1u),
    wangHash(seed + 2u),
    wangHash(seed + 3u)
    );
}

// --- xoshiro128++ core (state is uvec4) ----------------------------------
// returns a new uint random value and advances state (pass state as inout)
uint xoshiro128pp_next(inout uvec4 s) {
    uint result = rotl(s.x + s.z, 7u) + s.x;

    uint t = s.y << 9u;

    s.z ^= s.x;
    s.w ^= s.y;
    s.y ^= s.z;
    s.x ^= s.w;

    s.z ^= t;
    s.w = rotl(s.w, 11u);

    return result;
}

// --- conveniences: float / vec2 / vec3 / vec4 outputs ---------------------
// Note on float conversion:
//  - GPUs typically use 32-bit float with 24 bits mantissa. To get the
//    maximal distinct float samples use the top 24 bits of the uint.
//  - If you need the full 32-bit->float mapping (some loss unavoidable),
//    divide by 4294967296.0. Below we use >>8 and 16777216.0 to match 24-bit mantissa.

float rng(inout rand_seed state) {
    uint r = xoshiro128pp_next(state);
    return float(r >> 8u) / 16777216.0; // in [0,1)
}

vec2 rng2(inout rand_seed state) {
    return vec2(rng(state), rng(state));
}

vec3 rng3(inout rand_seed state) {
    return vec3(rng(state), rng(state), rng(state));
}

vec4 rngd4(inout rand_seed state) {
    return vec4(rng(state), rng(state), rng(state), rng(state));
}

#endif