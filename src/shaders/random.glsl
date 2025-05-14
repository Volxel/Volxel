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