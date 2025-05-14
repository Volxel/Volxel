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