import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import DxfParser from 'dxf-parser';

export class CadEngine {
  private container: HTMLElement;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  public mesh: THREE.Object3D | null = null;
  private material: THREE.MeshStandardMaterial;
  private wireframeMaterial: THREE.MeshBasicMaterial;
  private rawLuminance: Float32Array | null = null;
  private originalZ: Float32Array | null = null;
  private animationFrameId: number = 0;
  private gridHelper: THREE.GridHelper;
  
  // Callbacks
  public onContentChanged?: (stats: { vertices: number, resolution: string }) => void;

  // Settings
  private size: number = 250;      
  private resolution: number = 1536; // High accuracy 3D (2.3M vertices max)
  private currentResolutionStr: string = '0 x 0';
  private currentHeightScale: number = 25;
  private currentSmoothing: number = 2;

  constructor(container: HTMLElement) {
    this.container = container;
    
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0B0C10');
    this.scene.fog = new THREE.FogExp2('#0B0C10', 0.0015);

    // Camera setup
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 4000);
    this.camera.position.set(250, 250, 300);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    
    container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Restrict mostly to above-ground

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 200, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(200, 300, 200);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 1500;
    dirLight.shadow.camera.left = -300;
    dirLight.shadow.camera.right = 300;
    dirLight.shadow.camera.top = 300;
    dirLight.shadow.camera.bottom = -300;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    // Grid Floor
    this.gridHelper = new THREE.GridHelper(1000, 100, 0x66FCF1, 0x1F2833);
    this.gridHelper.position.y = -0.1;
    (this.gridHelper.material as THREE.Material).opacity = 0.15;
    (this.gridHelper.material as THREE.Material).transparent = true;
    this.scene.add(this.gridHelper);

