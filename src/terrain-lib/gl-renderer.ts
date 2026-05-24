/**
 * gl-renderer.ts — WebGL Renderer
 *
 * Traduit le rendu OpenGL 1.x immédiat mode de Terrain.dll
 * (glBegin/glEnd, glTexCoord2f, glVertex3f, glNormal3f)
 * en WebGL2 avec VAO + buffers.
 *
 * Architecture multi-pass :
 *   Pass 0 : Texture de base (tile entière)
 *   Pass 1+ : Overlays de bordure (quadrants sélectifs)
 *
 * Chaque tile est un quadrilatère défini par ses 4 coins d'élévation,
 * rendu comme 2 triangles.
 */

import {
  ITile,
  IRenderPass,
  ILightConfig,
  TileType,
  TILE_W,
  TILE_H,
  ELEVATION_SCALE,
} from './types.js';

/** Vertex d'une tile : position 3D + texture UV + normale */
export interface TileVertex {
  x: number; y: number; z: number;
  u: number; v: number;
  nx: number; ny: number; nz: number;
}

/**
 * GLTileRenderer — Rendu WebGL des tiles avec multi-pass.
 *
 * Émule le pipeline de Terrain.dll :
 *   1. glLightfv + glMaterialfv → uniforms d'éclairage
 *   2. glBindTexture + glTexParameter → textures
 *   3. glBegin/glVertex/glNormal/glTexCoord → buffers
 *   4. glBlendFunc → blending pour bordures
 */
