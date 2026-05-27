/**
 * FastBlur.frag — Passe de flou gaussien pour la texture de lumière
 *
 * Applique un flou avec un kernel de taille configurable.
 * Utilisé en 2 passes (X puis Y) pour un effet de flou isotropique.
 *
 * Les bords polygonaux du maillage de lumière sont lissés par ce flou.
 */

#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 direction; // (1,0) pour X, (0,1) pour Y
uniform int kernelSize;

in vec2 vUv;

out vec4 fragColor;

void main() {
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;

    // Taille d'un pixel en UV
    vec2 pixelSize = vec2(1.0) / resolution;

    // Sigma adaptatif basé sur la taille du kernel
    float sigma = float(kernelSize) / 3.0;
    float sigma2 = 2.0 * sigma * sigma;

    int halfKernel = kernelSize / 2;

    for (int i = -halfKernel; i <= halfKernel; i++) {
        float fi = float(i);
        vec2 offset = direction * fi * pixelSize;
        float weight = exp(-(fi * fi) / sigma2);

        color += texture(tDiffuse, vUv + offset) * weight;
        totalWeight += weight;
    }

    fragColor = color / totalWeight;
}