    // Material setup
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.05,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    
    this.wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x66FCF1,
      wireframe: true,
      transparent: true,
      opacity: 0.3
    });

    window.addEventListener('resize', this.onWindowResize);
    this.animate();
  }

  public destroy() {
    window.removeEventListener('resize', this.onWindowResize);
    cancelAnimationFrame(this.animationFrameId);
    
    if (this.renderer.domElement && this.container.contains(this.renderer.domElement)) {
        this.container.removeChild(this.renderer.domElement);
    }
    
    this.renderer.dispose();
    if (this.mesh) {
        this.mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
                ((child as any).geometry as THREE.BufferGeometry).dispose();
            }
        });
    }
  }

  private onWindowResize = () => {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private reportStats() {
      if (!this.onContentChanged) return;
      let vertices = 0;
      if (this.mesh) {
        this.mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
                const geom = (child as any).geometry as THREE.BufferGeometry;
                if (geom && geom.attributes.position) {
                    vertices += geom.attributes.position.count;
                }
            }
        });
      }
      this.onContentChanged({
          vertices,
          resolution: this.currentResolutionStr,
      });
  }

  public async loadFromFile(file: File, initialHeightScale: number = 20): Promise<void> {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            this.processImage(img, initialHeightScale);
            URL.revokeObjectURL(url);
            resolve();
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
  }

  private processImage(img: HTMLImageElement, heightScale: number) {
    const MAX_RES = this.resolution;
    
    // Apply full original image as the visual texture for 'infinite' visual detail (like a drone)
    const fullTexture = new THREE.Texture(img);
    fullTexture.colorSpace = THREE.SRGBColorSpace;
    fullTexture.generateMipmaps = true;
    fullTexture.minFilter = THREE.LinearMipmapLinearFilter;
    fullTexture.magFilter = THREE.LinearFilter;
    fullTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    fullTexture.needsUpdate = true;
    
    this.material.map = fullTexture;
    this.material.needsUpdate = true;

    let width = img.width;
    let height = img.height;
    
    // Scale down Geometry to prevent out of memory and slow rendering
    if (width > MAX_RES || height > MAX_RES) {
        let aspect = width / height;
        if (width > height) {
            width = MAX_RES;
            height = Math.round(MAX_RES / aspect);
        } else {
            height = MAX_RES;
            width = Math.round(MAX_RES * aspect);
        }
    }

    this.currentResolutionStr = `${img.width}x${img.height} (Tex) / ${width}x${height} (Mesh)`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Use ratio to fit inside the base size
    const maxDim = Math.max(width, height);
    const geomWidth = this.size * (width / maxDim);
    const geomHeight = this.size * (height / maxDim);

    const geometry = new THREE.PlaneGeometry(geomWidth, geomHeight, width - 1, height - 1);
    geometry.rotateX(-Math.PI / 2); // Make it horizontal

    const positions = geometry.attributes.position;
    this.rawLuminance = new Float32Array(positions.count);
    this.originalZ = new Float32Array(positions.count);

    for (let i = 0; i < positions.count; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0; 
        
        this.rawLuminance[i] = luminance;
        this.originalZ[i] = luminance;
        positions.setY(i, luminance * heightScale);
    }
    
    geometry.computeVertexNormals();

    if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                ((child as THREE.Mesh).geometry as THREE.BufferGeometry).dispose();
            } else if ((child as THREE.Line).isLine) {
                ((child as THREE.Line).geometry as THREE.BufferGeometry).dispose();
            }
        });
    }

    // Recentering the geometry so the origin is exactly in the middle.
    // PlaneGeometry is already centered on 0,0 locally.
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    
    this.scene.add(this.mesh);
    this.applySmoothing();
    
    // Adjust camera to view the entire object clearly
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(geomWidth * 0.8, heightScale * 2.5 + 80, geomHeight * 1.2);
    this.controls.update();

    this.reportStats();
  }

  public async loadFromDxf(file: File): Promise<void> {
    const text = await file.text();
    const parser = new DxfParser();
    let dxf: any;
    try {
        dxf = parser.parseSync(text);
    } catch(err) {
        throw new Error('Failed to parse DXF: ' + err);
    }
    this.processDxf(dxf);
  }

  private processDxf(dxf: any) {
      if (this.mesh) {
          this.scene.remove(this.mesh);
          this.mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
                ((child as any).geometry as THREE.BufferGeometry).dispose();
            }
          });
      }

      const parent = new THREE.Group();
      const vertices: number[] = [];

      if (dxf && dxf.entities) {
          for (const entity of dxf.entities) {
              if (entity.type === '3DFACE' || entity.type === 'SOLID') {
                  const v = entity.vertices;
                  if (v.length >= 3) {
                      vertices.push(v[0].x, v[0].y, v[0].z);
                      vertices.push(v[1].x, v[1].y, v[1].z);
                      vertices.push(v[2].x, v[2].y, v[2].z);
                      
                      if (v.length >= 4 && (v[3].x !== v[2].x || v[3].y !== v[2].y || v[3].z !== v[2].z)) {
                          vertices.push(v[0].x, v[0].y, v[0].z);
                          vertices.push(v[2].x, v[2].y, v[2].z);
                          vertices.push(v[3].x, v[3].y, v[3].z);
                      }
                  }
              } else if (entity.type === 'LINE') {
                  const geom = new THREE.BufferGeometry().setFromPoints([
                     new THREE.Vector3(entity.vertices[0].x, entity.vertices[0].y, entity.vertices[0].z || 0),
                     new THREE.Vector3(entity.vertices[1].x, entity.vertices[1].y, entity.vertices[1].z || 0)
                  ]);
                  parent.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x66FCF1 })));
              } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                  const pts = entity.vertices.map((v:any) => new THREE.Vector3(v.x, v.y, v.z || 0));
                  const geom = new THREE.BufferGeometry().setFromPoints(pts);
                  const material = new THREE.LineBasicMaterial({ color: 0x66FCF1 });
                  if (entity.shape || entity.closed) {
                      parent.add(new THREE.LineLoop(geom, material));
                  } else {
                      parent.add(new THREE.Line(geom, material));
                  }
              }
          }
      }

      if (vertices.length > 0) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
      }

      this.mesh = parent;
      this.originalZ = null; // Disable displacement for imported CAD
      this.scene.add(this.mesh);
      
      const box = new THREE.Box3().setFromObject(this.mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      this.mesh.position.set(-center.x, -center.y, -center.z);
      
      this.controls.target.set(0, 0, 0);
      const maxDim = Math.max(size.x, size.y, size.z) || 100;
      this.camera.position.set(maxDim, maxDim, maxDim);
      this.controls.update();

      this.currentResolutionStr = 'DXF Model';
      this.reportStats();
  }

  public setSmoothing(smooth: number) {
      this.currentSmoothing = smooth;
      this.applySmoothing();
  }

  private applySmoothing() {
      if (!this.mesh || !this.rawLuminance || !this.originalZ) return;

      let planeMesh: THREE.Mesh | null = null;
      this.mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry.type === 'PlaneGeometry') {
              planeMesh = child as THREE.Mesh;
          }
      });
      if (!planeMesh) return;

      const geometry = planeMesh.geometry as THREE.PlaneGeometry;
      const width = geometry.parameters.widthSegments + 1;
      const height = geometry.parameters.heightSegments + 1;

      if (this.currentSmoothing <= 0) {
          this.originalZ.set(this.rawLuminance);
      } else {
          const radius = this.currentSmoothing;
          const temp = new Float32Array(width * height);
          let current = new Float32Array(this.rawLuminance);
          let next = this.originalZ;

          // 2 passes of separable box blur for Gaussian-like smoothing
          for (let pass = 0; pass < 2; pass++) {
              // Horizontal blur
              for (let y = 0; y < height; y++) {
                  let sum = 0;
                  for (let i = -radius; i <= radius; i++) {
                      sum += current[y * width + Math.min(Math.max(i, 0), width - 1)];
                  }
                  for (let x = 0; x < width; x++) {
                      temp[y * width + x] = sum / (2 * radius + 1);
                      const subX = Math.max(x - radius, 0);
                      const addX = Math.min(x + radius + 1, width - 1);
                      sum += current[y * width + addX] - current[y * width + subX];
                  }
              }
              // Vertical blur
              for (let x = 0; x < width; x++) {
                  let sum = 0;
                  for (let i = -radius; i <= radius; i++) {
                      sum += temp[Math.min(Math.max(i, 0), height - 1) * width + x];
                  }
                  for (let y = 0; y < height; y++) {
                      next[y * width + x] = sum / (2 * radius + 1);
                      const subY = Math.max(y - radius, 0);
                      const addY = Math.min(y + radius + 1, height - 1);
                      sum += temp[addY * width + x] - temp[subY * width + x];
                  }
              }
              // Swap buffers
              if (pass === 0) {
                  const swap = current;
                  current = next;
                  next = swap;
              }
          }

          if (current !== this.originalZ) {
               this.originalZ.set(current);
          }
      }

      // Update positions
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
          positions.setY(i, this.originalZ[i] * this.currentHeightScale);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      this.reportStats();
  }

  public setHeightScale(scale: number) {
    this.currentHeightScale = scale;
    if (!this.mesh || !this.originalZ) return;
    
    // Process height scale for height map only (when originalZ is present)
    this.mesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const positions = mesh.geometry.attributes.position;
            if (positions && (mesh.geometry as THREE.PlaneGeometry).parameters) {
                for (let i = 0; i < positions.count; i++) {
                    positions.setY(i, this.originalZ[i] * scale);
                }
                positions.needsUpdate = true;
                mesh.geometry.computeVertexNormals();
            }
        }
    });
  }

  public setWireframe(enabled: boolean) {
      if (!this.mesh) return;
      this.mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              if (enabled) {
                  // Add wireframe overlay
                  if (!mesh.getObjectByName('wireframe_overlay')) {
                      const edges = new THREE.WireframeGeometry(mesh.geometry);
                      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x66FCF1, transparent: true, opacity: 0.15 }));
                      line.name = 'wireframe_overlay';
                      mesh.add(line);
                  }
              } else {
                  // Remove wireframe overlay
                  const line = mesh.getObjectByName('wireframe_overlay');
                  if (line) mesh.remove(line);
              }
              // Switch material to slightly darker when wireframe is on
              if (enabled) {
                  (mesh.material as THREE.MeshStandardMaterial).color.setHex(0x1F2833);
              } else {
                  (mesh.material as THREE.MeshStandardMaterial).color.setHex(0xC5C6C7);
              }
          }
      });
  }

  public setModelColor(colorHex: string) {
      this.material.color.set(colorHex);
      if (this.mesh) {
          this.mesh.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                  const mesh = child as THREE.Mesh;
                  if (mesh.material instanceof THREE.MeshStandardMaterial) {
                      mesh.material.color.set(colorHex);
                  }
              }
          });
      }
  }

  public exportStl(): Blob | null {
      if (!this.mesh) return null;
      const exporter = new STLExporter();
      // Use binary STL to save size and encoding time
      // Export only the mesh object to avoid extra scene helpers
      const stl = exporter.parse(this.mesh, { binary: true });
      
      if (stl instanceof DataView) {
          return new Blob([stl], { type: 'application/octet-stream' });
      } else {
          return new Blob([stl as any], { type: 'text/plain' }); // fallback
      }
  }

  public exportDxf(): Blob | null {
      if (!this.mesh) return null;
      const chunks: string[] = ['  0\nSECTION\n  2\nENTITIES\n'];
      
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const p3 = new THREE.Vector3();

      this.mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              const geometry = mesh.geometry;
              const positions = geometry.attributes.position;
              if (!positions) return;
              const index = geometry.index;
              const matrix = mesh.matrixWorld;

              const addFace = (v1: number, v2: number, v3: number) => {
                  p1.fromBufferAttribute(positions, v1).applyMatrix4(matrix);
                  p2.fromBufferAttribute(positions, v2).applyMatrix4(matrix);
                  p3.fromBufferAttribute(positions, v3).applyMatrix4(matrix);

                  chunks.push(`  0\n3DFACE\n  8\nTerrain\n 10\n${p1.x.toFixed(4)}\n 20\n${p1.y.toFixed(4)}\n 30\n${p1.z.toFixed(4)}\n 11\n${p2.x.toFixed(4)}\n 21\n${p2.y.toFixed(4)}\n 31\n${p2.z.toFixed(4)}\n 12\n${p3.x.toFixed(4)}\n 22\n${p3.y.toFixed(4)}\n 32\n${p3.z.toFixed(4)}\n 13\n${p3.x.toFixed(4)}\n 23\n${p3.y.toFixed(4)}\n 33\n${p3.z.toFixed(4)}\n`);
              };

              if (index) {
                  for (let i = 0; i < index.count; i += 3) {
                      addFace(index.getX(i), index.getX(i+1), index.getX(i+2));
                  }
              } else {
                  for (let i = 0; i < positions.count; i += 3) {
                      addFace(i, i+1, i+2);
                  }
              }
          } else if ((child as THREE.Line).isLine) {
              const line = child as THREE.Line;
              const geometry = line.geometry;
              const positions = geometry.attributes.position;
              if (!positions) return;
              const matrix = line.matrixWorld;
              
              for (let i = 0; i < positions.count - 1; i++) {
                  p1.fromBufferAttribute(positions, i).applyMatrix4(matrix);
                  p2.fromBufferAttribute(positions, i + 1).applyMatrix4(matrix);
                  chunks.push(`  0\nLINE\n  8\nLines\n 10\n${p1.x.toFixed(4)}\n 20\n${p1.y.toFixed(4)}\n 30\n${p1.z.toFixed(4)}\n 11\n${p2.x.toFixed(4)}\n 21\n${p2.y.toFixed(4)}\n 31\n${p2.z.toFixed(4)}\n`);
              }
              if ((child as THREE.LineLoop).type === 'LineLoop' && positions.count > 0) {
                  p1.fromBufferAttribute(positions, positions.count - 1).applyMatrix4(matrix);
                  p2.fromBufferAttribute(positions, 0).applyMatrix4(matrix);
                  chunks.push(`  0\nLINE\n  8\nLines\n 10\n${p1.x.toFixed(4)}\n 20\n${p1.y.toFixed(4)}\n 30\n${p1.z.toFixed(4)}\n 11\n${p2.x.toFixed(4)}\n 21\n${p2.y.toFixed(4)}\n 31\n${p2.z.toFixed(4)}\n`);
              }
          }
      });

      chunks.push('  0\nENDSEC\n  0\nEOF\n');
      return new Blob(chunks, { type: 'application/dxf' });
  }

  public exportObj(): Blob | null {
      if (!this.mesh) return null;
      const exporter = new OBJExporter();
      // OBJExporter only takes the mesh/scene and creates string
      const obj = exporter.parse(this.mesh);
      return new Blob([obj], { type: 'text/plain' });
  }
}
