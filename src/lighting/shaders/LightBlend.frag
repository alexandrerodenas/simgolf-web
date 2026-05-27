/**
 * LightBlend.frag — Shader de fusion de la texture lumière sur le rendu principal
 *
 * Prend en entrée :
 *   - La scène principale rendue (tDiffuse)
 *   - La texture de lumière floutée (tLight)
 *   - La texture ambiante (tAmbient, optionnelle)
 *
 * Applique un mélange additif : couleur_finale = couleur_scène * (lumière + ambiante)
 * Les zones sans lumière restent dans l'obscurité ambiante.
 */

#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D tDiffuse;     // Rendu principal (layer 0)
uniform sampler2D tLight;       // Texture de lumière floutée (layer 1)
uniform sampler2D tAmbient;     // Carte de lumière ambiante (optionnelle)
uniform vec4 ambientColor;      // Couleur ambiante par défaut
uniform float lightIntensity;   // Multiplicateur global de lumière
uniform bool hasAmbient;        // true si tAmbient est fournie

in vec2 vUv;

out vec4 fragColor;

void main() {
    // Échantillonner le rendu principal
    vec4 sceneColor = texture(tDiffuse, vUv);

    // Échantillonner la lumière (canal R)
    float lightValue = texture(tLight, vUv).r;

    // Échantillonner l'ambiante (canal R) ou utiliser la valeur par défaut
    float ambientValue;
    if (hasAmbient) {
        ambientValue = texture(tAmbient, vUv).r;
    } else {
        ambientValue = ambientColor.r;
    }

    // Combinaison : la lumière directe s'ajoute à l'ambiante
    // Les zones sans lumière directe reçoivent uniquement l'ambiante
    float totalLight = max(ambientValue, lightValue * lightIntensity);
    totalLight = clamp(totalLight, 0.0, 1.0);

    // Appliquer l'éclairage à la scène
    vec3 litColor = sceneColor.rgb * totalLight;

    // Ajouter la couleur de la lumière (teinte)
    vec3 lightTint = texture(tLight, vUv).rgb;
    litColor += lightTint * lightValue * 0.3;

    fragColor = vec4(litColor, sceneColor.a);
}