export class GLTileRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;

  /** Uniforms */
  private uModelView?: WebGLUniformLocation;
  private uProjection?: WebGLUniformLocation;
  private uTexture?: WebGLUniformLocation;
  private uAmbient?: WebGLUniformLocation;
  private uDiffuse?: WebGLUniformLocation;
  private uLightDir?: WebGLUniformLocation;
  private uAlpha?: WebGLUniformLocation;

  /** Attributs */
  private aPosition = -1;
  private aTexCoord = -1;
  private aNormal = -1;

  /** Buffer de géométrie (réutilisé) */
  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;

  /** Textures chargées (type × variation × suffix → WebGLTexture) */
  private textureCache = new Map<string, WebGLTexture>();

  /** Callback de fallback si texture pas chargée */
  onTextureMissing?: (type: TileType, variation: number, suffix: string) => WebGLTexture | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.initShaders();
    this.initBuffers();
  }

  // ── Shaders ──

  private initShaders(): void {
    const gl = this.gl;

    const vsSrc = `#version 300 es
      layout(location = 0) in vec3 aPos;
      layout(location = 1) in vec2 aUV;
      layout(location = 2) in vec3 aNorm;

      uniform mat4 uModelView;
      uniform mat4 uProjection;
      uniform vec3 uLightDir;
      uniform vec4 uAmbient;
      uniform vec4 uDiffuse;

      out vec2 vUV;
      out vec4 vColor;

      void main() {
        vec4 pos = uProjection * uModelView * vec4(aPos, 1.0);
        gl_Position = pos;
        vUV = aUV;

        // Éclairage lambertien simple (glLightfv port)
        vec3 N = normalize(mat3(uModelView) * aNorm);
        float diff = max(0.0, dot(N, normalize(uLightDir)));
        vColor = uAmbient + uDiffuse * diff;
      }
    `;

    const fsSrc = `#version 300 es
      precision mediump float;
      in vec2 vUV;
      in vec4 vColor;
      uniform sampler2D uTex;
      uniform float uAlpha;

      out vec4 fragColor;

      void main() {
        vec4 tex = texture(uTex, vUV);
        fragColor = tex * vColor;
        fragColor.a *= uAlpha;
      }
    `;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(prog));
      return;
    }
    this.program = prog;

    this.uModelView  = gl.getUniformLocation(prog, 'uModelView') ?? undefined;
    this.uProjection = gl.getUniformLocation(prog, 'uProjection') ?? undefined;
    this.uTexture    = gl.getUniformLocation(prog, 'uTex') ?? undefined;
    this.uAmbient    = gl.getUniformLocation(prog, 'uAmbient') ?? undefined;
    this.uDiffuse    = gl.getUniformLocation(prog, 'uDiffuse') ?? undefined;
    this.uLightDir   = gl.getUniformLocation(prog, 'uLightDir') ?? undefined;
    this.uAlpha      = gl.getUniformLocation(prog, 'uAlpha') ?? undefined;

    this.aPosition = 0;
    this.aTexCoord = 1;
    this.aNormal   = 2;
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  // ── Buffers ──

  private initBuffers(): void {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    if (!this.vao || !this.vertexBuffer) return;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    // Position (3 floats)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    // UV (2 floats)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
    // Normal (3 floats)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);

    gl.bindVertexArray(null);
  }

  // ── Chargement de textures ──

  /**
   * loadTexture — Charge une texture WebGL depuis un canvas ou ImageData.
   * Le jeu original charge des TGA depuis ./Data/Textures/.
   * Cette méthode accepte des sources WebGL standard.
   */
  loadTexture(
    type: TileType,
    variation: number,
    suffix: string,
    source: TexImageSource,
  ): WebGLTexture {
    const key = `${type}_${variation}_${suffix}`;
    const existing = this.textureCache.get(key);
    if (existing) return existing;

    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Cannot create texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);

    this.textureCache.set(key, tex);
    return tex;
  }

  getTexture(type: TileType, variation: number, suffix: string): WebGLTexture | null {
    const key = `${type}_${variation}_${suffix}`;
    return this.textureCache.get(key) ??
      (this.onTextureMissing ? this.onTextureMissing(type, variation, suffix) : null) ??
      null;
  }

  // ── Géométrie d'une tile ──

  /**
   * Génère les vertices d'une tile (2 triangles = 6 sommets).
   * Ordre : TL, TR, BL, TR, BR, BL (triangle strip-like)
   *
   * Projection dimétrique 2:1 :
   *   - axe X = horizontal pixel
   *   - axe Y = vertical pixel / 2
   *   - Z = élévation × ELEVATION_SCALE
   */
  buildTileGeometry(tile: ITile, passes: IRenderPass[]): TileVertex[] {
    const [eTL, eTR, eBR, eBL] = tile.elevation;
    const x0 = tile.x * TILE_W;
    const y0 = tile.y * TILE_H;
    const zTL = eTL * ELEVATION_SCALE;
    const zTR = eTR * ELEVATION_SCALE;
    const zBR = eBR * ELEVATION_SCALE;
    const zBL = eBL * ELEVATION_SCALE;

    // Centre de la tile en 3D pour calcul des normales
    const cx = x0 + TILE_W / 2;
    const cy = y0 + TILE_H / 2;
    const cz = (zTL + zTR + zBR + zBL) / 4;

    // Normale approximée (cross product des diagonales)
    const nx = (zTR - zBL) * TILE_H;
    const ny = (zBR - zTL) * TILE_W;
    const nz = TILE_W * TILE_H * 2;
    const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;

    const normal: [number, number, number] = [nx/nl, ny/nl, nz/nl];

    // 4 coins de la tile en 3D isométrique
    // Dans l'espace 3D : x→x, y→y, z→hauteur
    const verts: Array<[number, number, number]> = [
      [x0,      y0,      zTL], // TL
      [x0+TILE_W, y0,      zTR], // TR
      [x0,      y0+TILE_H, zBL], // BL
      [x0+TILE_W, y0+TILE_H, zBR], // BR
    ];

    // UV par quadrant
    const uvs: Array<[number, number]> = [
      [0, 0], // TL
      [1, 0], // TR
      [0, 1], // BL
      [1, 1], // BR
    ];

    // 2 triangles : TL-TR-BL, TR-BR-BL
    const indices = [0, 1, 2, 1, 3, 2];
    const result: TileVertex[] = [];
    for (const idx of indices) {
      result.push({
        x: verts[idx][0], y: verts[idx][1], z: verts[idx][2],
        u: uvs[idx][0], v: uvs[idx][1],
        nx: normal[0], ny: normal[1], nz: normal[2],
      });
    }
    return result;
  }

  // ── Rendu ──

  /**
   * renderTile — Rend une tile avec ses passes.
   * @param tile     Données de la tile
   * @param passes   Passes de rendu (base + bordures)
   * @param lighting Configuration d'éclairage
   * @param modelView Matrice modelview
   * @param projection Matrice projection
   */
  renderTile(
    tile: ITile,
    passes: IRenderPass[],
    lighting: ILightConfig,
    modelView: Float32Array,
    projection: Float32Array,
  ): void {
    const gl = this.gl;
    if (!this.program || !this.vao) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Uniforms d'éclairage
    if (this.uAmbient)  gl.uniform4fv(this.uAmbient, lighting.ambient);
    if (this.uDiffuse)  gl.uniform4fv(this.uDiffuse, lighting.diffuse);
    if (this.uLightDir) gl.uniform3fv(this.uLightDir, lighting.lightDir);
    if (this.uModelView) gl.uniformMatrix4fv(this.uModelView, false, modelView);
    if (this.uProjection) gl.uniformMatrix4fv(this.uProjection, false, projection);

    // Générer la géométrie une fois pour toutes les passes
    const vertices = this.buildTileGeometry(tile, passes);
    const verts = new Float32Array(vertices.length * 8); // 3+2+3 = 8 floats
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      const off = i * 8;
      verts[off]   = v.x;
      verts[off+1] = v.y;
      verts[off+2] = v.z;
      verts[off+3] = v.u;
      verts[off+4] = v.v;
      verts[off+5] = v.nx;
      verts[off+6] = v.ny;
      verts[off+7] = v.nz;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer!);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);

    // Rendu multi-pass
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];

      // Texture
      const tex = this.getTexture(pass.type, pass.variation, pass.suffix);
      if (tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (this.uTexture) gl.uniform1i(this.uTexture, 0);
      }

      // Blending — première passe opaque, suivantes avec alpha
      if (i === 0) {
        gl.disable(gl.BLEND);
        if (this.uAlpha) gl.uniform1f(this.uAlpha, 1.0);
      } else {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        if (this.uAlpha) gl.uniform1f(this.uAlpha, 0.8);
      }

      gl.drawArrays(gl.TRIANGLES, 0, vertices.length);
    }

    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /**
   * clear — Efface toutes les textures chargées.
   */
  clear(): void {
    const gl = this.gl;
    for (const tex of this.textureCache.values()) {
      gl.deleteTexture(tex);
    }
    this.textureCache.clear();
  }
}
