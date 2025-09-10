#ifndef RANDOM
#define RANDOM
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

float rng(inout uint previous) { // return a random sample in the range [0, 1) with a simple linear congruential generator
    previous = previous * 1664525u + 1013904223u;
    return float(previous & 0x00FFFFFFu) / float(0x01000000u);
}

vec2 rng2(inout uint previous) {
    return vec2(rng(previous), rng(previous));
}

vec3 rng3(inout uint previous) {
    return vec3(rng(previous), rng(previous), rng(previous));
}

vec4 rng4(inout uint previous) {
    return vec4(rng(previous), rng(previous), rng(previous), rng(previous));
}

#endif