import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { resizeRendererToDisplaySize, loadShader } from "./util";
import { createNoise2D } from "simplex-noise";
import alea from "alea";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const prng = alea("porra");
const noise2D = createNoise2D(prng);

function generateTerrain(width, height, noise) {
  const geometry = new THREE.PlaneGeometry(width, height, 100, 100);
  const vertices = geometry.attributes.position.array;

  const scale = 0.02; // Fator de escala para as coordenadas x e y (ajuste conforme necessário)
  const heightFactor = 5; // Fator de amplificação da altura

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i] * scale; // Escala as coordenadas x
    const y = vertices[i + 1] * scale; // Escala as coordenadas y
    const z = noise(x, y); // Calcula a altura do vértice com o ruído

    vertices[i + 2] = z * heightFactor; // Ajusta a altura com o fator de amplificação
  }

  // Atualiza os vértices da geometria para refletir a modificação
  geometry.attributes.position.needsUpdate = true;

  return geometry;
}

async function main() {
  const clock = new THREE.Clock();
  const canvas = document.querySelector("#canvas");
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  const camera = createCamera();
  createControls(camera, renderer);
  const renderTarget = createRenderTarget();
  const { depthMaterial, waterMaterial, water } = await createSceneObjects(
    scene,
    renderTarget,
    camera
  );

  function render() {
    const time = clock.getElapsedTime();
    updateRendererSize(renderer, camera);

    captureSceneDepth(
      renderer,
      scene,
      camera,
      renderTarget,
      depthMaterial,
      water
    );
    applyWaterEffects(waterMaterial, renderTarget, time);
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

function createRenderTarget() {
  const target = new THREE.WebGLRenderTarget(
    window.innerWidth,
    window.innerHeight
  );
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  target.texture.generateMipmaps = false;
  target.depthTexture = new THREE.DepthTexture();
  target.depthTexture.type = THREE.UnsignedShortType;
  return target;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(75, 2, 0.1, 500);
  camera.position.set(5, 7, 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

function createControls(camera, renderer) {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();
  return controls;
}

async function createSceneObjects(scene, renderTarget, camera) {
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 5, 0);
  scene.add(directionalLight);

  // const pointLight = new THREE.PointLight(0xffffff, 2);
  // pointLight.position.set(1, 1, -1);
  // scene.add(pointLight);

  const terrainGeometry = generateTerrain(200, 200, noise2D);
  const terrainMaterial = new THREE.MeshPhongMaterial({
    color: 0xfffba0,
    specular: 0x101010,
    shininess: 200,
    side: THREE.DoubleSide,
  });
  // Criar o mesh do terreno
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.rotation.x = -Math.PI / 2;
  scene.add(terrain);

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    blending: THREE.NoBlending,
  });

  const [vertexShader, fragmentShader] = await Promise.all([
    loadShader("/src/shaders/vertexShader.glsl"),
    loadShader("/src/shaders/fragmentShader.glsl"),
  ]);

  const waterMaterial = new THREE.ShaderMaterial({
    defines: { DEPTH_PACKING: 0, ORTHOGRAPHIC_CAMERA: 0 },
    uniforms: {
      time: { value: 0 },
      threshold: { value: 3 },
      tDudv: {
        value: new THREE.TextureLoader().load("foam-texture.png"),
      },
      tDepth: { value: renderTarget.depthTexture },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      resolution: {
        value: new THREE.Vector2(window.innerWidth, window.innerHeight),
      },
      foamColor: { value: new THREE.Color(0xffffff) },
      waterColor: { value: new THREE.Color(0x02e6df) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
    side: THREE.DoubleSide,
  });

  const waterGeometry = new THREE.PlaneGeometry(1000, 1000);
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.rotation.x = -Math.PI * 0.5;
  scene.add(water);

  // Carregar o arquivo GLB
  const loader = new GLTFLoader();
  loader.load(
    "/public/boat.glb", // Caminho para o arquivo GLB
    (gltf) => {
      const model = gltf.scene; // O modelo carregado
      scene.add(model); // Adiciona o modelo à cena
      model.scale.set(0.1, 0.1, 0.1); // Ajuste de escala (opcional)
      model.rotation.x = -Math.PI / 2; 
      
      model.rotation.z = -Math.PI / 5; 
      model.position.set(0, -0.1, -3); // Ajuste de posição (opcional)
    },
    (xhr) => {
      // Função de acompanhamento para mostrar o progresso de carregamento
      console.log((xhr.loaded / xhr.total) * 100 + "% carregado");
    },
    (error) => {
      // Função de erro se o carregamento falhar
      console.error("Erro ao carregar o modelo GLB", error);
    }
  );

  return { depthMaterial, waterMaterial, water };
}

function updateRendererSize(renderer, camera) {
  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }
}

function captureSceneDepth(
  renderer,
  scene,
  camera,
  renderTarget,
  depthMaterial,
  water
) {
  water.visible = false;
  scene.overrideMaterial = depthMaterial;
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  water.visible = true;
}

function applyWaterEffects(waterMaterial, renderTarget, time) {
  waterMaterial.uniforms.time.value = time;
  waterMaterial.uniforms.tDepth.value = renderTarget.depthTexture;
}

main();
